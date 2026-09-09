-- Import Tables
\i /docker-entrypoint-initdb.d/tables/users.sql
\i /docker-entrypoint-initdb.d/tables/user_friendships.sql
\i /docker-entrypoint-initdb.d/tables/user_friend_transactions.sql
\i /docker-entrypoint-initdb.d/tables/user_sessions.sql
\i /docker-entrypoint-initdb.d/tables/user_messages.sql

-- Import Stored Procedures
-- Friendships
\i /docker-entrypoint-initdb.d/procedures/Friendships/get_friend_requests.sql
\i /docker-entrypoint-initdb.d/procedures/Friendships/resolve_friend_request.sql
\i /docker-entrypoint-initdb.d/procedures/Friendships/send_friend_request.sql

-- Sessions
\i /docker-entrypoint-initdb.d/procedures/Sessions/create_session.sql
\i /docker-entrypoint-initdb.d/procedures/Sessions/delete_session.sql
\i /docker-entrypoint-initdb.d/procedures/Sessions/get_friend_sessions.sql
\i /docker-entrypoint-initdb.d/procedures/Sessions/get_session_by_session_code.sql
\i /docker-entrypoint-initdb.d/procedures/Sessions/get_session_by_steam_id.sql
\i /docker-entrypoint-initdb.d/procedures/Sessions/get_session_by_username.sql
\i /docker-entrypoint-initdb.d/procedures/Sessions/update_session.sql

-- Users
\i /docker-entrypoint-initdb.d/procedures/Users/create_new_user.sql
\i /docker-entrypoint-initdb.d/procedures/Users/delete_user.sql
\i /docker-entrypoint-initdb.d/procedures/Users/get_user.sql
\i /docker-entrypoint-initdb.d/procedures/Users/log_in_user.sql
\i /docker-entrypoint-initdb.d/procedures/Users/log_out_user.sql
\i /docker-entrypoint-initdb.d/procedures/Users/log_out_inactive_users.sql

-- Bootstrap the first administrator with app/bootstrap_admin.py.
