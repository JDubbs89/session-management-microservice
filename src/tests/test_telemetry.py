import logging
from unittest.mock import Mock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from auth import get_current_user
from main import app
from core.telemetry import TelemetryMiddleware, render_metrics
from core.logging import SafeFormatter

@pytest.fixture
def client():
    before = app.state.limiter.enabled
    app.state.limiter.enabled = False
    with TestClient(app) as value:
        yield value
    app.dependency_overrides.clear()
    app.state.limiter.enabled = before

def test_request_ids_and_metrics_never_include_raw_url(client):
    response = client.get('/secret-account-path?password=never-log-this')
    assert response.status_code == 404
    UUID(response.headers['x-request-id'])
    app.dependency_overrides[get_current_user] = lambda: {'role':'admin'}
    metrics = client.get('/metrics')
    assert metrics.status_code == 200
    assert 'api_request_duration_seconds_bucket' in metrics.text
    assert 'api_db_connections_checked_out' in metrics.text
    assert 'secret-account-path' not in metrics.text
    assert 'never-log-this' not in metrics.text
    assert 'route="unmatched"' in metrics.text

def test_metrics_require_administrator(client):
    assert client.get('/metrics').status_code == 401
    app.dependency_overrides[get_current_user] = lambda: {'role':'user'}
    assert client.get('/metrics').status_code == 403

def test_database_outage_preserves_liveness_and_marks_not_ready(client, monkeypatch):
    import database
    db = Mock()
    db.execute.side_effect = OperationalError('private SQL',{},Exception('secret details'))
    monkeypatch.setattr(database, 'SessionLocal', lambda: db)
    assert client.get('/').status_code == 200
    response = client.get('/health/ready')
    assert response.status_code == 503
    assert response.json() == {'detail': {'code':'unavailable'}}
    UUID(response.headers['x-request-id'])
    db.rollback.assert_called_once()
    db.close.assert_called_once()

def test_shutdown_disposes_pool(monkeypatch):
    import main
    dispose = Mock()
    monkeypatch.setattr(main.engine, 'dispose', dispose)
    with TestClient(app):
        dispose.assert_not_called()
    dispose.assert_called_once()

def test_log_formatter_drops_credentials_and_exception_text():
    record = logging.LogRecord('api.requests',logging.ERROR,'',1,'request_failed',(),None)
    record.password='never-log-this'
    record.sql='private SQL'
    record.error_type='OperationalError'
    formatted=SafeFormatter().format(record)
    assert 'OperationalError' in formatted
    assert 'never-log-this' not in formatted and 'private SQL' not in formatted
