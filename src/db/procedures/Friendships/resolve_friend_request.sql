CREATE OR REPLACE FUNCTION resolve_friend_request(
    _request_id INT,
    _resolution TEXT -- 'accept' or 'reject'
)
RETURNS VOID AS $$
DECLARE
    _sender_id TEXT;
    _recipient_id TEXT;
BEGIN
    -- Get sender and recipient IDs from the friend request
    SELECT sender_id, recipient_id INTO _sender_id, _recipient_id
    FROM user_friend_transactions
    WHERE id = _request_id AND transaction_status = 'pending';

    -- If no pending request found, exit
    IF _sender_id IS NULL THEN
        RETURN;
    END IF;

    IF _resolution = 'accept' THEN
        -- Update transaction status to accepted
        UPDATE user_friend_transactions
        SET transaction_status = 'accepted'
        WHERE id = _request_id;

        -- Create a new friendship entry
        INSERT INTO user_friendships (friend_1_id, friend_2_id)
        VALUES (_sender_id, _recipient_id);
    ELSIF _resolution = 'reject' THEN
        -- Update transaction status to rejected
        UPDATE user_friend_transactions
        SET transaction_status = 'rejected'
        WHERE id = _request_id;
    END IF;
END;
$$ LANGUAGE plpgsql;