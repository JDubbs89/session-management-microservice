"""Neutral registration, restart revocation, and shared limiter atomicity."""
import json
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Disposable integration database required')
os.environ['RATE_LIMIT_STORAGE'] = 'postgresql'
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/app'))
import httpx
from fastapi import HTTPException
from core.limiter import _consume
from database import engine
from sqlalchemy import text

state_path = Path(os.environ.get('INTEGRATION_IDENTITY_STATE', '/tmp/session-p1-identity.json'))
client = httpx.Client(base_url=os.environ.get('SESSION_API_URL','http://127.0.0.1:8000'),timeout=15)
def headers(token):
    return {'Authorization':'Bearer '+token}

if '--cleanup' in sys.argv:
    state = json.loads(state_path.read_text())
    assert client.delete('/users/delete_me',headers=headers(state['current'])).status_code == 204
    state_path.unlink()
    print('Identity restart probe cleaned up.')
elif '--after-restart' in sys.argv:
    state = json.loads(state_path.read_text())
    assert client.get('/users/me',headers=headers(state['revoked'])).status_code == 401
    assert client.get('/users/me',headers=headers(state['current'])).status_code == 200
    try:
        _consume(state['bucket'], 10, 3600)
    except HTTPException as exc:
        assert exc.status_code == 429
    else:
        raise AssertionError('Shared limit was reset by restart')
    print('Revoked tokens stay rejected and shared counters persist across restart.')
else:
    suffix=uuid.uuid4().hex[:8]
    username='neutral_'+suffix
    body={'username':username,'password':'integration-password-81!','user_id':'client-chosen'}
    response=client.post('/users/register',json=body)
    assert response.status_code==201,response.text
    user=response.json()
    assert user['user_id'] != 'client-chosen'
    uuid.UUID(user['user_id']);uuid.UUID(user['subject'])
    with engine.connect() as connection:
        assert connection.execute(text('SELECT user_steam_id FROM users WHERE username=:u'),{'u':username}).scalar() is None
    token=client.post('/users/login',data={'username':username,'password':body['password']}).json()['access_token']
    metadata={'session_flavortext':'Neutral identity','player_count':1,'max_player_count':4,
              'session_start_time':'2026-09-09T00:00:00Z','host_username':username}
    response=client.post('/sessions/create',headers=headers(token),json={
        'session':{'session_code':int(suffix,16)%1000000000+1,'host_username':username},'beacon_metadata':metadata})
    assert response.status_code==201,response.text
    assert response.json()['host_user_id']==user['user_id']
    assert response.json()['host_steam_id'] is None
    import time
    time.sleep(1.1)
    response=client.put('/sessions/update',headers=headers(token),json={
        'session_code':response.json()['session_code'],'settings_to_update':{'beacon_metadata':metadata}})
    assert response.status_code==204,response.text
    assert client.get('/sessions/read_friend_session_data',headers=headers(token),params={'friend_name':username}).status_code==200
    assert client.post('/users/logout',headers=headers(token)).status_code==204
    time.sleep(1.1)
    current=client.post('/users/login',data={'username':username,'password':body['password']}).json()['access_token']
    assert client.get('/users/me',headers=headers(token)).status_code==401
    bucket='integration-'+uuid.uuid4().hex
    def consume(_):
        try:
            _consume(bucket,10,3600)
            return 200
        except HTTPException as exc:
            return exc.status_code
    with ThreadPoolExecutor(max_workers=10) as pool:
        statuses=list(pool.map(consume,range(20)))
    assert statuses.count(200)==10 and statuses.count(429)==10,statuses
    fd=os.open(state_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as file:
        json.dump({'revoked':token,'current':current,'bucket':bucket},file)
    print('Neutral signup/session and atomic shared rate counters passed; restart state saved privately.')
client.close()
