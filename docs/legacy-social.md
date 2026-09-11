# Legacy social capability decision

Friendship management is available through authenticated account routes. Persistent messaging remains deferred and its empty router is unregistered. Historical SQL functions remain private compatibility helpers; browsers use the game server and never access PostgreSQL directly.

| Method and path | Body / result |
| --- | --- |
| `GET /friends` | Friends with `user_id`, `username`, `friendship_age` |
| `GET /friends/requests` | Unexpired pending incoming/outgoing requests with IDs, names, status, expiry |
| `POST /friends/requests` | `{ "username": "recipient" }`; returns request, HTTP 201 |
| `POST /friends/requests/{request_id}` | `{ "action": "accept" }`, `reject`, or `cancel` |
| `DELETE /friends/{friend_id}` | Remove your friendship using the listed account ID; HTTP 204 |

All routes require a user/admin Bearer token and use the existing authenticated player and edge rate limits. Identities are derived from authentication. Only the recipient may accept/reject, and only the sender may cancel. Outsiders cannot inspect or change another pair's requests. Lists accept `limit` (1–100, default 50) and `offset` (0–100000), ordered by row ID. No passwords, tokens, or external identities appear in social responses.

Self-requests, existing friends, duplicate or opposite-direction pending requests, and repeated/expired transitions return 409. Unauthorized participant transitions return 403; unknown targets and outsider request IDs return 404. Requests expire after 30 calendar days and remain valid through their `expire_date` in database time. Expired pending rows are omitted from lists; sending a new request for the pair atomically cancels them. Pair-level transaction locks and unique constraints serialize sends, resolutions, and removals. Acceptance inserts the friendship and resolves the request in one transaction. This is the account social graph, separate from tenant-scoped service players.

Existing social records are retained. Migration 005 adds foreign keys with cascading deletion for both participants of friendships, requests, and messages, and for legacy session hosts. A single account DELETE removes those dependent records in the same PostgreSQL transaction; rollback restores everything. Messages involving a deleted account are deleted, including those in the other participant's history. Service players and rooms have a separate identity model; deleting a legacy account does not implicitly delete them.

One undirected friendship and one pending request per pair are enforced. Historical resolved requests and multiple messages remain valid. The migration fails with an actionable error for orphaned references, self-friendships/requests, duplicate friendships/pending requests, or unknown request states. It does not silently discard user data. Back up, inspect and resolve these records under your retention policy, then rerun the migration. Expired pending requests are cancelled atomically when a new request for that pair is sent.

`get_friend_sessions(user_id, limit=50, offset=0)` now returns a list ordered by session row ID, accepts limits 1–100, and rejects negative offsets. Its caller must authenticate the supplied user ID. It includes only friends' non-ended/non-crashed/non-inactive sessions; blacklist overrides whitelist, private sessions require whitelist, and public/friends-only sessions permit friends. Existing compatibility rules let friends bypass session passcodes. Returned passcodes and access lists are NULL. Repeated calls create no temporary tables. This SQL function does not create a friendship discovery HTTP route.

The unused Steam lookup was reviewed: its full lookup checks the requester, blacklist, private whitelist, friendship and hashed passcode in the same way as username lookup. Steam identifiers remain optional legacy compatibility identifiers; new services should use provider-neutral player subjects. The preview helper returns user-supplied legacy metadata and status without access checks, and is not a public route. Do not reuse it for private room discovery. Legacy `update_session` now changes code and other fields in one atomic UPDATE, preserving other requested changes during code rotation; unique-code conflicts roll back all changes. The dormant SQL helpers take stored password hashes and are not suitable authentication APIs.

Migration 005 interprets historical `users.last_activity` and `user_messages.sent_at` timestamps as UTC and converts them to `TIMESTAMPTZ`. If an installation stored local wall-clock time, normalize those values to UTC before upgrading. New timestamps use database current time and retain absolute instants independent of connection timezone. Friendship/request calendar dates remain dates.

Do not schedule `log_out_inactive_users()`: it merely changes a legacy online hint after ten minutes, does not revoke JWTs, and is not authoritative presence. JWT validity uses expiry and the persistent token version; legacy activity does not extend token expiry. Service room leases and authenticated heartbeats establish new room availability. An expired token requires login again; legacy inactivity must not be interpreted as logout or room liveness.

Run `INTEGRATION_TEST_DATABASE=1 python tests/integration/legacy-p2.py` with the normal API environment pointed at a disposable initialized database. The script migrates it and rolls back its test fixtures.

Run `INTEGRATION_TEST_DATABASE=1 python tests/integration/friendships.py` against a disposable running API/database to verify HTTP authorization, concurrent transitions, expiry, pagination, and deletion cleanup.
