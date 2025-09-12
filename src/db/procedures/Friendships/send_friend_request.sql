CREATE OR REPLACE FUNCTION send_friend_request(
    _sender_username TEXT,
    _recipient_username TEXT
)
RETURNS VOID AS $$
DECLARE
    _sender_id TEXT;
    _recipient_id TEXT;
BEGIN
    -- Get sender_id from sender_username
    SELECT user_id INTO _sender_id
    FROM users
    WHERE username = _sender_username;

    -- Get recipient_id from recipient_username
    SELECT user_id INTO _recipient_id
    FROM users
    WHERE username = _recipient_username;

    -- Check if both sender and recipient exist
    IF _sender_id IS NULL OR _recipient_id IS NULL THEN
        RAISE EXCEPTION 'Sender or recipient username not found.';
    END IF;

    -- Insert the friend request into the user_friend_transactions table
    INSERT INTO user_friend_transactions (sender_id, recipient_id)
    VALUES (_sender_id, _recipient_id);
END;
$$ LANGUAGE plpgsql;