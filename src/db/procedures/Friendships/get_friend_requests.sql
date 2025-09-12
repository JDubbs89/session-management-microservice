CREATE OR REPLACE FUNCTION get_friend_requests(
    _user_id TEXT
)
RETURNS SETOF user_friend_transactions AS $$
BEGIN
    -- Select all pending friend requests where the current user is the recipient
    RETURN QUERY
    SELECT *
    FROM user_friend_transactions
    WHERE recipient_id = _user_id AND transaction_status = 'pending';
END;
$$ LANGUAGE plpgsql;