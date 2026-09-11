# Project roadmap

## Goal

Provide identity, presence, and session discovery to trusted server-based services, such as a Node.js WebSocket game. The game server owns rooms, membership, questions, timers, scoring, and realtime connections. FastAPI owns persistent accounts and session records; PostgreSQL stays private. Browsers connect to the game server, which calls this API on their behalf.

The `/v1` API supports tenant-scoped service identities, delegated players, and leased rooms. The player JWT flow supports the legacy example. Steam identifiers and the `beacon_metadata` name remain compatibility fields; new accounts and service players use provider-neutral identities.

## Baseline work included in this revision

- [x] Replace the P2P-focused README and placeholder installation instructions with a server-based architecture and local setup.
- [x] Add a Node.js WebSocket trivia example with an API client covering all 15 current application endpoints and a separate admin workflow.
- [x] Correct immediate session lookup/mapping and ownership defects, account deletion password handling, and password hashing compatibility.
- [x] Remove secret logging, the invalid default admin seed, and volume-deleting startup commands; provide an explicit admin bootstrap command.
- [x] Add a standalone Docker Compose demo with separate game, API, and PostgreSQL containers, persistent initialization, readiness checks, and internal game-to-API networking. Live container validation remains pending.
- [x] Bundle SQL initialization files in the PostgreSQL image with readable permissions instead of a host bind mount, fixing the reported initialization-directory access failure. Preserve the existing database volume during rebuilds.
- [x] Refactor the trivia UI into account, lobby, room, question, and results screens with responsive layouts, room-code joining, loading states, and confirmed answer locking.
- [x] Complete example HTTP cookie authentication, authenticated WebSocket upgrades, refresh/reconnect identity restoration, explicit logout/deletion, and expiry handling with mock regression coverage. Live browser/PostgreSQL validation remains open.
- [x] Add backend regression tests and example tests, with mock mode clearly separated from live API integration.

These changes establish a development starting point. The acceptance checks below remain open until verified against PostgreSQL and the intended deployment environment.

## P0 — Establish a reliable baseline

- [x] Run the API against a fresh PostgreSQL 16 database and exercise every registered route, then repeat against a restarted database with persisted data. Verify initialization fails visibly on SQL errors.
- [x] Add versioned migrations. Keep initialization scripts for new databases only; document upgrades and backups without deleting volumes.
- [x] Pin and audit Python dependencies; establish supported Python/Node versions and reproducible development/test installation.
- [x] Validate configuration on startup, including database URL, token secret, and expiry. Remove obsolete configuration variables and document development versus deployment settings.
- [x] Give database failures stable public error codes (conflict, forbidden, not found, unavailable), with rollback and internal structured logs. Never return SQL, passwords, JWTs, or secrets to clients.
- [x] Standardize request and response models, success status codes, and OpenAPI examples. Add bounds for names, passwords, codes, metadata, and pagination; reject unknown session update keys.
- [x] Verify all host identities are derived from authenticated users and every session mutation checks the stored owner. Test attempted ownership spoofing and foreign-session updates/deletes.
- [x] Decide whether session passcodes remain necessary; hash them if retained and remove passcodes and access lists from discovery responses. Avoid credentials in query strings.

Verified on 2026-09-09 using rootless Podman with PostgreSQL 16: fresh initialization, all 15 application endpoints plus readiness before/after restart, migration reruns/checksums/rollback, existing-passcode upgrade, initialization failure, and the real two-player trivia lifecycle. Runtime dependency audit reports no known vulnerabilities. See [operations and verification instructions](docs/operations.md). Existing single-session lookup endpoints have no pagination requirement. The exact Docker Compose startup remains unverified on this host: the socket exists, but access is denied and sudo requires a password.

Acceptance: documented clean setup works; the trivia lifecycle and API smoke tests pass; restarting does not erase accounts; sensitive fields do not appear in logs or discovery responses.

## P1 — Make server-based services first-class

- [x] Introduce service identities with rotatable credentials and scoped permissions. Separate service authentication from player identity and admin operations; require explicit authorization for acting on behalf of a player.
- [x] Add application/tenant scoping to identities and sessions, including database uniqueness and authorization checks. Test cross-service isolation.
- [x] Replace mandatory Steam identity with a provider-neutral subject and optional external identities. Generate internal IDs server-side; migrate legacy users and hosts.
- [x] Replace host-user-only session ownership with an authenticated service/server owner. Support multiple rooms per server and explicit player membership.
- [x] Define session metadata for a server-hosted game: game/type, room ID, protocol/version, capacity, and an approved public connection address. Keep internal addresses and credentials private.
- [x] Define create, discover, join, leave, close, and heartbeat contracts. Make joins atomic and enforce capacity, access policy, bans, and membership on the server.
- [x] Add expiring session leases, heartbeat renewal, stale-session cleanup, and crash recovery. Define reconnect grace periods and authoritative presence semantics.
- [x] Add idempotency or optimistic concurrency for retries and simultaneous updates. Test code collisions, duplicate joins, and competing room mutations.
- [x] Introduce clear resource-oriented routes with a compatibility/deprecation plan for `/read_friend_session*` and `beacon_metadata`.
- [x] Rate-limit by authenticated service/player as well as IP. A shared Node server currently concentrates users behind one address; define trusted proxy handling and distributed limiter storage.
- [x] Validate token-version revocation against PostgreSQL, including logout followed by login and API/game restarts, and define a refresh policy. The API already increments the persistent account token version on logout and checks it during authentication; the example also rejects locally revoked cookies until expiry.

