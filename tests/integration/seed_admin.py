"""Seed an administrator in a disposable test database, never a deployment."""
import os
import sys
from pathlib import Path

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Set INTEGRATION_TEST_DATABASE=1 only for an isolated test database')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/app'))
from crud_user import create_user
from database import SessionLocal

with SessionLocal() as db:
    create_user(db, 'integration-admin', 'integration-admin', 'integration-admin',
                os.environ['INTEGRATION_ADMIN_PASSWORD'], role='admin')
