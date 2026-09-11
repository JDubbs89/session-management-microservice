# Node.js service demos

This folder contains three runnable demos: the Quiz Night arcade (default), the Starport service console, and the Bower Club Euchre table.

The browser connects only to the Node game server. Node reads API bearer tokens from an HttpOnly cookie, calls the Python API for accounts and session discovery, and owns room membership, questions and scoring. Correct answers never travel to the browser. This is a local teaching example, with four players and three questions per room.

## Choose a demo

| Demo                    | Local command                                     | Purpose                                                                               |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Trivia game             | `./run-demo.sh`                                   | Four-player WebSocket game using the real API and PostgreSQL                               |
| Trivia game against API | `SESSION_API_URL=http://127.0.0.1:8000 npm start` | Legacy player and session integration                                                 |
| Euchre | `./run-demo.sh --euchre-example` | 1–4 human players, bots, friendships, legacy discovery, and `/v1` leased membership |
| Service directory       | `./run-demo.sh --directory-example`               | `/v1` service, player, room, membership, player deletion, lease, and close operations |

`npm start` also defaults to trivia when `EXAMPLE` is unset. The Compose directory demo automatically provisions a disposable service credential for its local API. For a separately running API, set `DIRECTORY_AUTO_PROVISION=1`, `DIRECTORY_ADMIN_USERNAME`, and `DIRECTORY_ADMIN_PASSWORD`, or provide an explicit `SERVICE_CREDENTIAL`.

## Run the complete demo with Docker

