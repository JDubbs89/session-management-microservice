CREATE TABLE user_messages ( -- A table for messages, primarily to be used for developer notices, or chat messages eventually
    id SERIAL PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'message', -- message, alert, request, reply
    message_content TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);