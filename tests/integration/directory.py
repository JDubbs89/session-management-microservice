"""Directory CRUD/search/ownership checks against disposable PostgreSQL."""
import hashlib
import os
import sys
import uuid
from pathlib import Path

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Set INTEGRATION_TEST_DATABASE=1 for a disposable database')
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/app'))
from fastapi.testclient import TestClient
from sqlalchemy import text
from database import engine
from main import app

tenant='directory-'+uuid.uuid4().hex
service,other=str(uuid.uuid4()),str(uuid.uuid4())
credential,foreign=uuid.uuid4().hex,uuid.uuid4().hex
with engine.begin() as db:
    for sid,key in [(service,credential),(other,foreign)]:
        db.execute(text('INSERT INTO services(service_id,tenant_id,credential_hash,scopes) VALUES (:s,:t,:h,:scopes)'),
                   {'s':sid,'t':tenant,'h':hashlib.sha256(key.encode()).hexdigest(),'scopes':['rooms:read','rooms:write','players:write','players:act']})
try:
    with TestClient(app) as client:
        def call(method,path,body=None,status=200,key=credential):
            response=client.request(method,path,json=body,headers={'Authorization':'Service '+key})
            assert response.status_code==status,(path,response.status_code,response.text)
            return response.json()
        alice=call('POST','/v1/players',{'subject':'Alex Morgan'},201)
        bob=call('POST','/v1/players',{'subject':'Jo Lee'},201)
        base={'code':'weekend','game':'Trivia','protocol':'v1','capacity':2,'policy':'private'}
        group=call('POST','/v1/rooms',base,201);gid=group['room_id']
        call('POST','/v1/rooms',base|{'code':'other'},201,key=foreign)
        assert call('GET','/v1/rooms')==[]
        owned=call('GET','/v1/rooms?owned=true');assert len(owned)==1 and owned[0]['room_id']==gid
        assert call('GET','/v1/players',key=foreign)==[]
        assert len(call('GET','/v1/players?q=alex'))==1
        assert call('GET','/v1/players?q=%25')==[]
        call('POST',f'/v1/rooms/{gid}/join',{'player_id':alice['player_id']})
        selected=call('GET',f'/v1/rooms/{gid}');assert selected['member_details'][0]['subject']=='Alex Morgan'
        roster=call('GET','/v1/players?q=Alex');assert roster[0]['groups'][0]['code']=='weekend'
        call('PATCH',f"/v1/players/{alice['player_id']}",{'subject':'Alex','previous_subject':'Alex Morgan'})
        call('PATCH',f"/v1/players/{alice['player_id']}",{'subject':'Stale','previous_subject':'Alex Morgan'},409)
        call('PATCH',f"/v1/players/{alice['player_id']}",{'subject':'Intruder','previous_subject':'Alex'},404,key=foreign)
        edited=call('PATCH',f'/v1/rooms/{gid}',base|{'code':'weekend-updated','version':group['version']})
        assert edited['version']==group['version']+1
        call('PATCH',f'/v1/rooms/{gid}',base|{'version':group['version']},409)
        call('PATCH',f'/v1/rooms/{gid}',base|{'version':edited['version']},403,key=foreign)
        call('POST',f'/v1/rooms/{gid}/join',{'player_id':bob['player_id']})
        call('PATCH',f'/v1/rooms/{gid}',base|{'capacity':1,'version':edited['version']},409)
        with engine.begin() as db:
            db.execute(text('INSERT INTO service_player_grants(tenant_id,service_id,player_id) VALUES (:t,:s,:p)'),{'t':tenant,'s':other,'p':alice['player_id']})
        assert call('GET','/v1/players?q=Alex')[0]['shared']
        call('PATCH',f"/v1/players/{alice['player_id']}",{'subject':'Shared','previous_subject':'Alex'},409)
        call('DELETE',f"/v1/players/{alice['player_id']}",status=409)
        call('DELETE',f"/v1/players/{bob['player_id']}")
        assert len(call('GET',f'/v1/rooms/{gid}')['members'])==1
    print('Directory live SQL passed: search, private groups, user/group edits, membership labels, stale writes, capacity, shared users, and ownership.')
finally:
    with engine.begin() as db:
        db.execute(text('DELETE FROM rooms WHERE tenant_id=:t'),{'t':tenant})
        db.execute(text('DELETE FROM service_players WHERE tenant_id=:t'),{'t':tenant})
        db.execute(text('DELETE FROM services WHERE tenant_id=:t'),{'t':tenant})
