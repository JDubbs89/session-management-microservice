-- Preserve existing social data: refuse ambiguous/orphaned rows for operator repair.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM user_friendships f WHERE f.friend_1_id = f.friend_2_id
        OR NOT EXISTS (SELECT 1 FROM users WHERE user_id=f.friend_1_id)
        OR NOT EXISTS (SELECT 1 FROM users WHERE user_id=f.friend_2_id))
    OR EXISTS (SELECT 1 FROM user_friendships GROUP BY LEAST(friend_1_id,friend_2_id), GREATEST(friend_1_id,friend_2_id) HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM user_friend_transactions f WHERE f.sender_id=f.recipient_id
        OR transaction_status NOT IN ('pending','accepted','rejected','cancelled')
        OR NOT EXISTS (SELECT 1 FROM users WHERE user_id=f.sender_id)
        OR NOT EXISTS (SELECT 1 FROM users WHERE user_id=f.recipient_id))
    OR EXISTS (SELECT 1 FROM user_friend_transactions WHERE transaction_status='pending'
        GROUP BY LEAST(sender_id,recipient_id),GREATEST(sender_id,recipient_id) HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM user_messages m WHERE
        NOT EXISTS (SELECT 1 FROM users WHERE user_id=m.sender_id)
        OR NOT EXISTS (SELECT 1 FROM users WHERE user_id=m.recipient_id))
    OR EXISTS (SELECT 1 FROM user_sessions s WHERE NOT EXISTS (SELECT 1 FROM users WHERE user_id=s.host_user_id)) THEN
        RAISE EXCEPTION 'Legacy social/session data violates integrity rules; back up and repair orphaned, self, duplicate, or invalid-status records before migration 005. No records were deleted.';
    END IF;
END $$;
ALTER TABLE user_friendships
    ADD CONSTRAINT friendship_first_user_fk FOREIGN KEY(friend_1_id) REFERENCES users(user_id) ON DELETE CASCADE,
    ADD CONSTRAINT friendship_second_user_fk FOREIGN KEY(friend_2_id) REFERENCES users(user_id) ON DELETE CASCADE,
    ADD CONSTRAINT friendship_no_self CHECK(friend_1_id <> friend_2_id);
CREATE UNIQUE INDEX friendship_undirected_pair ON user_friendships(LEAST(friend_1_id,friend_2_id),GREATEST(friend_1_id,friend_2_id));
ALTER TABLE user_friend_transactions
    ADD CONSTRAINT request_sender_fk FOREIGN KEY(sender_id) REFERENCES users(user_id) ON DELETE CASCADE,
    ADD CONSTRAINT request_recipient_fk FOREIGN KEY(recipient_id) REFERENCES users(user_id) ON DELETE CASCADE,
    ADD CONSTRAINT request_no_self CHECK(sender_id <> recipient_id),
    ADD CONSTRAINT request_status CHECK(transaction_status IN ('pending','accepted','rejected','cancelled'));
CREATE UNIQUE INDEX request_pending_pair ON user_friend_transactions(LEAST(sender_id,recipient_id),GREATEST(sender_id,recipient_id)) WHERE transaction_status='pending';
ALTER TABLE user_messages
    ADD CONSTRAINT message_sender_fk FOREIGN KEY(sender_id) REFERENCES users(user_id) ON DELETE CASCADE,
    ADD CONSTRAINT message_recipient_fk FOREIGN KEY(recipient_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE user_sessions ADD CONSTRAINT legacy_session_host_fk FOREIGN KEY(host_user_id) REFERENCES users(user_id) ON DELETE CASCADE;
-- Historical naive timestamps are interpreted as UTC; see docs/legacy-social.md.
ALTER TABLE users ALTER COLUMN last_activity TYPE TIMESTAMPTZ USING last_activity AT TIME ZONE 'UTC';
ALTER TABLE user_messages ALTER COLUMN sent_at TYPE TIMESTAMPTZ USING sent_at AT TIME ZONE 'UTC';
DROP FUNCTION IF EXISTS get_friend_sessions(TEXT);
-- Private database compatibility function; callers must authenticate _user_id.
-- Access lists and passcode hashes are scrubbed even for direct SQL discovery.
CREATE OR REPLACE FUNCTION get_friend_sessions(
    _user_id TEXT, _limit INTEGER DEFAULT 50, _offset INTEGER DEFAULT 0
)
RETURNS SETOF user_sessions AS $$
DECLARE
    _username TEXT;
    _session user_sessions%ROWTYPE;
BEGIN
    IF _limit IS NULL OR _limit < 1 OR _limit > 100 OR _offset IS NULL OR _offset < 0 THEN
        RAISE EXCEPTION 'Invalid pagination' USING ERRCODE = '22023';
    END IF;
    SELECT username INTO _username FROM users WHERE user_id = _user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User does not exist' USING ERRCODE = 'P0002';
    END IF;
    FOR _session IN
        SELECT s.* FROM user_sessions s
        WHERE EXISTS (
            SELECT 1 FROM user_friendships f
            WHERE (f.friend_1_id = _user_id AND f.friend_2_id = s.host_user_id)
               OR (f.friend_2_id = _user_id AND f.friend_1_id = s.host_user_id)
        )
        AND s.session_status NOT IN ('ended', 'crashed', 'inactive')
        AND NOT (COALESCE(s.session_blacklist, '[]')::jsonb ? _username)
        AND (s.allow_join IN ('public', 'friends only') OR
             (s.allow_join = 'private' AND COALESCE(s.session_whitelist, '[]')::jsonb ? _username))
        ORDER BY s.id LIMIT _limit OFFSET _offset
    LOOP
        _session.session_passcode := NULL;
        _session.session_whitelist := NULL;
        _session.session_blacklist := NULL;
        RETURN NEXT _session;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION update_session( -- Function only changes metadata, not the actual host data
    _session_code INT,
    _host_username TEXT,
    _host_hashed_password TEXT,
    _session_passcode TEXT,
    _new_session_code INT DEFAULT NULL,
    _new_session_passcode TEXT DEFAULT NULL,
    _new_session_status TEXT DEFAULT NULL,
    _new_beacon_metadata TEXT DEFAULT NULL,
    _new_whitelist TEXT DEFAULT NULL,
    _new_blacklist TEXT DEFAULT NULL,
    _new_privacy TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    -- Check if the session exists
    IF NOT EXISTS (SELECT 1 FROM user_sessions WHERE session_code = _session_code AND host_username = _host_username) THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    -- Check if the host user exists and has the correct password
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = _host_username AND hashed_password = _host_hashed_password) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
    END IF;

    -- Keep code rotation and metadata changes in the same row update.
    UPDATE user_sessions
    SET session_code = COALESCE(_new_session_code, session_code),
        session_passcode = CASE WHEN _new_session_passcode IS NULL THEN session_passcode
            WHEN _new_session_passcode = '' THEN ''
            ELSE crypt(_new_session_passcode, gen_salt('bf', 12)) END,
        session_status = COALESCE(_new_session_status, session_status),
        beacon_metadata = COALESCE(_new_beacon_metadata, beacon_metadata),
        session_whitelist = COALESCE(_new_whitelist, session_whitelist),
        session_blacklist = COALESCE(_new_blacklist, session_blacklist),
        allow_join = COALESCE(_new_privacy, allow_join)
    WHERE session_code = _session_code AND host_username = _host_username;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

END;
$$ LANGUAGE plpgsql;


