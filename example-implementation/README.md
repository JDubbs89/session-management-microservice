# Node.js WebSocket trivia example

The browser connects only to the Node game server. Node retains API bearer tokens in memory, calls the Python API for accounts and session discovery, and owns room membership, questions and scoring. Correct answers never travel to the browser. This is a local teaching example, with four players and three questions per room.

Requires Node.js 22 or newer.

```sh
cd example-implementation
npm ci
npm run demo
```

Open http://127.0.0.1:3000 in two windows. Register distinct accounts (passwords at least eight characters). Host a room in one window, preview it by host or room code in the other, then join by host username. The host starts each question and advances after players answer. After question three, advance once more for final scores. Leave closes the host's API session. Sign out or delete disposable accounts afterward.

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

| Endpoint | Experience |
| --- | --- |
| `GET /` | Server/operator startup health check |
| `POST /users/register` | Register player |
| `POST /users/login` | Player/operator sign in |
| `GET /users/me` | Player identity after sign in |
| `POST /users/logout` | Sign out/disconnect; operator cleanup |
| `DELETE /users/delete_me` | Delete own demo account |
| `POST /users/register_admin` | Operator creates disposable admin |
| `GET /users/get_user` | Operator inspects disposable admin |
| `DELETE /users/delete` | Operator removes disposable admin |
| `POST /sessions/create` | Host public trivia room |
| `GET /sessions/read_friend_session` | Resolve host before joining |
| `GET /sessions/read_friend_session_data` | Preview by host |
| `GET /sessions/read_session_data` | Preview by code |
| `PUT /sessions/update` | Publish membership counts, lock joins on start, and mark final results ended |
| `DELETE /sessions/delete` | Host leaves/disconnects |

The existing friend-named routes also discover public rooms; this example does not imply that friendship or messaging endpoints exist. Current contracts retain legacy Steam fields; registration generates a unique placeholder identifier. Create uses the API's nested `{session, beacon_metadata}` body and JSON array strings for access lists.

## Validation and limits

```sh
npm test
```

Tests cover all endpoint request shapes, errors, scoring, invalid/duplicate answers, capacity, and an actual two-WebSocket game with the explicit mock adapter. A live smoke test additionally requires Python API and PostgreSQL and must include the operator command to exercise all fifteen routes.

Only the local host can advance questions; membership and answers are checked on the server. Rooms lock when play starts. The host controls question timing, and scores update immediately. Each account gets one active connection. Tokens remain in Node memory; browser refresh requires sign-in again. Disconnect removes local membership; a host disconnect attempts API session deletion and closes the room. Failed remote cleanup is logged and requires operator attention. Tokens can expire during a game; failures are surfaced without silent reauthentication.

This binds to loopback and validates WebSocket Origin (default `http://127.0.0.1:3000`). `PORT` and `PUBLIC_ORIGIN` customize local serving. Deployment needs TLS, stronger anti-abuse controls, durable/shared game state, reliable session leases/cleanup and service identity/delegation in the API. This example currently acts on player tokens held server-side; it does not implement a service-account credential flow that the API does not yet provide. Do not expose this demo directly to the internet.
