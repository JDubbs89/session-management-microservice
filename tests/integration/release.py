"""Additional adversarial release contracts against a disposable live API."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Set INTEGRATION_TEST_DATABASE=1 only for a disposable database')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/app'))
import httpx
import jwt
from config import settings
from database import engine
from sqlalchemy import text

suffix = uuid.uuid4().hex[:10]
username = 'release_' + suffix
duplicate_username = username + '_d'
password = 'isolated-release-password-81!'
client = httpx.Client(base_url=os.environ.get('SESSION_API_URL', 'http://127.0.0.1:8000'), timeout=15)

def call(method, path, expected, **kwargs):
    deadline = time.monotonic() + 75
    response = client.request(method, path, **kwargs)
    while response.status_code == 429 and time.monotonic() < deadline:
        # Earlier suites share the login IP; wait for the fixed limiter window.
        try:
            retry_after = int(response.headers.get('Retry-After', '1'))
        except ValueError:
            retry_after = 1
        time.sleep(max(1, min(60, retry_after)))
        response = client.request(method, path, **kwargs)
    assert response.status_code == expected, (path, expected, response.status_code, response.text)
    return response

try:
    identity = {'username': username, 'password': password, 'steam_id': 'release:' + suffix}
    created = call('POST', '/users/register', 201, json=identity).json()
    call('POST', '/users/register', 409, json=identity)
    call('POST', '/users/register', 409, json=identity | {'username': duplicate_username})
    call('POST', '/users/login', 401, data={'username': username, 'password': 'incorrect-password'})
    token = call('POST', '/users/login', 200, data={'username': username, 'password': password}).json()['access_token']
    claims = jwt.decode(token, settings.secret_key, algorithms=['HS256'])
    adversarial = {
        'missing': None,
        'malformed': 'not.a.jwt',
        'tampered': jwt.encode(claims, 'a-different-isolated-signing-secret', algorithm='HS256'),
        'expired': jwt.encode(claims | {'exp': int(time.time()) - 60}, settings.secret_key, algorithm='HS256'),
        'wrong_role': jwt.encode(claims | {'role': 'admin'}, settings.secret_key, algorithm='HS256'),
        'wrong_version': jwt.encode(claims | {'ver': claims['ver'] + 1}, settings.secret_key, algorithm='HS256'),
    }
    for case, candidate in adversarial.items():
        response = call('GET', '/users/me', 401, headers={'Authorization': 'Bearer ' + candidate} if candidate else {})
        assert password not in response.text and settings.secret_key not in response.text, case
    call('GET', '/users/get_user', 403, params={'target_username': 'integration-admin'}, headers={'Authorization': 'Bearer ' + token})
    call('POST', '/v1/services', 403, json={'tenant_id': 'forbidden'}, headers={'Authorization': 'Bearer ' + token})
    call('GET', '/users/me', 200, headers={'Authorization': 'Bearer ' + token})
    call('GET', '/metrics', 401)
    call('GET', '/metrics', 403, headers={'Authorization': 'Bearer ' + token})
    admin_token = call('POST', '/users/login', 200, data={'username': 'integration-admin', 'password': os.environ['INTEGRATION_ADMIN_PASSWORD']}).json()['access_token']
    metrics = call('GET', '/metrics', 200, headers={'Authorization': 'Bearer ' + admin_token})
    assert 'text/plain' in metrics.headers['content-type']
    assert token not in metrics.text and password not in metrics.text
    assert call('GET', '/health/ready', 200).json()['status'] == 'ok'
    # Invoke the real bootstrap entry point against PostgreSQL; only terminal password input is replaced.
    source = "import getpass,runpy,sys; getpass.getpass=lambda prompt:'bootstrap-refusal-password'; sys.argv=['bootstrap_admin','--username',sys.argv[1]]; runpy.run_module('bootstrap_admin',run_name='__main__')"
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[2] / 'src/app'))
    result = subprocess.run([sys.executable, '-c', source, 'bootstrap_' + suffix], env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode != 0 and 'An administrator already exists' in result.stderr
    with engine.connect() as connection:
        assert not connection.execute(text('SELECT 1 FROM users WHERE username=:u'), {'u': 'bootstrap_' + suffix}).scalar()
    print(json.dumps({'suite': 'release', 'passed': True, 'token_cases': list(adversarial), 'duplicate_username': True, 'duplicate_external_identity': True, 'bootstrap_refusal': True}))
finally:
    # Remove only this invocation's identities, including on assertion failure.
    with engine.begin() as connection:
        connection.execute(text('DELETE FROM users WHERE username IN (:a,:b)'), {'a': username, 'b': duplicate_username})
    client.close()
