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
