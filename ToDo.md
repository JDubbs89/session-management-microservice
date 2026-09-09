# Project roadmap

## Goal

Provide identity, presence, and session discovery to trusted server-based services, such as a Node.js WebSocket game. The game server owns rooms, membership, questions, timers, scoring, and realtime connections. FastAPI owns persistent accounts and session records; PostgreSQL stays private. Browsers connect to the game server, which calls this API on their behalf.

The current player JWT flow supports the example, but is not yet a complete service-to-service authentication model. Steam identifiers and the `beacon_metadata` name are legacy compatibility fields, not requirements of the intended architecture.

## Baseline work included in this revision

- [x] Replace the P2P-focused README and placeholder installation instructions with a server-based architecture and local setup.
- [x] Add a Node.js WebSocket trivia example with an API client covering all 15 current application endpoints and a separate admin workflow.
- [x] Correct immediate session lookup/mapping and ownership defects, account deletion password handling, and password hashing compatibility.
- [x] Remove secret logging, the invalid default admin seed, and volume-deleting startup commands; provide an explicit admin bootstrap command.
- [x] Add a standalone Docker Compose demo with separate game, API, and PostgreSQL containers, persistent initialization, readiness checks, and internal game-to-API networking. Live container validation remains pending.
- [x] Bundle SQL initialization files in the PostgreSQL image with readable permissions instead of a host bind mount, fixing the reported initialization-directory access failure. Preserve the existing database volume during rebuilds.
- [x] Refactor the trivia UI into account, lobby, room, question, and results screens with responsive layouts, room-code joining, loading states, and confirmed answer locking.
- [x] Add backend regression tests and example tests, with mock mode clearly separated from live API integration.

These changes establish a development starting point. The acceptance checks below remain open until verified against PostgreSQL and the intended deployment environment.

## P0 — Establish a reliable baseline

- [ ] Run the API against a fresh PostgreSQL 16 database and exercise every registered route, then repeat against a restarted database with persisted data. Verify initialization fails visibly on SQL errors.
- [ ] Add versioned migrations. Keep initialization scripts for new databases only; document upgrades and backups without deleting volumes.
- [ ] Pin and audit Python dependencies; establish supported Python/Node versions and reproducible development/test installation.
- [ ] Validate configuration on startup, including database URL, token secret, and expiry. Remove obsolete configuration variables and document development versus deployment settings.
- [ ] Give database failures stable public error codes (conflict, forbidden, not found, unavailable), with rollback and internal structured logs. Never return SQL, passwords, JWTs, or secrets to clients.
- [ ] Standardize request and response models, success status codes, and OpenAPI examples. Add bounds for names, passwords, codes, metadata, and pagination; reject unknown session update keys.
- [ ] Verify all host identities are derived from authenticated users and every session mutation checks the stored owner. Test attempted ownership spoofing and foreign-session updates/deletes.
- [ ] Decide whether session passcodes remain necessary; hash them if retained and remove passcodes and access lists from discovery responses. Avoid credentials in query strings.

Acceptance: documented clean setup works; the trivia lifecycle and API smoke tests pass; restarting does not erase accounts; sensitive fields do not appear in logs or discovery responses.

## P1 — Make server-based services first-class

- [ ] Introduce service identities with rotatable credentials and scoped permissions. Separate service authentication from player identity and admin operations; require explicit authorization for acting on behalf of a player.
- [ ] Add application/tenant scoping to identities and sessions, including database uniqueness and authorization checks. Test cross-service isolation.
- [ ] Replace mandatory Steam identity with a provider-neutral subject and optional external identities. Generate internal IDs server-side; migrate legacy users and hosts.
- [ ] Replace host-user-only session ownership with an authenticated service/server owner. Support multiple rooms per server and explicit player membership.
- [ ] Define session metadata for a server-hosted game: game/type, room ID, protocol/version, capacity, and an approved public connection address. Keep internal addresses and credentials private.
- [ ] Define create, discover, join, leave, close, and heartbeat contracts. Make joins atomic and enforce capacity, access policy, bans, and membership on the server.
- [ ] Add expiring session leases, heartbeat renewal, stale-session cleanup, and crash recovery. Define reconnect grace periods and authoritative presence semantics.
- [ ] Add idempotency or optimistic concurrency for retries and simultaneous updates. Test code collisions, duplicate joins, and competing room mutations.
- [ ] Introduce clear resource-oriented routes with a compatibility/deprecation plan for `/read_friend_session*` and `beacon_metadata`.
- [ ] Rate-limit by authenticated service/player as well as IP. A shared Node server currently concentrates users behind one address; define trusted proxy handling and distributed limiter storage.
- [ ] Define token revocation/refresh behavior. Logging out currently rejects requests while the account is offline, but previously issued unexpired JWTs can become usable again after another login. Add persistent token/session revocation.

