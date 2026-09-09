# Node.js WebSocket trivia example

This folder also contains a service-directory example. The default is trivia. Choose the directory example with `npm run directory` after provisioning a service, or set `EXAMPLE=directory` and `SERVICE_CREDENTIAL` for the Docker stack.

The browser connects only to the Node game server. Node reads API bearer tokens from an HttpOnly cookie, calls the Python API for accounts and session discovery, and owns room membership, questions and scoring. Correct answers never travel to the browser. This is a local teaching example, with four players and three questions per room.

## Run the complete demo with Docker

Requires a running Docker Engine accessible to your account and Docker Compose (`docker-compose`). Verify with `docker info`; for a missing socket on systemd Linux, run `sudo systemctl start docker`. See [daemon troubleshooting](../docs/operations.md#docker-prerequisite) for socket permission errors. From the repository root:

```sh
docker-compose -f example-implementation/docker-compose.yml up --build -d --wait
```

Open **http://127.0.0.1:3000** in two separate browser profiles and follow the player walkthrough below. The equivalent `localhost` address also works; WebSocket Origin validation accepts loopback aliases on the configured port. No local Python, Node, or environment file is needed for this Docker demo.

The stack runs three containers: PostgreSQL initializes the schema and stored functions on the first boot; the API waits for PostgreSQL; the game waits for API/database readiness. The game uses the real API at `http://api:8000` through Compose service discovery, with mock mode disabled. The API and database have no host ports. The game listens on all interfaces inside its container, with its host port bound only to `127.0.0.1`.

The trivia example is selected by default. To run the service-directory example instead, first provision a service credential as described below, then start Compose with:

```sh
EXAMPLE=directory SERVICE_CREDENTIAL='credential-printed-by-directory-operator' docker-compose -f example-implementation/docker-compose.yml up --build -d --wait
```

This stack uses fixed local demo database credentials and a demo signing secret. `DEMO_SECRET_KEY` overrides the signing secret. `DEMO_PUBLIC_ORIGIN` sets an explicit browser origin when using a local reverse proxy (which must forward WebSocket upgrades). Other origins remain rejected. `DEMO_PORT` changes the browser port and allowed origin together, for example:

```sh
DEMO_PORT=3001 docker-compose -f example-implementation/docker-compose.yml up --build -d --wait
```

Open `http://127.0.0.1:3001` for that configuration. Use the same environment overrides for subsequent Compose commands.

```sh
# Inspect startup and API calls.
docker-compose -f example-implementation/docker-compose.yml logs -f api game

# Stop the demo while preserving accounts in the dedicated database volume.
docker-compose -f example-implementation/docker-compose.yml down
```

The volume is separate from the original `src/docker-compose.yml` stack. Restarting preserves accounts, but game rooms live in Node memory; graceful shutdown attempts to remove their API records and retries failed cleanup. Initialization scripts only run on new volumes; API startup applies versioned migrations. [Back up before upgrading](../docs/operations.md#migrations-and-existing-data).

The database image bundles the SQL initialization files with container-readable permissions. It does not bind-mount the host SQL directory. After pulling changes to those files, rebuild with the startup command above. If an older stack reports `ls: cannot open directory '/docker-entrypoint-initdb.d/': Permission denied`, rebuilding and recreating the database container removes that mount while preserving the data volume:

```sh
docker-compose -f example-implementation/docker-compose.yml up --build -d --wait
```

If startup still fails, inspect `docker-compose -f example-implementation/docker-compose.yml logs --tail=100 db api`. Do not rerun `init.sql` manually over an existing database; use versioned migrations.

To exercise the administrator routes inside this stack:

```sh
docker-compose -f example-implementation/docker-compose.yml exec api python bootstrap_admin.py --username trivia-service
read -r -p 'Admin username: ' ADMIN_USERNAME
read -r -s -p 'Admin password: ' ADMIN_PASSWORD
export ADMIN_USERNAME ADMIN_PASSWORD
docker-compose -f example-implementation/docker-compose.yml exec -e ADMIN_USERNAME -e ADMIN_PASSWORD game npm run operator
unset ADMIN_USERNAME ADMIN_PASSWORD
```

Bootstrap only once. The operator uses the game's internal API URL and removes its temporary administrator when finished.

## Run without Docker

Requires Node.js 22 or 24.

```sh
cd example-implementation
npm ci
npm run demo
```

Open http://127.0.0.1:3000 in two separate browser profiles (or one ordinary and one private window). Cookies are shared between tabs in the same profile. Register distinct accounts (passwords at least eight characters). Choose **Create a room** in one window. In the other, find it by room code or host username and select **Join room**. The waiting room shows an invite code and the players. Only the host sees **Start quiz** and **Next question**; answers lock after submission. After question three, the host selects **See results**. **Back to lobby** leaves the room so you can start another game. Account controls contain sign-out and account deletion. Loading states pace requests automatically.

`npm run demo` explicitly uses an in-memory mock: no real API requests, database persistence, or backend validation. Restarting loses everything. Mock tests do not establish PostgreSQL integration correctness.

## Run against the API

Start the API using the repository README and initialize a fresh development database. Then:

```sh
SESSION_API_URL=http://127.0.0.1:8000 npm start
```

Startup calls the health endpoint; failures are surfaced and never trigger a mock fallback. Repeat the two-window walkthrough above as the live smoke test. Use different accounts from earlier runs or log in to existing ones. The server serializes outgoing API calls at 1.1-second intervals to respect shared-IP one-per-second limits. Registration also has a six-per-minute limit: use a small number of players. Other processes sharing the same IP can still cause 429 errors, which are displayed; wait before retrying. Failed mutations are not automatically retried.

For the three admin-only endpoints, bootstrap an administrator using the root README, then run this CLI against a disposable development database:

```sh
read -r -p 'Admin username: ' ADMIN_USERNAME
read -r -s -p 'Admin password: ' ADMIN_PASSWORD
export ADMIN_USERNAME ADMIN_PASSWORD
npm run operator
unset ADMIN_USERNAME ADMIN_PASSWORD
```

The operator creates a uniquely named temporary administrator, reads it, deletes it, and logs out. It never sends administrator credentials to browsers. This command changes the development database; use a dedicated bootstrap account. If cleanup fails, inspect and remove the printed temporary username manually. The operator runs only against the real API.

## Endpoint coverage

| Endpoint                                 | Experience                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /`                                  | Server/operator startup health check                                         |
| `POST /users/register`                   | Register player                                                              |
| `POST /users/login`                      | Player/operator sign in                                                      |
| `GET /users/me`                          | Player identity after sign in                                                |
| `POST /users/logout`                     | Explicit sign out; operator cleanup                                          |
| `DELETE /users/delete_me`                | Delete own demo account                                                      |
| `POST /users/register_admin`             | Operator creates disposable admin                                            |
| `GET /users/get_user`                    | Operator inspects disposable admin                                           |
| `DELETE /users/delete`                   | Operator removes disposable admin                                            |
| `POST /sessions/create`                  | Host public trivia room                                                      |
| `GET /sessions/read_friend_session`      | Resolve host before joining                                                  |
| `GET /sessions/read_friend_session_data` | Preview by host                                                              |
| `GET /sessions/read_session_data`        | Preview by code                                                              |
| `PUT /sessions/update`                   | Publish membership counts, lock joins on start, and mark final results ended |
| `DELETE /sessions/delete`                | Host leaves/disconnects                                                      |

The existing friend-named routes also discover public rooms; this example does not imply that friendship or messaging endpoints exist. Current contracts retain legacy Steam fields; registration generates a unique placeholder identifier. Create uses the API's nested `{session, beacon_metadata}` body and JSON array strings for access lists.

## Service directory example

This is a second runnable implementation for the `/v1` service API. It keeps the service credential on the Node server and provides a small room operations console at the same port. The console can provision players, create and discover public rooms, inspect room membership, renew leases, and close rooms. The server also exposes the join, leave, and ban calls at `/api/rooms/:room_id/{join,leave,ban}` for a game integration to use with a provisioned `player_id`.

Against a running API, provision a disposable service and player with an existing administrator:

```sh
cd example-implementation
ADMIN_USERNAME=admin ADMIN_PASSWORD='your-password' npm run directory-operator
export SERVICE_CREDENTIAL='credential-printed-by-the-command'
SESSION_API_URL=http://127.0.0.1:8000 npm run directory
```

The operator calls service creation, credential rotation, player creation, and the administrator grant endpoint. The console calls every service room and player endpoint through the server-side `SessionApi`, including idempotent membership and ban operations. The credential is never sent to browser JavaScript.

## Validation and limits

```sh
npm test
```

Tests cover cookie restoration, logout/deletion, missing/tampered/expired credentials, origin enforcement, Secure cookies, upstream outages, all endpoint request shapes, errors, scoring, invalid/duplicate answers, capacity, and an actual two-WebSocket game with the explicit mock adapter. A live smoke test additionally requires Python API and PostgreSQL and must include the operator command to exercise all fifteen routes.

Only the local host can advance questions; membership and answers are checked on the server. Rooms lock when play starts. The host controls question timing, and scores update immediately. Each account gets one active connection. Login and registration use same-origin HTTP routes. Tokens are stored in a host-only, HttpOnly, SameSite=Strict cookie with a lifetime bounded by JWT expiry; HTTPS public origins add Secure. Browser JavaScript never receives the token. Page load restores identity through GET /auth/me, and WebSocket upgrades verify the cookie through the API before accepting gameplay. Auth mutations require a trusted Origin. Refresh and reconnect preserve sign-in and return to the lobby. Disconnect removes local membership; a host disconnect attempts API session deletion and closes the room. Failed remote cleanup is logged and requires operator attention. Token expiry closes the connection and requires sign-in again. Sign-out and deletion clean up active rooms, call the API, clear the cookie, and close account connections. Locally revoked tokens are rejected until expiry. The API also implements persistent account token-version revocation on logout; the live CI suite verifies revocation after a new login, API/database restart, and subsequent API access.

Outside Docker, trivia defaults to loopback and validates WebSocket Origin (default `http://127.0.0.1:3000`). `HOST`, `PORT`, and `PUBLIC_ORIGIN` customize serving; Compose sets these for container networking. For deployment, put the game and API behind TLS, keep PostgreSQL private, configure explicit trusted origins, inject secrets from a secret manager, and use durable/shared game state with reliable session lease and cleanup handling. The directory example uses a server-side service credential and is intended for local integration testing, not direct internet exposure.
