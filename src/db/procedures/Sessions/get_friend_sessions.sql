CREATE OR REPLACE FUNCTION get_friend_sessions(
    _user_id TEXT
)
RETURNS user_sessions AS $$
DECLARE
    friend_sessions user_sessions%ROWTYPE;
BEGIN
    -- Fetch all friend names for easy session querying
    CREATE TEMPORARY TABLE FriendUsernames (username TEXT);

    INSERT INTO FriendUsernames (username)
    SELECT u.username
    FROM user_friendships uf
    JOIN users u ON (uf.friend_1_id = _user_id AND uf.friend_2_id = u.user_id)
                 OR (uf.friend_2_id = _user_id AND uf.friend_1_id = u.user_id);

    -- Fetch all sessions for each friend name in the previously fetched list
    SELECT us.* INTO friend_sessions
    FROM user_sessions us
    JOIN FriendUsernames fu ON us.host_username = fu.username
    WHERE us.host_id IS NOT NULL; -- Assuming host_id is a good indicator of a valid session

    -- Validate each session, removing ones that are not valid (don't have a host id, raised errors, etc.)
    -- The WHERE clause above handles the host_id validation. Additional validation can be added here if needed.

    -- Return the list of valid sessions
    RETURN friend_sessions;
END;
$$ LANGUAGE plpgsql;