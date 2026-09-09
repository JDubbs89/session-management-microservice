"""Serialized, transactional migrations; reruns verify immutable file checksums."""
import hashlib
from pathlib import Path
from sqlalchemy import text
from database import engine

MIGRATIONS = Path(__file__).parent / 'migrations'

def migrate(database_engine=engine, directory=MIGRATIONS):
    with database_engine.begin() as connection:
        connection.execute(text('SELECT pg_advisory_xact_lock(741852963)'))
        connection.execute(text('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, checksum TEXT)'))
        connection.execute(text('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT'))
        for path in sorted(directory.glob('*.sql')):
            sql = path.read_text()
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            row = connection.execute(text('SELECT checksum FROM schema_migrations WHERE version=:v'), {'v': path.name}).first()
            if row:
                if row[0] is not None and row[0] != checksum:
                    raise RuntimeError(f'Migration checksum mismatch: {path.name}')
                # Adopt the checksum for installations predating checksum tracking.
                connection.execute(text('UPDATE schema_migrations SET checksum=:c WHERE version=:v AND checksum IS NULL'), {'c': checksum, 'v': path.name})
                continue
            connection.execute(text(sql))
            connection.execute(text('INSERT INTO schema_migrations(version, checksum) VALUES (:v, :c)'), {'v': path.name, 'c': checksum})

if __name__ == '__main__':
    migrate()
