DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL, -- Unique identifier for the user
    user_steam_id TEXT UNIQUE NOT NULL, -- Unique identifier for the user's Steam account
    username TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    user_online BOOL DEFAULT FALSE, -- Whether or not the user is online/logged in.
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_role TEXT NOT NULL DEFAULT 'user'  -- roles: user, admin
    --flags TEXT NOT NULL  -- flags can denote different attributes; each flag has a key/value, such as ["create tables":"false", "select from users":"true"]
);