CREATE OR REPLACE FUNCTION get_session_by_username(_username TEXT, _user_username TEXT, _session_passcode TEXT)
RETURNS user_sessions AS $$
DECLARE
    _host_user_id TEXT;
    _user_user_id TEXT;
    _session user_sessions%ROWTYPE;
BEGIN
    -- Check if desired user exists
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _username) THEN
        RAISE EXCEPTION 'User does not exist' USING ERRCODE = 'P0002';
    END IF;

    -- Check if requesting user exists
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _user_username) THEN
        RAISE EXCEPTION 'User does not exist' USING ERRCODE = 'P0002';
    END IF;

    -- Get the user_id of the host
    SELECT user_id INTO _host_user_id FROM users WHERE username = _username;

    -- Get the user_id of the user
    SELECT user_id INTO _user_user_id FROM users WHERE username = _user_username;

    -- Check if desired user is hosting a session
    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE host_username = _username) THEN
        RAISE EXCEPTION 'User is not hosting a session' USING ERRCODE = 'P0002';
    END IF;

    -- Get the session
    SELECT * INTO _session FROM user_sessions WHERE host_username = _username;

    -- Check if the requesting user is blacklisted
    IF _user_username = ANY (SELECT json_array_elements_text(_session.session_blacklist::json)) THEN
        RAISE EXCEPTION 'User is blacklisted from this session' USING ERRCODE = '42501';
    END IF;

    -- Check if the session is private, and if so, if the requesting user is whitelisted
    IF _session.allow_join = 'private' AND _user_username != ALL (SELECT json_array_elements_text(_session.session_whitelist::json)) THEN
        RAISE EXCEPTION 'Session is private and user is not whitelisted' USING ERRCODE = '42501';
    END IF;

    -- If not private, check if session is friends only, and if so, if the requesting user is friends with the host or whitelisted
    IF _session.allow_join = 'friends only' AND _user_username != ALL (SELECT json_array_elements_text(_session.session_whitelist::json)) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM user_friendships
            WHERE (friend_1_id = _host_user_id AND friend_2_id = _user_user_id)
               OR (friend_1_id = _user_user_id AND friend_2_id = _host_user_id)
        ) THEN
            RAISE EXCEPTION 'Session is friends only and user is not friends with the host' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF (_session.session_passcode <> '' AND crypt(_session_passcode, _session.session_passcode) IS DISTINCT FROM _session.session_passcode) AND _user_username != ALL (SELECT json_array_elements_text(_session.session_whitelist::json)) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM user_friendships
            WHERE (friend_1_id = _host_user_id AND friend_2_id = _user_user_id)
               OR (friend_1_id = _user_user_id AND friend_2_id = _host_user_id)
        ) THEN
            RAISE EXCEPTION 'Session passcode invalid, and user is not friends with the host' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- If all checks pass, return the session details
    RETURN _session;
END;
$$ LANGUAGE plpgsql;

-- Get a session preview by username (Does not require permissions)
CREATE OR REPLACE FUNCTION get_session_preview_by_username(_username TEXT)
RETURNS JSONB AS $$
DECLARE
    _result JSONB;
BEGIN
    -- Check if user exists
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _username) THEN
        RAISE EXCEPTION 'User does not exist' USING ERRCODE = 'P0002';
    END IF;

    -- Check if user is hosting a session
    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE host_username = _username) THEN
        RAISE EXCEPTION 'User is not hosting a session' USING ERRCODE = 'P0002';
    END IF;

    -- If user is hosting, append the session status to the beacon metadata and return the result
    SELECT user_sessions.beacon_metadata::jsonb || jsonb_build_object('session_status', user_sessions.session_status)
    INTO _result
    FROM user_sessions
    WHERE user_sessions.host_username = _username;

    RETURN _result;
END;
$$ LANGUAGE plpgsql;


-- Check if a session is being hosted by the given user
CREATE OR REPLACE FUNCTION check_user_hosting_session(_username TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    _exists BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM user_sessions WHERE host_username = _username) INTO _exists;
    RETURN _exists;
END;
$$ LANGUAGE plpgsql;