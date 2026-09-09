ALTER TABLE services ADD COLUMN allowed_origins TEXT[] NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX services_credential_hash_unique ON services(credential_hash);
CREATE UNIQUE INDEX services_tenant_id_unique ON services(tenant_id,service_id);
CREATE UNIQUE INDEX service_players_tenant_id_unique ON service_players(tenant_id,player_id);
ALTER TABLE rooms ADD CONSTRAINT rooms_service_tenant_fk FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,service_id);
CREATE TABLE service_player_grants (
 tenant_id TEXT NOT NULL, service_id TEXT NOT NULL, player_id TEXT NOT NULL,
 PRIMARY KEY(service_id,player_id),
 FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,service_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,player_id) REFERENCES service_players(tenant_id,player_id) ON DELETE CASCADE
);
CREATE TABLE service_external_identities (
 tenant_id TEXT NOT NULL, provider TEXT NOT NULL, external_subject TEXT NOT NULL,
 player_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,provider,external_subject),
 UNIQUE(player_id,provider),
 FOREIGN KEY(tenant_id,player_id) REFERENCES service_players(tenant_id,player_id) ON DELETE CASCADE
);
CREATE INDEX rooms_live_discovery ON rooms(tenant_id,lease_until) WHERE NOT closed;
CREATE FUNCTION cleanup_expired_rooms(target_tenant TEXT DEFAULT NULL) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE removed INTEGER;
BEGIN
 DELETE FROM rooms WHERE (target_tenant IS NULL OR tenant_id=target_tenant)
 AND (closed OR lease_until <= CURRENT_TIMESTAMP);
 GET DIAGNOSTICS removed = ROW_COUNT;
 RETURN removed;
END;
$$;
