CREATE TABLE user_friendships (
    id SERIAL PRIMARY KEY,
    friend_1_id TEXT NOT NULL,
    friend_2_id TEXT NOT NULL,
    friendship_age DATE NOT NULL DEFAULT CURRENT_DATE
);