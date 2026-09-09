"""Run only against a disposable, initialized database with the test guard set."""
import os
import sys
import tempfile
from pathlib import Path

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Set INTEGRATION_TEST_DATABASE=1 for a disposable test database')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/app'))
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from database import engine
from migrate import migrate

migrate()
migrate()
with engine.connect() as connection:
    assert connection.execute(text('SELECT count(*) FROM schema_migrations WHERE checksum IS NOT NULL')).scalar() >= 2
# A failed migration must roll back schema changes and its ledger entry.
with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    (directory / '999_failure.sql').write_text('CREATE TABLE migration_rollback_probe(id INT); SELECT deliberately_missing_function();')
    try:
        migrate(engine, directory)
    except SQLAlchemyError:
        pass
    else:
        raise AssertionError('Invalid migration unexpectedly succeeded')
    with engine.connect() as connection:
        assert connection.execute(text("SELECT to_regclass('migration_rollback_probe')")).scalar() is None
        assert not connection.execute(text("SELECT 1 FROM schema_migrations WHERE version='999_failure.sql'")).scalar()
    (directory / '999_failure.sql').unlink()
    (directory / '001_identity.sql').write_text('SELECT 1;')
    try:
        migrate(engine, directory)
    except RuntimeError as exc:
        assert 'checksum mismatch' in str(exc)
    else:
        raise AssertionError('Modified migration unexpectedly accepted')
print('Migration reruns, rollback, and checksum checks passed.')

# Simulate a pre-migration installation containing a plaintext passcode.
# A unique schema keeps the probe separate from the live test accounts.
import uuid
from sqlalchemy import create_engine
schema = 'upgrade_probe_' + uuid.uuid4().hex
with engine.begin() as connection:
    connection.execute(text(f'CREATE SCHEMA {schema}'))
upgrade_engine = create_engine(engine.url, connect_args={'options': f'-csearch_path={schema},public'})
try:
    with upgrade_engine.begin() as connection:
        for path in sorted((Path(__file__).resolve().parents[2] / 'src/db/tables').glob('*.sql')):
            connection.execute(text(path.read_text()))
        # Ensure baseline service tables are local rather than resolved from public.
        baseline = Path(__file__).resolve().parents[2] / 'src/app/migrations/001_identity.sql'
        connection.execute(text(baseline.read_text().replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE')))
        connection.execute(text("INSERT INTO users(user_id,user_steam_id,username,hashed_password) VALUES ('old-id','old-steam','old-host','unused')"))
        connection.execute(text("INSERT INTO user_sessions(session_code,host_user_id,host_steam_id,host_username,session_status,session_passcode) VALUES (987,'old-id','old-steam','old-host','active','old-passcode')"))
        # Shadow the public ledger: this schema represents an older installation.
        connection.execute(text('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)'))
    migrate(upgrade_engine)
    migrate(upgrade_engine)
    with upgrade_engine.connect() as connection:
        row = connection.execute(text("SELECT session_passcode, crypt('old-passcode', session_passcode)=session_passcode FROM user_sessions WHERE session_code=987")).one()
        assert row[0] != 'old-passcode' and row[1]
        assert connection.execute(text("SELECT session_code FROM get_session_by_username('old-host','old-host','old-passcode')")).scalar() == 987
    with upgrade_engine.begin() as connection:
        connection.execute(text("SELECT update_session_passcode(987,'old-host','unused','','rotated-passcode')"))
        assert connection.execute(text("SELECT crypt('rotated-passcode', session_passcode)=session_passcode FROM user_sessions WHERE session_code=987")).scalar()
    print('Existing plaintext passcode migrated once; legacy rotation also stores a valid hash.')
finally:
    upgrade_engine.dispose()
    with engine.begin() as connection:
        connection.execute(text(f'DROP SCHEMA {schema} CASCADE'))
