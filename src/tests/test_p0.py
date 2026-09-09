import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError, IntegrityError

from config import load_settings
from core.errors import database_error
from crud_user_session import delete_session, update_session
from database import get_db
from main import app
from models import UserSessionCreate, UserSessionUpdate

BASE = {'DATABASE_URL': 'postgresql://user:secret@localhost/test', 'SECRET_KEY': 'a' * 40}

@pytest.mark.parametrize('key,value', [
    ('DATABASE_URL', ''), ('DATABASE_URL', 'sqlite://'), ('DATABASE_URL', 'postgresql://host'),
    ('DATABASE_URL', 'postgresql://u:p@host:bad/db'), ('SECRET_KEY', 'short'),
    ('SECRET_KEY', 'replace-with-a-long-random-secret'),
    ('ACCESS_TOKEN_EXPIRE_MINUTES', '0'), ('ACCESS_TOKEN_EXPIRE_MINUTES', '1441'),
    ('ACCESS_TOKEN_EXPIRE_MINUTES', 'abc'), ('APP_ENV', 'typo'),
])
def test_invalid_config_has_safe_errors(key, value):
    with pytest.raises(ValueError) as exc:
        load_settings(BASE | {key: value})
    assert key in str(exc.value)
    assert 'user:secret' not in str(exc.value)

def test_production_rejects_demo_secret():
    with pytest.raises(ValueError):
        load_settings(BASE | {'APP_ENV': 'production', 'SECRET_KEY': 'local-trivia-demo-only-change-before-deployment'})
    assert load_settings(BASE | {'APP_ENV': 'production'}).access_token_expire_minutes == 30

@pytest.mark.parametrize('code,status,public', [('23505',409,'conflict'), ('42501',403,'forbidden'),
    ('P0002',404,'not_found'), ('08006',503,'unavailable'), (None,503,'unavailable')])
def test_database_errors_rollback_and_redact(code, status, public):
    db = Mock()
    exc = IntegrityError('SQL with secret', {'password': 'secret'}, SimpleNamespace(pgcode=code))
    error = database_error(db, exc)
    db.rollback.assert_called_once()
    assert (error.status_code, error.detail) == (status, {'code': public})

@pytest.mark.parametrize('settings', [
    {'session_passcode': 'é'*37}, {'session_status': 'a'*33},
    {'session_code': True}, {'session_whitelist': ['x']*101},
    {'session_blacklist': ['x'*65]}, {'beacon_metadata': {}},
])
def test_update_bounds(settings):
    with pytest.raises(ValidationError):
        UserSessionUpdate(session_code=1, settings_to_update=settings)

def test_delete_checks_stored_owner():
    db = Mock()
    db.execute.return_value.fetchone.return_value = SimpleNamespace(_mapping={'host_username':'victim'})
    with pytest.raises(HTTPException) as exc:
        delete_session(db, 1, 'attacker')
    assert exc.value.status_code == 403
    assert db.execute.call_count == 1
    db.commit.assert_not_called()

def test_passcode_update_is_hashed():
    from crud_user import verify_password
    db = Mock()
    db.execute.return_value.fetchone.return_value = SimpleNamespace(_mapping={'host_username':'host'})
    update_session(db, UserSessionUpdate(session_code=1, settings_to_update={'session_passcode':'room-secret'}), 'host')
    stored = db.execute.call_args.args[1]['session_passcode']
    assert stored != 'room-secret'
    assert verify_password('room-secret', stored)

def test_http_validation_does_not_echo_password():
    app.state.limiter.enabled = False
    try:
        with TestClient(app) as client:
            response = client.post('/users/register', json={'password':'sensitive-input'})
        assert response.status_code == 422
        assert response.json() == {'detail': {'code': 'invalid_request'}}
    finally:
        app.state.limiter.enabled = True

def test_dependency_catches_commit_failure_and_rolls_back(monkeypatch):
    import database
    db = Mock()
    monkeypatch.setattr(database, 'SessionLocal', lambda: db)
    dependency = get_db()
    assert next(dependency) is db
    with pytest.raises(HTTPException) as exc:
        dependency.throw(OperationalError('secret SQL', {}, Exception('secret detail')))
    assert exc.value.status_code == 503
    db.rollback.assert_called_once()
    db.close.assert_called_once()

def test_openapi_public_contract():
    schema = app.openapi()
    public = schema['components']['schemas']['UserSession']['properties']
    assert not {'session_passcode','session_whitelist','session_blacklist'} & public.keys()
    params = schema['paths']['/sessions/read_friend_session']['get']['parameters']
    assert any(p['name']=='X-Session-Passcode' and p['in']=='header' for p in params)
    assert not any(p['name']=='session_passcode' and p['in']=='query' for p in params)
    assert '201' in schema['paths']['/sessions/create']['post']['responses']
    assert '204' in schema['paths']['/sessions/delete']['delete']['responses']

def test_create_derives_all_host_fields(monkeypatch):
    from models import SessionCreateRequest
    from routers import session_routes
    captured = {}
    def save(db, session, metadata):
        captured.update(session=session, metadata=metadata)
    monkeypatch.setattr(session_routes, 'create_session', save)
    body = SessionCreateRequest.model_validate({
        'session': {'session_code':123, 'host_username':'host', 'host_user_id':'spoof', 'host_steam_id':'spoof'},
        'beacon_metadata': {'session_flavortext':'Quiz', 'player_count':1, 'max_player_count':4,
                            'session_start_time':'2026-09-09T00:00:00Z', 'host_username':'spoof', 'host_steam_id':'spoof'},
    })
    session_routes.create.__wrapped__(request=Mock(), db=Mock(), body=body,
        current_user={'username':'host', 'user_id':'real-id', 'user_steam_id':'real-external'})
    assert captured['session'].host_user_id == 'real-id'
    assert captured['session'].host_steam_id == 'real-external'
    assert captured['metadata'].host_username == 'host'
    assert captured['metadata'].host_steam_id == 'real-external'