Acceptance: two independent game servers can manage several rooms without impersonating players or seeing another application's data; crashed servers disappear from discovery after a documented lease period.

## P2 — Finish or explicitly defer incomplete functions

- [ ] Decide whether friendships and persistent messages belong in this service. The router files are currently empty and are not registered HTTP endpoints.
- [ ] If retaining friendships, implement authenticated send/list/accept/reject/cancel/remove routes. Only the recipient may resolve a request; reject self-requests, duplicates, expired requests, and invalid transitions.
- [ ] Repair `get_friend_sessions.sql`: it references nonexistent `host_id`, returns one row rather than a list, and creates a temporary table that is not cleaned up. Add paginated discovery and access-policy tests.
- [ ] Add foreign keys, cleanup policies, and unique constraints for friendships, requests, and messages; enforce one undirected friendship per pair.
- [ ] If retaining messages, implement sender-derived identity, recipient authorization, pagination, read state, retention, and abuse limits. Keep realtime trivia chat/game events in the Node server.
- [ ] Audit unused Steam lookup and inactivity SQL functions alongside live routes. Repair the legacy `update_session.sql` code-first update ordering before reusing it; the active HTTP update path uses a separate atomic SQL update. Define timestamp timezone and heartbeat behavior before scheduling inactivity cleanup.
- [ ] Add account deletion cleanup for owned sessions, friendships, requests, and messages, with documented transactional semantics.

Acceptance: each retained capability has routes, documented contracts, authorization tests, and database integration coverage; deferred capabilities are clearly marked rather than advertised as working.

## P3 — Testing and release readiness

- [ ] Add CI that runs Python tests, Node tests, syntax/lint checks, and fresh-database integration tests using an isolated PostgreSQL service.
- [ ] Cover registration, duplicate identities, valid/invalid login, `/me`, role restrictions, admin bootstrap, logout, self-delete, and admin-delete. Include missing, expired, tampered, and wrong-role tokens.
- [ ] Cover session creation, all three discovery endpoints, updates, deletion, and missing records. Test public/private/friends-only access, passcodes, whitelist/blacklist precedence, invalid JSON, and unauthorized mutations.
- [ ] Execute every application endpoint against the real API from the example, including the separate privileged operator lifecycle. Assert responses and postconditions; a mocked request alone is not integration coverage.
- [ ] Add WebSocket end-to-end tests with two players: account flow, room creation/discovery/join, synchronized rounds, one answer per player, score calculation, final results, replay, disconnect, and cleanup.
- [ ] Test failure handling: API timeout/unavailability, rate limits, expired tokens, database restart, host disconnect, and failed room cleanup. Ensure the UI reports failures and allows recovery.
- [ ] Load-test concurrent joins, shared-IP requests, websocket connections, and database pool limits. Establish latency/error targets before claiming capacity.
- [ ] Split liveness from readiness; add database readiness checks, request IDs, structured logging, metrics, and graceful shutdown.
- [ ] Document deployment behind TLS with private API/database networking, explicit browser-origin policy, secret injection, backups/restore, and least-privilege database access.

Acceptance: CI catches contract and authorization regressions, the complete example passes on a fresh database, and operational recovery is documented and exercised.

## Example implementation

See [`example-implementation/`](example-implementation/) for the Node.js WebSocket trivia game, setup, endpoint mapping, and test commands. Use ordinary player workflows for gameplay and a separate operator script for admin-only endpoints. Do not expose administrator credentials to the browser.
