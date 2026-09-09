"""Live service-directory contracts, concurrency, and cross-tenant isolation."""
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from sqlalchemy import text

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Set INTEGRATION_TEST_DATABASE=1 only for a disposable database')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/app'))
from database import engine

base = os.environ.get('SESSION_API_URL', 'http://127.0.0.1:8000')
client = httpx.Client(base_url=base, timeout=20)
suffix = uuid.uuid4().hex[:8]

def call(method, path, credential=None, body=None, expected=200, admin=False):
    headers = {'Authorization': ('Bearer ' if admin else 'Service ') + credential} if credential else {}
    response = client.request(method, path, headers=headers, json=body)
    assert response.status_code == expected, (method, path, expected, response.status_code, response.text)
    return response.json() if response.content else None

login = client.post('/users/login', data={'username':'integration-admin', 'password':os.environ['INTEGRATION_ADMIN_PASSWORD']})
assert login.status_code == 200
admin = login.json()['access_token']
scopes = ['rooms:read', 'rooms:write', 'players:write', 'players:act']

def service(tenant, permissions=scopes):
    return call('POST', '/v1/services', admin, {'tenant_id':tenant, 'scopes':permissions,
        'allowed_origins':['wss://games.example.com']}, expected=201, admin=True)

first = service('tenant-a-'+suffix)
second = service('tenant-a-'+suffix)
foreign = service('tenant-b-'+suffix)
restricted = service('tenant-a-'+suffix, ['rooms:read'])
a, b, c, read_only = [item['credential'] for item in (first,second,foreign,restricted)]
call('GET', '/v1/rooms', expected=401)
call('GET', '/v1/rooms', admin, expected=401, admin=True)
call('GET', '/users/me', a, expected=401)
call('POST', '/v1/players', read_only, {'subject':'forbidden'}, expected=403)
player = call('POST', '/v1/players', a, {'subject':'subject-'+suffix}, expected=201)
call('POST', '/v1/players', b, {'subject':'subject-'+suffix}, expected=403)
call('POST', '/v1/services/'+second['service_id']+'/players/'+player['player_id'], admin, admin=True)
assert call('POST', '/v1/players', b, {'subject':'subject-'+suffix}, expected=201)['player_id'] == player['player_id']
other_player = call('POST', '/v1/players', a, {'subject':'other-'+suffix}, expected=201)
foreign_player = call('POST', '/v1/players', c, {'subject':'subject-'+suffix}, expected=201)
assert player['player_id'] != foreign_player['player_id']

room_body = {'code':'room-'+suffix, 'game':'trivia', 'protocol':'ws-v1', 'capacity':1,
             'public_address':'wss://games.example.com/play', 'policy':'public'}
room = call('POST', '/v1/rooms', a, room_body, expected=201)
rid = room['room_id']
call('POST', '/v1/rooms', a, room_body, expected=409)
room2 = call('POST', '/v1/rooms', a, room_body | {'code':'second-'+suffix}, expected=201)
assert room2['room_id'] != rid
call('POST', '/v1/rooms', read_only, room_body | {'code':'forbidden'}, expected=403)
call('POST', '/v1/rooms', a, room_body | {'code':'bad-origin', 'public_address':'wss://unapproved.example.com/play'}, expected=403)
call('GET', '/v1/rooms/'+rid, c, expected=404)
assert not call('GET', '/v1/rooms', c)
assert any(row['room_id']==rid for row in call('GET', '/v1/rooms', b))
call('POST', '/v1/rooms/'+rid+'/join', b, {'player_id':player['player_id']}, expected=403)
call('POST', '/v1/rooms/'+rid+'/join', a, {'player_id':foreign_player['player_id']}, expected=403)
# Concurrent attempts must never oversubscribe the final slot.
def join(pid):
    return client.post('/v1/rooms/'+rid+'/join', headers={'Authorization':'Service '+a}, json={'player_id':pid})
with ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(join, [player['player_id'],other_player['player_id']]))
assert sorted(r.status_code for r in results) == [200,409]
winner = [player['player_id'],other_player['player_id']][next(i for i,r in enumerate(results) if r.status_code==200)]
call('POST', '/v1/rooms/'+rid+'/join', a, {'player_id':winner})
call('POST', '/v1/rooms/'+rid+'/ban', a, {'player_id':winner})
call('POST', '/v1/rooms/'+rid+'/join', a, {'player_id':winner}, expected=403)
call('POST', '/v1/rooms/'+rid+'/leave', a, {'player_id':winner})
call('POST', '/v1/rooms/'+rid+'/leave', a, {'player_id':winner})
# Same version used concurrently must have exactly one winner.
version = call('GET', '/v1/rooms/'+rid, a)['version']
def heartbeat(_):
    return client.post('/v1/rooms/'+rid+'/heartbeat', headers={'Authorization':'Service '+a}, json={'version':version})
with ThreadPoolExecutor(max_workers=2) as pool:
    responses = list(pool.map(heartbeat, range(2)))
assert sorted(r.status_code for r in responses)==[200,409]
private = call('POST', '/v1/rooms', a, room_body | {'code':'private-'+suffix,'policy':'private'}, expected=201)
call('GET', '/v1/rooms/'+private['room_id'], b, expected=404)
assert private['room_id'] not in {row['room_id'] for row in call('GET', '/v1/rooms', b)}
# Expiry hides rooms immediately, rejects stale writers, and permits code reuse.
with engine.begin() as connection:
    connection.execute(text("UPDATE rooms SET lease_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE room_id=:r"), {'r':room2['room_id']})
assert room2['room_id'] not in {row['room_id'] for row in call('GET', '/v1/rooms', a)}
reused = call('POST', '/v1/rooms', a, room_body | {'code':room2['code']}, expected=201)
assert reused['room_id'] != room2['room_id']
new_version = call('GET','/v1/rooms/'+rid,a)['version']
call('POST', '/v1/rooms/'+rid+'/close', a, {'version':new_version})
assert rid not in {row['room_id'] for row in call('GET', '/v1/rooms', a)}
rotated = call('POST', '/v1/services/'+first['service_id']+'/rotate', admin, admin=True)
call('GET', '/v1/rooms', a, expected=401)
call('GET', '/v1/rooms', rotated['credential'])
# Rotating a credential must not reset its authenticated service budget.
from hashlib import sha256
bucket = sha256(f"service:principal:{first['service_id']}:60".encode()).hexdigest()
with engine.begin() as connection:
    connection.execute(text("UPDATE rate_limit_buckets SET hits=120, window_start=floor(extract(epoch FROM now())/60)*60 WHERE bucket_key=:key"), {'key':bucket})
# This assertion runs with shared storage (the CI/deployment configuration).
if os.environ.get('RATE_LIMIT_STORAGE') == 'postgresql':
    response = client.get('/v1/rooms',headers={'Authorization':'Service '+rotated['credential']})
    assert response.status_code == 429 and int(response.headers['Retry-After']) > 0
client.close()
print('Service scopes, tenant/owner isolation, multi-room ownership, capacity races, duplicate joins, bans, leases, concurrency, and rotation passed.')
