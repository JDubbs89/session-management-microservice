"""Regression checks; database integration is a separate test tier."""
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault('DATABASE_URL', 'postgresql+psycopg2://test:test@127.0.0.1/test')
os.environ.setdefault('SECRET_KEY', 'test-secret-only-at-least-32-characters')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))

from models import UserSessionCreate, UserSessionUpdate
from crud_user_session import _session, update_session
from crud_user import delete_user, hash_password
import crud_user
from main import app


def test_registered_endpoint_inventory():
    paths = {(method.upper(), path) for path, methods in app.openapi()['paths'].items() for method in methods}
    assert ('GET', '/sessions/read_session_data') in paths
    assert ('POST', '/users/register_admin') in paths
    assert ('DELETE', '/users/delete_me') in paths


def test_session_mapping_uses_column_names():
    row = SimpleNamespace(_mapping=dict(id=87, session_code=123456, session_passcode='',
        host_user_id='id', host_username='host', host_steam_id='external', beacon_metadata='{}',
        session_status='active', session_whitelist='[]', session_blacklist='[]', allow_join='public'))
    result = _session(row)
    assert result.session_code == 123456
    assert result.host_user_id == 'id'
    assert 'session_blacklist' not in result.model_dump()
    assert 'session_whitelist' not in result.model_dump()
    assert 'session_passcode' not in result.model_dump()


def test_admission_lists_reject_objects():
    with pytest.raises(ValidationError):
        UserSessionCreate(session_code=1, host_username='host', session_whitelist='{}')


def test_update_rejects_injected_or_unknown_columns():
    with pytest.raises(ValidationError):
        UserSessionUpdate(session_code=1, settings_to_update={'host_username': 'intruder'})


def test_update_rejects_non_host_before_mutation():
    db = Mock()
    db.execute.return_value.fetchone.return_value = SimpleNamespace(_mapping={'host_username': 'host'})
    with pytest.raises(HTTPException) as exc:
        update_session(db, UserSessionUpdate(session_code=1, settings_to_update={}), 'intruder')
    assert exc.value.status_code == 403
    db.commit.assert_not_called()
    assert db.execute.call_count == 1


def test_update_code_and_status_in_one_statement():
    db = Mock()
    db.execute.return_value.fetchone.return_value = SimpleNamespace(_mapping={
        'host_username': 'host', 'session_passcode': ''})
    update_session(db, UserSessionUpdate(session_code=1,
        settings_to_update={'session_code': 2, 'session_status': 'ended'}), 'host')
    sql, params = db.execute.call_args.args
    assert 'session_code = :session_code' in str(sql)
    assert 'session_status = :session_status' in str(sql)
    assert params == {'code': 1, 'session_code': 2, 'session_status': 'ended'}


def test_delete_verifies_password_without_rehashing(monkeypatch):
    hashed = hash_password('password123')
    monkeypatch.setattr(crud_user, 'get_user_by_username', lambda db, username: {'hashed_password': hashed})
    db = Mock()
    delete_user(db, 'target', 'password123', 'admin', 'admin-hash')
    assert db.execute.call_args.args[1]['p'] == hashed


def test_delete_me_uses_authenticated_hash(monkeypatch):
    monkeypatch.setattr(crud_user, 'get_user_by_username', lambda db, username: {'hashed_password': 'stored'})
    db = Mock()
    delete_user(db, 'self', None, 'self', 'stored')
    assert db.execute.call_args.args[1]['p'] == 'stored'


def test_create_rejects_impersonated_host():
    from routers.session_routes import create
    from models import BeaconMetadata, SessionCreateRequest
    with pytest.raises(HTTPException) as exc:
        create.__wrapped__(request=Mock(), db=Mock(),
            current_user={'username': 'real-host', 'role': 'user'},
            body=SessionCreateRequest(session=UserSessionCreate(session_code=123, host_username='victim'),
            beacon_metadata=BeaconMetadata(session_flavortext='Quiz', player_count=0,
                max_player_count=4, session_start_time='2026-01-01T00:00:00Z',
                host_username='victim')))
    assert exc.value.status_code == 403


def test_metadata_update_preserves_host_identity():
    db = Mock()
    db.execute.return_value.fetchone.return_value = SimpleNamespace(_mapping={
        'host_username': 'host', 'host_steam_id': 'external', 'session_passcode': ''})
    metadata = {'session_flavortext': 'Quiz', 'player_count': 0, 'max_player_count': 4,
                'session_start_time': '2026-01-01T00:00:00Z', 'host_username': 'spoof'}
    update_session(db, UserSessionUpdate(session_code=1,
        settings_to_update={'beacon_metadata': metadata}), 'host')
    import json
    saved = json.loads(db.execute.call_args.args[1]['beacon_metadata'])
    assert saved['host_username'] == 'host'
    assert saved['host_steam_id'] == 'external'
