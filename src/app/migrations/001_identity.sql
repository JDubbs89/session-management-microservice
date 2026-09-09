ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS services (
 service_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, credential_hash TEXT NOT NULL,
 scopes TEXT[] NOT NULL DEFAULT ARRAY['rooms:read','rooms:write','players:write'],
 enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS service_players (
 player_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subject TEXT NOT NULL,
 UNIQUE(tenant_id, subject)
);
CREATE TABLE IF NOT EXISTS rooms (
 room_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, service_id TEXT NOT NULL REFERENCES services(service_id),
 code TEXT NOT NULL, game TEXT NOT NULL, protocol TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 1000),
 public_address TEXT NOT NULL DEFAULT '', policy TEXT NOT NULL CHECK(policy IN ('public','private')),
 lease_until TIMESTAMPTZ NOT NULL, closed BOOLEAN NOT NULL DEFAULT FALSE,
 version INTEGER NOT NULL DEFAULT 1, UNIQUE(tenant_id, code)
);
CREATE TABLE IF NOT EXISTS room_members (
 room_id TEXT REFERENCES rooms(room_id) ON DELETE CASCADE,
 player_id TEXT REFERENCES service_players(player_id) ON DELETE CASCADE,
 joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(room_id,player_id)
);
CREATE TABLE IF NOT EXISTS room_bans (
 room_id TEXT REFERENCES rooms(room_id) ON DELETE CASCADE,
 player_id TEXT REFERENCES service_players(player_id) ON DELETE CASCADE, PRIMARY KEY(room_id,player_id)
);