Verified on 2026-09-09: scoped/rotated credentials, cross-tenant and same-tenant ownership/grants, concurrent capacity and heartbeat conflicts, expiry/code reuse, neutral registration, persistent token revocation, and PostgreSQL rate counters. [Service contract](docs/services.md), [identity policy](docs/identity.md), and [legacy transition](docs/api-transition.md) document the behavior. The existing trivia demo remains on the compatibility API.

Acceptance: two independent game servers can manage several rooms without impersonating players or seeing another application's data; crashed servers disappear from discovery after a documented lease period.

## P2 — Finish or explicitly defer incomplete functions

- [x] Restore authenticated friendship management under `/friends`. Persistent messaging remains deferred; its empty router is unregistered.
- [x] Implement authenticated send/list/accept/reject/cancel/remove, recipient-only resolution, self/duplicate/expiry checks, serialized pair transitions, pagination, and HTTP integration coverage.
- [x] Repair `get_friend_sessions.sql` to return paginated rows without temporary tables; verify blacklist/private/friends policy and scrub passcodes/access lists.
- [x] Add cascading foreign keys and social uniqueness constraints, including one undirected friendship and one pending request per pair. Fail upgrades visibly on invalid historical records rather than discard data.
- [x] Record deferred messaging requirements: sender-derived identity, recipient authorization, pagination/read state, retention, and abuse controls before enabling a messaging API.
- [x] Audit Steam lookup and inactivity helpers; repair atomic code/metadata updates in legacy `update_session.sql`. Convert historical timestamps under a documented UTC assumption. Leave the legacy inactivity job unscheduled; service leases define room presence.
- [x] Verify transactional account deletion cleanup for owned legacy sessions, friendships, requests, messages, and external identity mappings.

Verified with PostgreSQL 16 on 2026-09-09: paginated discovery/access policy, unique-pair constraints, code rotation/conflict rollback, and cascading deletion/rollback. See [legacy social decisions and migration prerequisites](docs/legacy-social.md). Friendship HTTP lifecycle, authorization, expiry, concurrency, and cascading account deletion verified against PostgreSQL on 2026-09-11. Messaging remains deferred.

Acceptance: each retained capability has documented contracts, authorization or database-integrity checks, and integration coverage; deferred capabilities are clearly marked rather than advertised as working.

## P3 — Testing and release readiness

- [x] Add CI that runs Python tests, Node tests, syntax/lint checks, and fresh-database integration tests using an isolated PostgreSQL service.
- [x] Cover registration, duplicate identities, valid/invalid login, `/me`, role restrictions, admin bootstrap, logout, self-delete, and admin-delete. Include missing, expired, tampered, and wrong-role tokens.
- [x] Cover session creation, all three discovery endpoints, updates, deletion, and missing records. Test public/private/friends-only access, passcodes, whitelist/blacklist precedence, invalid JSON, and unauthorized mutations.
- [x] Execute every application endpoint against the real API from the example, including the separate privileged operator lifecycle. Assert responses and postconditions; a mocked request alone is not integration coverage.
- [x] Add WebSocket end-to-end tests with two players: account flow, room creation/discovery/join, synchronized rounds, one answer per player, score calculation, final results, replay, disconnect, and cleanup.
- [x] Test failure handling: API timeout/unavailability, rate limits, expired tokens, database restart, host disconnect, and failed room cleanup. Ensure the UI reports failures and allows recovery.
- [x] Load-test concurrent joins, shared-IP requests, websocket connections, and database pool limits. Establish latency/error targets before claiming capacity.
- [x] Split liveness from readiness; add database readiness checks, request IDs, structured logging, metrics, and graceful shutdown.
- [x] Document deployment behind TLS with private API/database networking, explicit browser-origin policy, secret injection, backups/restore, and least-privilege database access.

Acceptance: CI catches contract and authorization regressions, the complete example passes on a fresh database, and operational recovery is documented and exercised.

## Example implementation

See [`example-implementation/`](example-implementation/) for the Node.js WebSocket trivia game, setup, endpoint mapping, and test commands. Use ordinary player workflows for gameplay and a separate operator script for admin-only endpoints. Do not expose administrator credentials to the browser.


## Euchre demo — 2026-09-11

- [x] Add `--euchre-example` / `EXAMPLE=euchre` with 1–4 humans and bots filling four seats.
- [x] Implement authoritative bidding, bowers, following suit, dealer discard, lone hands, tricks, and scoring to ten with private hand snapshots.
- [x] Add account and friendship controls, table discovery, service membership, moderation, lease renewal, and cleanup.
- [x] Verify a full game against the real API/PostgreSQL, plus engine and WebSocket regression tests; document the endpoint mapping and operator-only workflows.

- [x] Give Trivia an arcade cabinet, Euchre a wood-and-felt table, and the directory a Starport console; enable one-human Euchre with three bots and verify solo engine/WebSocket gameplay.
