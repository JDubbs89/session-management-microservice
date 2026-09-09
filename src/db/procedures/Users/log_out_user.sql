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
