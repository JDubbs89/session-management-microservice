"""Apply additive, transactional migrations; safe to run on every API start."""
from pathlib import Path
from sqlalchemy import text
from database import engine


def migrate():
    with engine.begin() as connection:
        connection.execute(text('SELECT pg_advisory_xact_lock(741852963)'))
        connection.execute(text('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)'))
        for path in sorted((Path(__file__).parent / 'migrations').glob('*.sql')):
            if not connection.execute(text('SELECT 1 FROM schema_migrations WHERE version=:v'), {'v': path.name}).scalar():
                connection.exec_driver_sql(path.read_text())
                connection.execute(text('INSERT INTO schema_migrations(version) VALUES (:v)'), {'v': path.name})

if __name__ == '__main__':
    migrate()
