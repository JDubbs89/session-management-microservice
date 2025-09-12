-- Stored procedure to remove a user
CREATE OR REPLACE FUNCTION delete_user(_name TEXT, _hashed_password TEXT,_executor_name TEXT, _executor_hashed_password TEXT)
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _name AND hashed_password = _hashed_password) THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _executor_name AND hashed_password = _executor_hashed_password) THEN
        RAISE EXCEPTION 'Executing User not found';
    END IF;

    IF NOT _executor_name = _name AND _executor_hashed_password = _hashed_password
    THEN
        IF NOT EXISTS (SELECT 1 FROM users WHERE username = _executor_name AND hashed_password = _executor_hashed_password AND user_role = 'admin') 
        THEN
            RAISE EXCEPTION 'Insufficient permissions or incorrect password';
        END IF;
    END IF;

    DELETE FROM users WHERE username = _name AND hashed_password = _hashed_password;
END;
$$ LANGUAGE plpgsql;