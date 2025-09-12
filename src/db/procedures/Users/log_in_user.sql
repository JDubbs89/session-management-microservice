-- Stored procedure to log in as a user
CREATE OR REPLACE FUNCTION log_in_user(_user_id TEXT, _hashed_password TEXT)
RETURNS VOID AS $$
DECLARE
    _user users%ROWTYPE;
BEGIN
    
    SELECT * INTO _user FROM users WHERE user_id = _user_id AND hashed_password = _hashed_password LIMIT 1;
    IF _user IS NULL
    THEN
        RAISE EXCEPTION 'User not found or insufficient credentials';
    END IF;

    IF _user.user_online
    THEN
        RAISE EXCEPTION 'User is already logged in elsewhere...';
    END IF;

    UPDATE users
    SET user_online = TRUE,
    last_activity = CURRENT_TIMESTAMP
    WHERE user_id = _user_id AND _hashed_password = _hashed_password;

END;
$$ LANGUAGE plpgsql;