Requires a running Docker Engine accessible to your account and Docker Compose (`docker-compose`). Verify with `docker info`; for a missing socket on systemd Linux, run `sudo systemctl start docker`. See [daemon troubleshooting](../docs/operations.md#docker-prerequisite) for socket permission errors. From the repository root:

```sh
./example-implementation/run-demo.sh
```

Open **http://127.0.0.1:3000** in two separate browser profiles and follow the player walkthrough below. The equivalent `localhost` address also works; WebSocket Origin validation accepts loopback aliases on the configured port. No local Python, Node, or environment file is needed for this Docker demo.

The stack runs three containers: PostgreSQL initializes the schema and stored functions on the first boot; the API waits for PostgreSQL; the game waits for API/database readiness. The game uses the real API at `http://api:8000` through Compose service discovery, with mock mode disabled. The API and database have no host ports. The game listens on all interfaces inside its container, with its host port bound only to `127.0.0.1`.

The trivia example is selected by default. To run the service-directory example instead, first provision a service credential as described below, then start Compose with:

```sh
./example-implementation/run-demo.sh --directory-example
```

This stack uses fixed local demo database credentials and a demo signing secret. `DEMO_SECRET_KEY` overrides the signing secret. `DEMO_PUBLIC_ORIGIN` sets an explicit browser origin when using a local reverse proxy (which must forward WebSocket upgrades). Other origins remain rejected. `DEMO_PORT` changes the browser port and allowed origin together, for example:

```sh
DEMO_PORT=3001 ./example-implementation/run-demo.sh
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
./example-implementation/run-demo.sh
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

To switch the Docker stack to the directory console, recreate only the game container. Compose automatically creates a disposable admin and service credential for this local stack:

```sh
./run-demo.sh --directory-example
```

Return to trivia with `./run-demo.sh`, because trivia is the default. Run `docker-compose ... down` when changing modes if you also want to stop the other containers. To use a manually provisioned credential instead, set `SERVICE_CREDENTIAL`; it overrides automatic provisioning.

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

The existing friend-named routes also discover public rooms; trivia does not expose social controls; Euchre uses the `/friends` API. Persistent messaging remains deferred. Current contracts retain legacy Steam fields; registration generates a unique placeholder identifier. Create uses the API's nested `{session, beacon_metadata}` body and JSON array strings for access lists.

## Service directory example

This second demo provides **Users** and **Groups** views for the `/v1` service API. The service credential stays on the Node server.

- **Users:** search by name, add or rename a user, view their groups, add/remove membership, and confirm deletion. Optional external identities are tucked into the add-user form. Shared users are marked and cannot be renamed or deleted until an operator unshares them.
- **Groups:** browse both public and private groups owned by this service, create or edit their name, activity, capacity, visibility, and connection settings. Select members by name, create a new user directly inside a group, remove or ban members, and confirm closing a group.
- Forms retain values on errors, prevent duplicate submissions, and check stale edits. Lists load 100 records at a time with server-side search and **Load more**. Membership pickers use the currently loaded users/groups; browse or search the corresponding view to find more.

Groups represent the API's **live rooms**, not permanent social groups. A group expires after 90 seconds without renewal. **Renew now** extends its lease, or enable **Keep this selected group active** for renewal every 30 seconds while that group is selected. Switching to Users, editing a form, or closing the page pauses automatic renewal. Connection origins still require operator approval; leave the public address blank for the automatically provisioned demo.

Run it with `./example-implementation/run-demo.sh --directory-example` from the repository root. Changes to the server API require rebuilding the API container as well as the directory demo; no new database migration is needed for these management views.

Start the API first, using the repository development setup or an existing API. For the local development server:

```sh
cd ..
python -m uvicorn main:app --app-dir src/app --host 127.0.0.1 --port 8000 --no-proxy-headers
```

In a second terminal, provision a disposable service and player with an existing administrator:

```sh
cd example-implementation
export SESSION_API_URL=http://127.0.0.1:8000
export DIRECTORY_AUTO_PROVISION=1
export DIRECTORY_ADMIN_USERNAME=directory-demo-admin
export DIRECTORY_ADMIN_PASSWORD=directory-demo-password-123
npm run directory
```

The Compose stack automatically provisions the demo administrator and service credential. For a separately running API, create the administrator with the repository bootstrap command using the same username and password above, or use `npm run directory-operator` to create a service manually and export its printed credential as `SERVICE_CREDENTIAL`. The console calls every service room and player endpoint through the server-side `SessionApi`, including idempotent membership and ban operations. The credential is never sent to browser JavaScript.

If a separately running directory app reports that the service credential was rejected, rerun `directory-operator` against the same API URL and database used by the directory app. Copy only the `credential` value from its JSON output, not the `service_id` or `player_id`, and export it as `SERVICE_CREDENTIAL` before starting the app.

## Validation and limits

```sh
npm test
```

Tests cover cookie restoration, logout/deletion, missing/tampered/expired credentials, origin enforcement, Secure cookies, upstream outages, all endpoint request shapes, errors, scoring, invalid/duplicate answers, capacity, and an actual two-WebSocket game with the explicit mock adapter. A live smoke test additionally requires Python API and PostgreSQL and must include the operator command to exercise all fifteen routes.

Only the local host can advance questions; membership and answers are checked on the server. Rooms lock when play starts. The host controls question timing, and scores update immediately. Each account gets one active connection. Login and registration use same-origin HTTP routes. Tokens are stored in a host-only, HttpOnly, SameSite=Strict cookie with a lifetime bounded by JWT expiry; HTTPS public origins add Secure. Browser JavaScript never receives the token. Page load restores identity through GET /auth/me, and WebSocket upgrades verify the cookie through the API before accepting gameplay. Auth mutations require a trusted Origin. Refresh and reconnect preserve sign-in and return to the lobby. Disconnect removes local membership; a host disconnect attempts API session deletion and closes the room. Failed remote cleanup is logged and requires operator attention. Token expiry closes the connection and requires sign-in again. Sign-out and deletion clean up active rooms, call the API, clear the cookie, and close account connections. Locally revoked tokens are rejected until expiry. The API also implements persistent account token-version revocation on logout; the live CI suite verifies revocation after a new login, API/database restart, and subsequent API access.

Outside Docker, trivia defaults to loopback and validates WebSocket Origin (default `http://127.0.0.1:3000`). `HOST`, `PORT`, and `PUBLIC_ORIGIN` customize serving; Compose sets these for container networking. For deployment, put the game and API behind TLS, keep PostgreSQL private, configure explicit trusted origins, inject secrets from a secret manager, and use durable/shared game state with reliable session lease and cleanup handling. The directory example uses a server-side service credential and is intended for local integration testing, not direct internet exposure.

### Directory validation

`npm test` includes the directory proxy and API-client regression checks. Backend listing/editing authorization, stale-write, and capacity checks are in `src/tests/test_services.py`. Against a disposable migrated PostgreSQL database, run `INTEGRATION_TEST_DATABASE=1 python tests/integration/directory.py` with the normal API environment.

A separate browser smoke test exercises user/group creation and editing, membership, confirmations, retained forms, search, escaping, and mobile layout with a deterministic API fixture. With Playwright installed, run `node tests/integration/directory-browser.mjs`; set `PLAYWRIGHT_MODULE` to its module path if installed outside this repository. Screenshots are written to `/tmp/directory-desktop.png` and `/tmp/directory-mobile.png`. This browser fixture is separate from the PostgreSQL test.


## Euchre

```sh
# From the repository root; builds API, database, and game together.
./example-implementation/run-demo.sh --euchre-example
# Or, against an existing API with a scoped service credential:
cd example-implementation
SESSION_API_URL=http://127.0.0.1:8000 SERVICE_CREDENTIAL=... npm run euchre
```

Open http://127.0.0.1:3000 in 1–4 separate browser profiles. Create accounts, send a friend request by username, then refresh requests in the recipient's profile and accept. Create a table and find it by code, host, friend, or the open-table list. Guests join before the host starts. To play solo, create a table and choose **Deal · play with bots**; the other three seats are filled automatically. The host can remove/ban a guest before dealing. Refresh the friends/table lists to see changes made by other players.

The game uses four seats in join order, with opposite seats partnered. One, two, or three humans play with bots in the remaining seats. It uses a 24-card deck, both bowers, two bidding rounds, dealer pickup/discard, mandatory following suit, optional lone hands, and scoring to ten. The house rule is “stick the dealer” in round two. Each socket receives only its own hand; the server validates turns and legal cards. Rules are based on [Bicycle's Euchre rules](https://bicyclecards.com/how-to-play/euchre), with the stated dealer house rule.

The host deals the next hand after scoring. Leave the finished table and create a new one to replay. A departing guest is replaced by bot play for the remainder of the game; refreshing leaves that seat and restores account sign-in only. Active hands cannot be rejoined. The host leaving, signing out, expiring, or deleting their account closes the table. In-memory hands are not restored after a game-server restart.

| Workflow | API coverage |
| --- | --- |
| Account creation, login/restoration, sign out, deletion | `/users/register`, `/users/login`, `/users/me`, `/users/logout`, `/users/delete_me` |
| Friends and requests | All five `/friends` routes, including accept/reject/cancel/remove |
| Host, preview by host/code, join, deal/results, leave | All six legacy `/sessions` routes |
| Bind an authenticated account to a service player | `POST /v1/players` using its server-verified stable subject |
| Table creation and discovery | `POST /v1/rooms`, `GET /v1/rooms`, `GET /v1/rooms/{id}` |
| Start a game, membership, moderation | Room PATCH, join, leave, ban |
| Presence and cleanup | Versioned heartbeat every 20 seconds, close, service-player deletion on account deletion |
| Local provisioning | Admin login, service creation, credential rotation, admin logout; credentials stay on the server |
| Privileged/management-only operations | `operator.js` exercises admin account endpoints; `directory-operator.js` exercises service grants; the directory demo supports player list/edit management |

The game uses the major account, social, discovery, membership, and presence endpoints through actual workflows. Administrative account management, cross-service grants, and service-player editing belong to the separate operator/directory workflows. No administrator credentials are sent to browsers.

Both a legacy discovery record and a leased service room are maintained per table. Cross-API operations are not a distributed transaction: failed creation attempts close the service room when possible, and any orphaned service room expires after 90 seconds. Legacy room deletion uses the shared retry mechanism. Persistent API/account state survives restart; hands do not. For local Compose, service provisioning uses a new demo tenant on startup. Supply a stable `SERVICE_CREDENTIAL` when reusing a tenant. Production hostnames require `PUBLIC_ORIGIN` and the deployment controls in the operations guide.

Verification:

```sh
npm test
# With a running disposable API/database and existing admin:
EUCHRE_LIVE_TEST=1 SESSION_API_URL=http://127.0.0.1:8000 \
  DIRECTORY_ADMIN_USERNAME=integration-admin DIRECTORY_ADMIN_PASSWORD=... \
  node --test test/euchre-websocket.test.js
```

The live test plays a complete game, verifies hidden hands, exercises friendships and service membership/heartbeat/close, replays, and deletes its player accounts. Engine tests cover 1/2/3/4 humans, bowers, following suit, bidding, alone play, scoring, and departing players.

Browser smoke test (with Playwright installed separately and a running isolated Euchre demo):

```sh
EUCHRE_URL=http://127.0.0.1:3000 node ../tests/integration/euchre-browser.mjs
```

`PLAYWRIGHT_MODULE` may point to an external Playwright module. This checks account/friend/table flows and a played hand in separate browser sessions, plus desktop/mobile layouts. Screenshots are written to `/tmp/euchre-desktop.png` and `/tmp/euchre-mobile.png`.
