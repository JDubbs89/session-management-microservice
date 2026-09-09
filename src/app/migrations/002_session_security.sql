-- Existing passcodes are plaintext before this migration. Convert exactly once.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM user_sessions WHERE octet_length(session_passcode)>72) THEN
  RAISE EXCEPTION 'Existing passcodes require review before migration';
 END IF;
END $$;
UPDATE user_sessions SET session_passcode = crypt(session_passcode, gen_salt('bf', 12))
WHERE session_passcode IS NOT NULL AND session_passcode <> '';
-- Stored procedure to add a user
CREATE OR REPLACE FUNCTION create_new_user(_user_id TEXT, _steam_id TEXT, _name TEXT, _hashed_password TEXT, _role TEXT DEFAULT 'user', _overwrite BOOL DEFAULT false)
RETURNS VOID AS $$
BEGIN
    IF _overwrite OR NOT EXISTS (SELECT 1 FROM users WHERE username = _name OR user_id = _user_id OR user_steam_id = _steam_id) THEN
        INSERT INTO users (user_id, user_steam_id, username, hashed_password, user_role) VALUES (_user_id, _steam_id, _name, _hashed_password, _role);
    ELSE
        RAISE EXCEPTION 'Failed to create user' USING ERRCODE = '23505';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Stored procedure to remove a user
CREATE OR REPLACE FUNCTION delete_user(_name TEXT, _hashed_password TEXT,_executor_name TEXT, _executor_hashed_password TEXT)
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _name AND hashed_password = _hashed_password) THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _executor_name AND hashed_password = _executor_hashed_password) THEN
        RAISE EXCEPTION 'Executing User not found' USING ERRCODE = 'P0002';
    END IF;

    IF _executor_name != _name
    THEN
        IF NOT EXISTS (SELECT 1 FROM users WHERE username = _executor_name AND hashed_password = _executor_hashed_password AND user_role = 'admin')
        THEN
            RAISE EXCEPTION 'Insufficient permissions or incorrect password' USING ERRCODE = '42501';
        END IF;
    END IF;

    DELETE FROM user_sessions WHERE host_username = _name;
    DELETE FROM users WHERE username = _name AND hashed_password = _hashed_password;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION get_user_by_name(_username TEXT)
RETURNS users AS $$
DECLARE
    _result users%ROWTYPE;
BEGIN

    SELECT * INTO _result FROM users WHERE username = _username LIMIT 1;
    IF _result IS NULL
    THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;

    return _result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_id_by_name(_username TEXT)
RETURNS TEXT AS $$
DECLARE
    _result TEXT;
BEGIN
    SELECT user_id INTO _result FROM users WHERE username = _username LIMIT 1;
    IF NOT FOUND
    THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;
    return _result;

END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_by_steam_id(_steam_id TEXT)
RETURNS users AS $$
DECLARE
    _result users%ROWTYPE;
BEGIN

    SELECT * INTO _result FROM users WHERE user_steam_id = _steam_id LIMIT 1;
    IF _result IS NULL
    THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;

    return _result;
END;
$$ LANGUAGE plpgsql;


-- Stored procedure to log in as a user
CREATE OR REPLACE FUNCTION log_in_user(_user_id TEXT, _hashed_password TEXT)
RETURNS VOID AS $$
DECLARE
    _user users%ROWTYPE;
BEGIN

    SELECT * INTO _user FROM users WHERE user_id = _user_id AND hashed_password = _hashed_password LIMIT 1;
    IF _user IS NULL
    THEN
        RAISE EXCEPTION 'User not found or insufficient credentials' USING ERRCODE = 'P0002';
    END IF;


    UPDATE users
    SET user_online = TRUE,
    last_activity = CURRENT_TIMESTAMP
    WHERE user_id = _user_id AND hashed_password = _hashed_password;

END;
$$ LANGUAGE plpgsql;


-- Stored procedure to log out as a user
CREATE OR REPLACE FUNCTION log_out_user(_user_id TEXT, _hashed_password TEXT)
RETURNS VOID AS $$
DECLARE
    _user RECORD;
BEGIN

    SELECT * INTO _user FROM users WHERE user_id = _user_id AND hashed_password = _hashed_password LIMIT 1;
    IF _user IS NULL
    THEN
        RAISE EXCEPTION 'User not found or insufficient credentials' USING ERRCODE = 'P0002';
    END IF;

    IF NOT _user.user_online
    THEN
        RAISE EXCEPTION 'User is not logged in' USING ERRCODE = '42501';
    END IF;

    UPDATE users
    SET user_online = FALSE,
    last_activity = CURRENT_TIMESTAMP
    WHERE user_id = _user_id AND hashed_password = _hashed_password;

END;
$$ LANGUAGE plpgsql;


