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
