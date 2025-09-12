DROP TABLE IF EXISTS user_friend_transactions;

CREATE TABLE user_friend_transactions (
    id SERIAL PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    transaction_status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, rejected
    expire_date DATE NOT NULL DEFAULT CURRENT_DATE + INTERVAL '30 days'
);