-- Create a session entry
CREATE OR REPLACE FUNCTION create_session
    (_session_code INT,
        _host_username TEXT,
        _beacon_metadata TEXT,
        _session_passcode TEXT DEFAULT '',
        _session_status TEXT DEFAULT 'started',
        _session_whitelist TEXT DEFAULT '[]',
        _session_blacklist TEXT DEFAULT '[]',
        _allow_join TEXT DEFAULT 'public')
RETURNS user_sessions AS $$
DECLARE
    _host_user_id TEXT;
    _host_steam_id TEXT;
    _new_session user_sessions%ROWTYPE;
BEGIN
    SELECT user_id, user_steam_id
    INTO _host_user_id, _host_steam_id
    FROM users
    WHERE username = _host_username LIMIT 1;
    IF NOT FOUND
    THEN
        RAISE EXCEPTION 'Host user not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE host_username = _host_username OR host_user_id = _host_user_id OR host_steam_id = _host_steam_id OR session_code = _session_code)
    THEN
        INSERT INTO user_sessions
            (session_code, session_passcode, host_user_id, host_username, host_steam_id, beacon_metadata, session_status, session_whitelist, session_blacklist, allow_join)
        VALUES
            (_session_code, CASE WHEN _session_passcode = '' THEN '' ELSE crypt(_session_passcode, gen_salt('bf', 12)) END, _host_user_id, _host_username, _host_steam_id, _beacon_metadata, _session_status, _session_whitelist, _session_blacklist, _allow_join);
    ELSE
        RAISE EXCEPTION 'Session already exists for this host' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO _new_session
    FROM user_sessions
    WHERE session_code = _session_code AND host_username = _host_username LIMIT 1;
    return _new_session;
END;
$$ LANGUAGE plpgsql;


-- Delete a session entry from the database
CREATE OR REPLACE FUNCTION delete_session(_session_code INT, _host_username TEXT, _session_passcode TEXT)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username)
    THEN
        RAISE EXCEPTION 'Authorization failed' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username AND (session_passcode = '' OR crypt(_session_passcode, session_passcode) = session_passcode))
    THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM user_sessions
    WHERE session_code = _session_code
    AND host_username = _host_username
    AND (session_passcode = '' OR crypt(_session_passcode, session_passcode) = session_passcode);

END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_session_by_session_code(_session_code INT, _user_username TEXT, _session_passcode TEXT DEFAULT '')
RETURNS user_sessions AS $$
DECLARE
    _username TEXT;
    _host_user_id TEXT;
    _user_user_id TEXT;
    _session user_sessions;
BEGIN

    -- Check if desired user exists
    SELECT host_username INTO _username FROM user_sessions WHERE session_code = _session_code LIMIT 1;
    IF NOT FOUND THEN
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
CREATE OR REPLACE FUNCTION get_session_preview_by_code(_session_code INT)
RETURNS JSONB AS $$
DECLARE
    _username TEXT;
    _result JSONB;
BEGIN

    -- Check if user exists
    SELECT host_username INTO _username FROM user_sessions WHERE session_code = _session_code LIMIT 1;
    IF NOT FOUND THEN
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

CREATE OR REPLACE FUNCTION does_session_exist(_session_code INT)
RETURNS BOOLEAN AS $$
DECLARE
    _exists BOOLEAN;
BEGIN

    SELECT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code) INTO _exists;
    RETURN _exists;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION get_session_by_steam_id(_steam_id TEXT, _user_username TEXT, _session_passcode TEXT)
RETURNS user_sessions AS $$
DECLARE
    _username TEXT;
    _host_user_id TEXT;
    _user_user_id TEXT;
    _session user_sessions;
BEGIN

    -- Check if desired user exists
    SELECT username INTO _username FROM users WHERE user_steam_id = _steam_id LIMIT 1;
    IF NOT FOUND THEN
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
CREATE OR REPLACE FUNCTION get_session_preview_by_steam_id(_steam_id TEXT)
RETURNS JSONB AS $$
DECLARE
    _username TEXT;
    _result JSONB;
BEGIN

    -- Check if user exists
    SELECT username INTO _username FROM users WHERE user_steam_id = _steam_id LIMIT 1;
    IF NOT FOUND THEN
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

