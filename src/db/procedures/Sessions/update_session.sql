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

    -- Keep code rotation and metadata changes in the same row update.
    UPDATE user_sessions
    SET session_code = COALESCE(_new_session_code, session_code),
        session_passcode = CASE WHEN _new_session_passcode IS NULL THEN session_passcode
            WHEN _new_session_passcode = '' THEN ''
            ELSE crypt(_new_session_passcode, gen_salt('bf', 12)) END,
        session_status = COALESCE(_new_session_status, session_status),
        beacon_metadata = COALESCE(_new_beacon_metadata, beacon_metadata),
        session_whitelist = COALESCE(_new_whitelist, session_whitelist),
        session_blacklist = COALESCE(_new_blacklist, session_blacklist),
        allow_join = COALESCE(_new_privacy, allow_join)
    WHERE session_code = _session_code AND host_username = _host_username;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
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
    SET session_passcode = CASE WHEN _new_session_passcode = '' THEN '' ELSE crypt(_new_session_passcode, gen_salt('bf', 12)) END
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
