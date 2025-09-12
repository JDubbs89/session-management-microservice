-- Create a session entry
CREATE OR REPLACE FUNCTION create_session
    (_session_code INT, 
        _host_username TEXT, 
        _beacon_metadata TEXT, 
        _session_passcode TEXT DEFAULT '', 
        _session_status TEXT DEFAULT 'started', 
        _session_whitelist TEXT DEFAULT '{}', 
        _session_blacklist TEXT DEFAULT '{}', 
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
        RAISE EXCEPTION 'Host user not found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE _host_username = _host_username OR host_user_id = _host_user_id OR host_steam_id = _host_steam_id OR session_code = _session_code)
    THEN
        INSERT INTO user_sessions 
            (session_code, session_passcode, host_user_id, host_username, host_steam_id, beacon_metadata, session_status, session_whitelist, session_blacklist, allow_join)
        VALUES 
            (_session_code, _session_passcode, _host_user_id, _host_username, _host_steam_id, _beacon_metadata, _session_status, _session_whitelist, _session_blacklist, _allow_join);
    ELSE
        RAISE EXCEPTION 'Session already exists for this host';
    END IF;
    SELECT * INTO _new_session
    FROM user_sessions
    WHERE session_code = _session_code AND host_username = _host_username LIMIT 1;
    return _new_session;
END;
$$ LANGUAGE plpgsql;