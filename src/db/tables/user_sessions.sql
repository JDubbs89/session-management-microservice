CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    session_code INT UNIQUE NOT NULL, -- For session lookup and host-agnostic join
    session_passcode TEXT,
    host_user_id TEXT UNIQUE NOT NULL, -- GUID for the host user
    host_username TEXT UNIQUE NOT NULL,
    host_steam_id TEXT UNIQUE NOT NULL, -- The host user's steam id, which can be utilized for session lookup
    beacon_metadata TEXT DEFAULT '{}', -- JSON for metadata related to online beacons; using this instead of ip information for security/privacy
    session_status TEXT NOT NULL, -- started, ready, active, ended, crashed, inactive, idle
    session_whitelist TEXT DEFAULT '[]', -- JSON, username and steam id pairs
    session_blacklist TEXT DEFAULT '[]', -- JSON, username and steam id pairs
    allow_join TEXT NOT NULL DEFAULT 'public' -- public, private, friends only
);
