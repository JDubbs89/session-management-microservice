"""Bounded local API/pool regression probe; never a deployment capacity estimate."""
import json
import math
import os
from pathlib import Path
import sys
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Set INTEGRATION_TEST_DATABASE=1 only for a disposable database')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/app'))
import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.exc import TimeoutError
from database import engine

base = os.environ.get('SESSION_API_URL', 'http://127.0.0.1:8000')
tenant = 'load-' + uuid.uuid4().hex
client = httpx.Client(base_url=base, timeout=15, limits=httpx.Limits(max_connections=16))
report = {'suite': 'bounded-local-load', 'capacity_claim': False, 'passed': False, 'targets': {'http_p95_ms': 2000, 'unexpected_errors': 0}}

def require(response, expected=200):
    assert response.status_code == expected, (expected, response.status_code, response.text)
    return response.json()

def measure(label, count, operation, expected):
    def run(index):
        start = time.perf_counter()
        try:
            status = operation(index)
        except httpx.HTTPError:
            status = 'transport_error'
        return status, (time.perf_counter() - start) * 1000
    with ThreadPoolExecutor(max_workers=8) as pool:
        values = list(pool.map(run, range(count)))
    times = sorted(value[1] for value in values)
    statuses = Counter(str(value[0]) for value in values)
    p95 = times[math.ceil(len(times) * .95) - 1]
    report[label] = {'requests': count, 'workers': 8, 'p50_ms': round(times[len(times)//2], 2), 'p95_ms': round(p95, 2), 'statuses': dict(statuses), 'unexpected_errors': sum(1 for status, _ in values if status not in expected)}
    assert report[label]['unexpected_errors'] == 0 and p95 < 2000, report[label]
    return statuses

try:
    response = client.post('/users/login', data={'username': 'integration-admin', 'password': os.environ['INTEGRATION_ADMIN_PASSWORD']})
    if response.status_code == 429:
        time.sleep(2)
        response = client.post('/users/login', data={'username': 'integration-admin', 'password': os.environ['INTEGRATION_ADMIN_PASSWORD']})
    admin = require(response)['access_token']
    services = []
    for _ in range(4):
        services.append(require(client.post('/v1/services', headers={'Authorization': 'Bearer ' + admin}, json={'tenant_id': tenant, 'scopes': ['rooms:read', 'rooms:write', 'players:write', 'players:act']}), 201))
    headers = {'Authorization': 'Service ' + services[0]['credential']}
    players = [require(client.post('/v1/players', headers=headers, json={'subject': f'player-{i}'}), 201)['player_id'] for i in range(12)]
    room = require(client.post('/v1/rooms', headers=headers, json={'code': 'load-room', 'game': 'load', 'protocol': 'test-v1', 'capacity': 4}), 201)
    statuses = measure('concurrent_joins', 12, lambda i: client.post('/v1/rooms/' + room['room_id'] + '/join', headers=headers, json={'player_id': players[i]}).status_code, {200, 409})
    assert statuses == {'200': 4, '409': 8}, statuses
    assert len(require(client.get('/v1/rooms/' + room['room_id'], headers=headers))['members']) == 4
    measure('shared_ip_services', 40, lambda i: client.get('/v1/rooms', headers={'Authorization': 'Service ' + services[i % 4]['credential']}).status_code, {200})
    # Exercise finite queueing and timeout on a deliberately tiny client-side SQLAlchemy pool.
    # This is an isolated real-DB pool probe, not the API process's configured pool.
    tiny = create_engine(engine.url, pool_size=2, max_overflow=0, pool_timeout=.1, pool_pre_ping=True)
    barrier = Barrier(8)
    def saturate(_):
        barrier.wait(timeout=5)
        try:
            with tiny.connect() as connection:
                connection.execute(text('SELECT pg_sleep(0.35)'))
            return 'ok'
        except TimeoutError:
            return 'pool_timeout'
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            counts = Counter(pool.map(saturate, range(8)))
        assert counts['ok'] == 2 and counts['pool_timeout'] == 6, counts
        with tiny.connect() as connection:
            assert connection.execute(text('SELECT 1')).scalar() == 1
        report['isolated_pool_saturation'] = {'pool_size': 2, 'max_overflow': 0, 'workers': 8, 'statuses': dict(counts), 'recovered': True}
    finally:
        tiny.dispose()
    report['passed'] = True
finally:
    try:
        with engine.begin() as connection:
            connection.execute(text('DELETE FROM rooms WHERE tenant_id=:t'), {'t': tenant})
            connection.execute(text('DELETE FROM service_players WHERE tenant_id=:t'), {'t': tenant})
            connection.execute(text('DELETE FROM services WHERE tenant_id=:t'), {'t': tenant})
    finally:
        client.close()
        print(json.dumps(report, sort_keys=True))