CREATE OR REPLACE FUNCTION update_session( -- Function only changes metadata, not the actual host data
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_session_code INT DEFAULT NULL,
    _new_session_passcode TEXT DEFAULT NULL,
    _new_session_status TEXT DEFAULT NULL,
    _new_beacon_metadata TEXT DEFAULT NULL,
    _new_whitelist TEXT DEFAULT NULL,
    _new_blacklist TEXT DEFAULT NULL,
    _new_privacy TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    -- Check if the session exists
    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    -- Check if the host user exists and has the correct password
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Update the session code if provided
    IF _new_session_code IS NOT NULL THEN
        UPDATE user_sessions
        SET session_code = _new_session_code
        WHERE session_code = _session_code AND host_username = _host_username;
    END IF;

    -- Update the session passcode if provided
    IF _new_session_passcode IS NOT NULL THEN
        UPDATE user_sessions
        SET session_passcode = _new_session_passcode
        WHERE session_code = _session_code AND host_username = _host_username;
    END IF;

    -- Update the session status if provided
    IF _new_session_status IS NOT NULL THEN
        UPDATE user_sessions
        SET session_status = _new_session_status
        WHERE session_code = _session_code AND host_username = _host_username;
    END IF;

    -- Update the beacon metadata if provided
    IF _new_beacon_metadata IS NOT NULL THEN
        UPDATE user_sessions
        SET beacon_metadata = _new_beacon_metadata
        WHERE session_code = _session_code AND host_username = _host_username;
    END IF;

    -- Update the whitelist if provided
    IF _new_whitelist IS NOT NULL THEN
        UPDATE user_sessions
        SET session_whitelist = _new_whitelist
        WHERE session_code = _session_code AND host_username = _host_username;
    END IF;

    -- Update the blacklist if provided
    IF _new_blacklist IS NOT NULL THEN
        UPDATE user_sessions
        SET session_blacklist = _new_blacklist
        WHERE session_code = _session_code AND host_username = _host_username;
    END IF;

    -- Update the privacy setting if provided
    IF _new_privacy IS NOT NULL THEN
        UPDATE user_sessions
        SET allow_join = _new_privacy
        WHERE session_code = _session_code AND host_username = _host_username;
    END IF;


END;
$$ LANGUAGE plpgsql;


-- Update a session's host information
CREATE OR REPLACE FUNCTION update_session_host(
    _session_code INT,
    _session_passcode TEXT,
    _new_host_username TEXT,
    _old_host_username TEXT,
    _old_host_hashed_password TEXT
)
RETURNS VOID AS $$
DECLARE
    _new_host_user_id TEXT;
    _new_host_steam_id TEXT;
BEGIN

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _old_host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _old_host_username AND hashed_password = _old_host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Get the host user ID and Steam ID based on the new host username
    SELECT user_id, user_steam_id INTO _new_host_user_id, _new_host_steam_id
    FROM users WHERE username = _new_host_username LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'New host invalid' USING ERRCODE = '42501';
    END IF;

    -- Update the session with the new host information
    UPDATE user_sessions
    SET host_user_id = _new_host_user_id,
        host_username = _new_host_username,
        host_steam_id = _new_host_steam_id
    WHERE session_code = _session_code AND host_username = _old_host_username;

END;
$$ LANGUAGE plpgsql;

-- Update a session's session code
CREATE OR REPLACE FUNCTION update_session_code(
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_session_code INT
)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Update the session code
    UPDATE user_sessions
    SET session_code = _new_session_code
    WHERE session_code = _session_code AND host_username = _host_username;

END;
$$ LANGUAGE plpgsql;

-- Update a session's session passcode
CREATE OR REPLACE FUNCTION update_session_passcode(
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_session_passcode TEXT
)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Update the session passcode
    UPDATE user_sessions
    SET session_passcode = _new_session_passcode
    WHERE session_code = _session_code AND host_username = _host_username;

END;
$$ LANGUAGE plpgsql;


-- Update a session's session status string
CREATE OR REPLACE FUNCTION update_session_status(
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_session_status TEXT
)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Update the session status string
    UPDATE user_sessions
    SET session_status = _new_session_status
    WHERE session_code = _session_code AND host_username = _host_username;

END;
$$ LANGUAGE plpgsql;


-- Update a session's session beacon metadata
CREATE OR REPLACE FUNCTION update_session_beacon_metadata(
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_beacon_metadata TEXT
)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Update the session beacon metadata
    UPDATE user_sessions
    SET beacon_metadata = _new_beacon_metadata
    WHERE session_code = _session_code AND host_username = _host_username;

END;
$$ LANGUAGE plpgsql;


-- Update a session's session whitelist
CREATE OR REPLACE FUNCTION update_session_whitelist(
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_whitelist TEXT
)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Update the session whitelist
    UPDATE user_sessions
    SET session_whitelist = _new_whitelist
    WHERE session_code = _session_code AND host_username = _host_username;

END;
$$ LANGUAGE plpgsql;


-- Update a session's session blacklist
CREATE OR REPLACE FUNCTION update_session_blacklist(
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_blacklist TEXT
)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Update the session blacklist
    UPDATE user_sessions
    SET session_blacklist = _new_blacklist
    WHERE session_code = _session_code AND host_username = _host_username;

END;
$$ LANGUAGE plpgsql;


-- Update a session's session privacy setting
CREATE OR REPLACE FUNCTION update_session_privacy(
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_privacy TEXT
)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Update the session privacy
    UPDATE user_sessions
    SET allow_join = _new_privacy
    WHERE session_code = _session_code AND host_username = _host_username;

END;
$$ LANGUAGE plpgsql;
