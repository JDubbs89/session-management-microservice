-- Delete a session entry from the database
CREATE OR REPLACE FUNCTION delete_session(_session_code INT, _host_username TEXT, _session_passcode TEXT)
RETURNS VOID AS $$
BEGIN

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username)
    THEN
        RAISE EXCEPTION 'Authorization failed';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username AND session_passcode = _session_passcode)
    THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    DELETE FROM user_sessions
    WHERE session_code = _session_code
    AND host_username = _host_username
    AND session_passcode = _session_passcode;

END;
$$ LANGUAGE plpgsql;