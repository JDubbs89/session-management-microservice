-- Keep dormant SQL credential setters compatible with hashed passcodes.
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
        SET session_passcode = CASE WHEN _new_session_passcode = '' THEN '' ELSE crypt(_new_session_passcode, gen_salt('bf', 12)) END
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
    SET session_passcode = CASE WHEN _new_session_passcode = '' THEN '' ELSE crypt(_new_session_passcode, gen_salt('bf', 12)) END
    WHERE session_code = _session_code AND host_username = _host_username;

END;
$$ LANGUAGE plpgsql;
