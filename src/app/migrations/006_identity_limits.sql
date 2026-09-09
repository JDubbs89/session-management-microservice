-- Preserve legacy primary IDs and all host references. Stable neutral subjects are additive.
ALTER TABLE users ADD COLUMN subject UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE users ADD CONSTRAINT users_subject_unique UNIQUE(subject);
ALTER TABLE users ALTER COLUMN user_steam_id DROP NOT NULL;
ALTER TABLE user_sessions ALTER COLUMN host_steam_id DROP NOT NULL;
CREATE TABLE account_external_identities (
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_subject TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY(provider, external_subject)
);
-- Historical IDs were self-asserted; they must never imply provider authentication.
INSERT INTO account_external_identities(user_id, provider, external_subject)
SELECT user_id, 'steam', user_steam_id FROM users
WHERE user_steam_id IS NOT NULL AND user_steam_id <> '';
CREATE TABLE rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    window_start BIGINT NOT NULL,
    hits BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limit_expiry ON rate_limit_buckets(expires_at);
