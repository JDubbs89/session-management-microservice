"""Identity compatibility and limiter authorization regression tests."""
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

os.environ.setdefault('DATABASE_URL', 'postgresql+psycopg2://test:test@127.0.0.1/test')
os.environ.setdefault('SECRET_KEY', 'test-secret-only-at-least-32-characters')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
import pytest
from fastapi import HTTPException
import auth
import crud_user
from models import UserCreate
from core import limiter as limits


def test_registration_generates_identity_and_steam_is_optional(monkeypatch):
    user = UserCreate(username='alice', password='password123')
    assert user.steam_id is None and user.user_id is None
    monkeypatch.setattr(crud_user, 'hash_password', lambda value: 'hash')
    db = Mock()
    crud_user.create_user(db, 'attacker-selected', None, user.username, user.password)
    params = db.execute.call_args.args[1]
    from uuid import UUID
    assert str(UUID(params['i'])) == params['i']
    assert params['i'] != 'attacker-selected' and params['s'] is None


def test_subject_token_checks_persisted_version_before_charging(monkeypatch):
    user = dict(user_id='id', subject='neutral', username='alice', user_online=True,
                role='user', token_version=2)
    monkeypatch.setattr(auth, 'get_user_by_subject', lambda db, subject: user)
    charge = Mock()
    monkeypatch.setattr(limits, 'enforce_limit', charge)
    request = SimpleNamespace(state=SimpleNamespace())
    revoked = auth.create_access_token({'sub':'neutral', 'identity':'account', 'role':'user', 'ver':1})
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user(revoked, Mock(), request)
    assert exc.value.status_code == 401
    charge.assert_not_called()
    valid = auth.create_access_token({'sub':'neutral', 'identity':'account', 'role':'user', 'ver':2})
    assert auth.get_current_user(valid, Mock(), request) == user
    assert request.state.rate_limit_principal == 'player:id'
    charge.assert_called_once()


def test_limiter_separates_verified_players_and_ignores_forwarded_headers(monkeypatch):
    monkeypatch.setattr(limits, 'settings', SimpleNamespace(rate_limit_storage='memory'))
    limits._memory.clear()
    request = SimpleNamespace(client=SimpleNamespace(host='peer'), state=SimpleNamespace(),
                              headers={'x-forwarded-for':'attacker'})
    assert limits.client_ip(request) == 'peer'
    limits.enforce_limit(request, 'player:a', limit=1)
    limits.enforce_limit(request, 'player:b', limit=1)
    with pytest.raises(HTTPException) as exc:
        limits.enforce_limit(request, 'player:a', limit=1)
    assert exc.value.status_code == 429
    assert int(exc.value.headers['Retry-After']) > 0
    limits._memory.clear()


def test_production_requires_shared_limiter():
    from config import load_settings
    with pytest.raises(ValueError, match='PostgreSQL rate-limit'):
        load_settings({'DATABASE_URL':os.environ['DATABASE_URL'], 'SECRET_KEY':'a'*40,
                       'APP_ENV':'production', 'RATE_LIMIT_STORAGE':'memory'})
