# Service directory API

The `/v1` directory authenticates trusted game servers independently of legacy player JWTs. Apply migrations before starting the API. PostgreSQL remains private. A tenant identifies an application; use separate tenants for mutually untrusted applications. Administrators provision services and must verify the operator owns every approved public origin, including its DNS configuration. The API never resolves or contacts those origins. Do not place secrets in URL paths.

An administrator calls `POST /v1/services` with a Bearer admin JWT and a body such as:

```json
{"tenant_id":"trivia","scopes":["rooms:read","rooms:write","players:write","players:act"],"allowed_origins":["wss://play.example.com"]}
```

The response supplies a server-generated `service_id` and a credential shown once. Store it in server secret storage and send `Authorization: Service <credential>` on directory calls. Only its SHA-256 digest is persisted. Admin `POST /v1/services/{service_id}/rotate` replaces the credential immediately; already authenticated in-flight calls can finish. Service credentials cannot authorize admin or legacy player endpoints. `players:act` is intentionally absent from default scopes.

`POST /v1/players` accepts `subject` and optional `external_identities`, a map of provider name to provider subject. The returned `player_id` is generated server-side. Tenant and subject are unique; repeated provisioning returns the same identity. External identity ownership is unique per tenant and provider. These associations are assertions by a trusted service, not verification of an external provider token. Provisioning grants that service permission to act for the player. Another service in the same tenant cannot claim an existing subject. An admin can explicitly authorize sharing with `POST /v1/services/{service_id}/players/{player_id}`; cross-tenant grants fail. Scope alone never authorizes another service's players.

| Operation | Contract |
| --- | --- |
| `POST /v1/rooms` | `code`, `game`, `protocol` (include protocol version), `capacity`, optional `public_address`, `policy` (`public` or `private`). Returns room UUID, version and lease. Requires `rooms:write`. |
| `GET /v1/rooms?limit=50&offset=0` | Tenant-only public live directory, maximum 100 rows. Requires `rooms:read`. |
| `GET /v1/rooms/{id}` | Live room and membership IDs; private rooms visible only to owner. Requires `rooms:read`. |
| `POST /v1/rooms/{id}/join` | `{ "player_id": "..." }`; owning service, `rooms:write`, `players:act`, and player grant required. Duplicate join succeeds without taking another seat. |
| `POST /v1/rooms/{id}/leave` | Same authorization and body as join; repeat leave succeeds. |
| `POST /v1/rooms/{id}/ban` | Same authorization and body as join; atomically bans and removes membership. Repeat ban succeeds. |
| `POST /v1/rooms/{id}/heartbeat` | `{ "version": 1 }`; owner renews lease and increments version; stale version returns 409. |
| `POST /v1/rooms/{id}/close` | `{ "version": 1 }`; owner closes room and removes members; stale version returns 409. |

Room codes are unique within a tenant, and a service can own many rooms. Public addresses must match an admin-approved HTTPS/WSS origin; credentials, query strings, fragments and internal IP/name literals are rejected. Private means excluded from discovery and foreign service reads: only the owner admits its explicitly authorized players. Browsers cannot join directly, and calling another service's room mutation returns 403. Capacity, bans and membership changes serialize under a database row lock, including concurrent requests across API processes. Create retries with a duplicate active code return 409; joins/leaves/bans are idempotent, while heartbeat and close use optimistic concurrency. Read current state before retrying an uncertain heartbeat.

Leases last **90 seconds**. Heartbeat every 30 seconds. A crashed server disappears from discovery after expiry even without cleanup. Membership represents the owning game's authoritative admission state, not proof that a socket is connected. The game should allow a **30-second reconnect grace period**, then submit leave; the API does not run WebSocket timers. A server restarting before expiry can reuse its credential, inspect a known room UUID and reconcile connections. After expiry it must create a new room and re-admit players. The directory does not recover game scores or realtime state.

Authenticated service requests clean expired and closed rooms in that tenant before executing their action. Cleanup cascades memberships and bans and frees room codes. Closed/expired IDs subsequently return 404; close retries may therefore return 404. For tenants without traffic, run the following with your normal private database connection once per minute (for example from a scheduler):

```sql
SELECT cleanup_expired_rooms();
```

Cleanup and request actions use separate committed transactions, releasing cleanup locks before room operations. There is no durable room history after cleanup. Keep game history elsewhere if needed. Scope/origin changes and grant revocation endpoints are not provided in this initial contract; administrative database changes require normal controlled operations. Legacy player routes remain a compatibility surface and do not expose `/v1` directory rooms.

## Directory management views

`GET /v1/players?limit=100&offset=0&q=alex` lists only players granted to the authenticated service (requires `players:write`). Each row includes its name (`subject`), shared status, and live group memberships owned by that service. Search is a case-insensitive literal substring. `PATCH /v1/players/{id}` takes `subject` and `previous_subject`; a stale name or shared identity returns 409. The stable player ID and external identities remain unchanged.

`GET /v1/rooms?owned=true` lists the service's own live rooms, including private rooms; the default directory still lists only tenant-visible public rooms. It supports bounded `q`, `limit`, and `offset`, and returns policy, lease, and member counts. Room detail includes `member_details` with member IDs and subjects for display.

`PATCH /v1/rooms/{id}` takes the room-create fields plus the last read `version`. Only the owning service may edit. It checks the approved connection origin, current version, and capacity against existing membership while holding the room lock, then increments the version. Editing does not renew the lease. Existing grants, scopes, and tenant isolation apply to all management operations.
