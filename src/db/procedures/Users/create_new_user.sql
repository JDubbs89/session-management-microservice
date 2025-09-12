-- Stored procedure to add a user
CREATE OR REPLACE FUNCTION create_new_user(_user_id TEXT, _steam_id TEXT, _name TEXT, _hashed_password TEXT, _role TEXT DEFAULT 'user', _overwrite BOOL DEFAULT false)
RETURNS VOID AS $$
BEGIN
    IF _overwrite OR NOT EXISTS (SELECT 1 FROM users WHERE username = _name OR user_id = _user_id OR user_steam_id = _steam_id) THEN
        INSERT INTO users (user_id, user_steam_id, username, hashed_password, user_role) VALUES (_user_id, _steam_id, _name, _hashed_password, _role);
    ELSE
        RAISE EXCEPTION 'Failed to create user';
    END IF;
END;
$$ LANGUAGE plpgsql;