CREATE OR REPLACE FUNCTION log_out_inactive_users()
RETURNS VOID AS $$
BEGIN
    UPDATE users
    SET user_online = FALSE
    WHERE user_online = TRUE AND last_activity < NOW() - INTERVAL '10 minutes';
END;
$$ LANGUAGE plpgsql;