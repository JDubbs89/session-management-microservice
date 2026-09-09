# Moving a game server to the service API

New integrations should use `/v1/players` and `/v1/rooms`. The old `/sessions/*` API remains available for the bundled trivia example and existing player-JWT clients, but is marked deprecated in OpenAPI. No removal date is scheduled. Do not mix old session codes with new room IDs: these are separate resources and authorization models.

| Legacy concept | Service API concept |
| --- | --- |
| Player JWT owns one session | A service credential owns multiple rooms |
| Supplied Steam/account identifier | Server-generated player ID, tenant-scoped provider-neutral subject, optional external identities |
| `beacon_metadata` | Explicit room game, protocol, capacity, and approved public connection address |
| `read_friend_session*` | Tenant-scoped `GET /v1/rooms` and `GET /v1/rooms/{room_id}` |
| Host session update | Version-checked heartbeat and close; explicit join/leave/ban operations |
| Online flag as presence | Expiring room lease and explicit membership |

A trusted operator creates each service identity with the minimum scopes and approved connection origins. Keep the returned service credential in the game server's secret store; never send it to a browser. Each game server authenticates its players and obtains explicit authorization to act for their player IDs. The session API enforces tenant, service ownership, and player grants; a caller-supplied player ID alone is insufficient.

Migrate an integration by provisioning service identities, mapping its authenticated users to provider-neutral subjects, and using room IDs for subsequent operations. Preserve legacy IDs in the compatibility mapping during account upgrades. Do not transform legacy player-owned sessions into service-owned rooms automatically: an operator must choose the owning service and approved address. Existing rooms can finish under the legacy API while newly created rooms use `/v1`.

The existing trivia example continues to exercise the legacy account/session contract. The service integration tests exercise multiple server identities and tenants separately. See [service contracts](services.md), [identity and limits](identity.md), and [legacy social decisions](legacy-social.md).
