# Baseline setup and operations

## Supported runtimes and locked installs

Use Python 3.12, PostgreSQL 16, and Node.js 22 or 24. The API container and CI use Python 3.12; the game container uses Node 22. Install from the repository root:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r src/requirements-test.txt
.venv/bin/python -m pip check
.venv/bin/python -m pytest src/tests -q
npm ci --prefix example-implementation
npm test --prefix example-implementation
```

Runtime and test requirements include exact versions and artifact hashes for transitive dependencies. Edit the `.in` inputs, then regenerate both locks using Python 3.12 and `pip-tools==7.6.1`:

```sh
pip-compile --generate-hashes --strip-extras -o src/app/requirements.txt src/app/requirements.in
pip-compile --generate-hashes --strip-extras -o src/requirements-test.txt src/requirements-test.in
pip-audit -r src/app/requirements.txt
```

The runtime lock passed `pip-audit==2.10.1` on 2026-09-09 with no known vulnerabilities. The audit identified an advisory in the previous JWT library's `ecdsa` dependency; the API now uses PyJWT with HS256. CI repeats the audit because advisories change.

## Configuration

Configuration validates before the API starts, including when started directly with Uvicorn. Errors identify the field without printing its value.

| Setting                       | Requirement                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                     | `development` (default), `test`, or `production`                                                            |
| `DATABASE_URL`                | PostgreSQL URL with username, host, database, and a valid optional port; `postgresql+psycopg2` is supported |
| `SECRET_KEY`                  | At least 32 UTF-8 bytes; replace placeholders. Production also rejects known local/test prefixes            |
| `RATE_LIMIT_STORAGE`          | `postgresql` for shared counters; required in production. `memory` is for single-process development        |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Integer from 1 to 1440; default 30                                                                          |

Generate a secret with `python -c 'import secrets; print(secrets.token_urlsafe(48))'` and put it in your private environment file. Set `APP_ENV=production` for deployment and supply independent database credentials and a random signing secret. The demo Compose file is for local development. HS256 is fixed in code; there is no configurable algorithm. PostgreSQL stays on the internal container network.

## Docker prerequisite

Run `docker info` before Compose. If `/var/run/docker.sock` is missing on a systemd Linux host:

```sh
sudo systemctl start docker
# Optional: start Docker at boot.
sudo systemctl enable docker
```

If the socket exists but access is denied, use your administrator-approved Docker access method (for example, run the Compose command with sudo). Restarting the daemon does not fix socket permissions. Docker Desktop users should start Docker Desktop and select its Docker context.

```sh
docker-compose -f example-implementation/docker-compose.yml up --build --wait
```

`docker compose` is equivalent where the Compose plugin is installed without the standalone command. This command's exact Docker path still needs verification on the development host if the invoking account cannot access the daemon.

## Migrations and existing data

The database image's `init.sql` runs only for an empty database volume, with `ON_ERROR_STOP` enabled. Do not rerun initialization against an existing database. API containers run `python migrate.py` before Uvicorn; direct local launches must run it explicitly with the same configuration.

Migrations run in one transaction under a PostgreSQL advisory lock. `schema_migrations` records filenames, checksums, and application times. Reruns skip applied versions; changed checksums fail startup. Existing ledgers without checksums adopt the current checksum once. Never edit a migration after releasing it; add a new numbered file.

Migration 002 requires permission to install the trusted `pgcrypto` extension (or an administrator must install it beforehand). It hashes existing nonempty plaintext session passcodes with bcrypt, preserves empty passcodes, and upgrades stored functions/error codes. It refuses existing passcodes over 72 bytes; review and rotate those values before upgrading. Migration 003 also updates the legacy SQL passcode setters to hash new values. Stop older API writers during this upgrade. Restoring the previous application alone cannot undo this passcode format change.

For the demo, back up before upgrading:

```sh
umask 077
docker-compose -f example-implementation/docker-compose.yml exec -T db pg_dump -U trivia -d trivia -Fc > trivia-backup.dump
docker-compose -f example-implementation/docker-compose.yml stop game api
docker-compose -f example-implementation/docker-compose.yml up --build --wait
```

For a consistent application cutoff, stop game/API before taking the backup. `pg_dump` itself takes a consistent database snapshot. Keep backups private and verify restore into a separate database before relying on them. A restore rehearsal with the same PostgreSQL container:

```sh
docker-compose -f example-implementation/docker-compose.yml exec -T db createdb -U trivia trivia_restore_check
docker-compose -f example-implementation/docker-compose.yml exec -T db pg_restore --exit-on-error --no-owner -U trivia -d trivia_restore_check < trivia-backup.dump
```

Use a new rehearsal database name for subsequent checks. For the main stack substitute its configured user/database and Compose file. Preserve volumes; ordinary `down` retains data. Do not use `down -v` as an upgrade or recovery step.

Migrations 004–006 introduce the service directory, legacy integrity constraints, neutral account subjects, and shared rate-limit storage. Existing legacy account IDs/host references are preserved. Migration 005 refuses inconsistent historical social data and assumes naive timestamps were UTC; review [its prerequisites](legacy-social.md) before upgrading. New service rooms require explicit provisioning; legacy sessions are not automatically reassigned to a service.

## API contract changes

Creation returns 201. Logout, deletion, and session updates return 204 with an empty body. Errors use `{"detail":{"code":"..."}}` with `unauthorized`, `forbidden`, `not_found`, `conflict`, `invalid_request`, or `unavailable`. Database failures roll back; internal JSON events record only the exception class and SQLSTATE. Validation responses omit rejected input.

Names are limited to 64 characters; account identifiers to 128; passwords/passcodes to 72 UTF-8 bytes; session codes to positive signed 32-bit integers. Metadata has a fixed schema, bounded strings, and capacity up to 1000. Admission lists allow at most 100 bounded usernames. Request bodies and session settings reject unknown fields. Existing lookup routes return one session, so pagination does not apply; no session listing route is registered.

Host identity comes from the authenticated account. Session updates and deletions require the stored owner, including for administrators. Passcodes govern protected discovery; they do not authorize mutations. Existing blacklist/private/friends-only policy remains in effect, including whitelist/friend passcode bypass. Passcode lookup uses `X-Session-Passcode`, never a query credential. Create/update passcodes remain in JSON request bodies. Public session responses omit passcodes, hashes, whitelists, and blacklists. The bundled client implements these changes; other clients must update their header and response handling. Avoid logging credential headers or bodies in upstream proxies.

`GET /` is liveness; `GET /health/ready` checks initialized database tables. `/docs` and `/openapi.json` describe request bounds and response status codes.

## Integration verification

CI initializes PostgreSQL 16, injects an initialization failure, checks migration reruns/rollback/checksums, exercises all 15 application endpoints plus readiness, runs adversarial token and admin-bootstrap checks, executes the privileged operator workflow, runs a bounded concurrency/pool probe, restarts PostgreSQL, and repeats the route suite. It also runs two players through the real HTTP-cookie/WebSocket trivia lifecycle. Test seed scripts require `INTEGRATION_TEST_DATABASE=1` and must only target a disposable database.

After setting `DATABASE_URL`, `SECRET_KEY`, `SESSION_API_URL`, and `INTEGRATION_ADMIN_PASSWORD` for an isolated initialized database:

```sh
export INTEGRATION_TEST_DATABASE=1
python tests/integration/migrations.py
python tests/integration/seed_admin.py
# Start Uvicorn separately with the same DATABASE_URL and SECRET_KEY.
node tests/integration/live-api.mjs
# Restart only the isolated PostgreSQL instance, then:
node tests/integration/live-api.mjs --after-restart
TRIVIA_LIVE_TEST=1 node --test example-implementation/test/websocket.test.js
```

The route suite keeps one account and a username-only state file in `/tmp` for the next persistence probe. Dispose of the isolated test database when finished. Mock tests remain a separate tier.

P1/P2 CI also runs `python tests/integration/services.py`, `python tests/integration/legacy-p2.py`, and `python tests/integration/identity.py`. The identity probe saves generated test JWTs in a mode-0600 temporary file solely for restart verification; run its `--after-restart` check, `node tests/integration/game-restart.mjs`, then `--cleanup` to remove the account and state file. Set `RATE_LIMIT_STORAGE=postgresql` on the API to validate shared counters. All of these scripts require an isolated test database.

The bounded load probe (`python tests/integration/load.py`) targets an HTTP p95 below 2 seconds with zero unexpected statuses, verifies four concurrent joins into a four-slot room, exercises shared-IP service requests, and confirms a saturated database pool recovers. It is a regression signal, not a production capacity benchmark; establish deployment-specific targets before scaling.
