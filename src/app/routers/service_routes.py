"""Tenant-isolated server directory. Services explicitly vouch for their players."""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from database import get_db
from auth import require_role

router = APIRouter(prefix='/v1', tags=['server services'])

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')

class ServiceCreate(Strict):
    tenant_id: str = Field(min_length=1, max_length=128)
    scopes: list[Literal['rooms:read', 'rooms:write', 'players:write']] = ['rooms:read', 'rooms:write', 'players:write']

class PlayerCreate(Strict):
    subject: str = Field(min_length=1, max_length=128)

class RoomCreate(Strict):
    code: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    game: str = Field(min_length=1, max_length=64)
    protocol: str = Field(min_length=1, max_length=64)
    capacity: int = Field(ge=1, le=1000)
    public_address: str = Field(default='', max_length=2048)
    policy: Literal['public', 'private'] = 'public'
    @field_validator('public_address')
    @classmethod
    def address(cls, value):
        if value:
            parsed = urlparse(value)
            if parsed.scheme not in ('https', 'wss') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError('Use a public HTTPS/WSS address without credentials, query, or fragment')
            import ipaddress
            if parsed.hostname == 'localhost' or parsed.hostname.endswith(('.local', '.internal')):
                raise ValueError('Internal addresses are not public metadata')
            try:
                ip = ipaddress.ip_address(parsed.hostname)
            except ValueError:
                pass
            else:
                if not ip.is_global:
                    raise ValueError('Internal addresses are not public metadata')
        return value

class Member(Strict):
    player_id: str = Field(min_length=1, max_length=128)

class Version(Strict):
    version: int = Field(ge=1)

def service_auth(authorization: str = Header(default=''), db=Depends(get_db)):
    if not authorization.startswith('Service '):
        raise HTTPException(401, 'Service credential required')
    digest = hashlib.sha256(authorization[8:].encode()).hexdigest()
    row = db.execute(text('SELECT * FROM services WHERE credential_hash=:h AND enabled'), {'h': digest}).mappings().first()
    if not row:
        raise HTTPException(401, 'Invalid service credential')
    return dict(row)

def scope(service, permission):
    if permission not in service['scopes']:
        raise HTTPException(403, 'Insufficient service scope')

def room(db, room_id, service, write=False):
    scope(service, 'rooms:write' if write else 'rooms:read')
    row = db.execute(text('SELECT * FROM rooms WHERE room_id=:r AND tenant_id=:t FOR UPDATE'), {'r':room_id,'t':service['tenant_id']}).mappings().first()
    if not row:
        raise HTTPException(404, 'Room not found')
    if write and row['service_id'] != service['service_id']:
        raise HTTPException(403, 'Only the owning service may mutate the room')
    return dict(row)

def active(row):
    if row['closed'] or row['lease_until'] <= datetime.now(timezone.utc):
        raise HTTPException(409, 'Room lease expired or closed')

@router.post('/services', status_code=201)
def create_service(body: ServiceCreate, db=Depends(get_db), admin=Depends(require_role('admin'))):
    key, sid = secrets.token_urlsafe(48), str(uuid.uuid4())
    db.execute(text('INSERT INTO services(service_id,tenant_id,credential_hash,scopes) VALUES (:s,:t,:h,:p)'),
               {'s':sid,'t':body.tenant_id,'h':hashlib.sha256(key.encode()).hexdigest(),'p':body.scopes})
    db.commit()
    return {'service_id':sid,'tenant_id':body.tenant_id,'credential':key}

@router.post('/services/{service_id}/rotate')
def rotate(service_id: str, db=Depends(get_db), admin=Depends(require_role('admin'))):
    key=secrets.token_urlsafe(48)
    result=db.execute(text('UPDATE services SET credential_hash=:h WHERE service_id=:s'), {'h':hashlib.sha256(key.encode()).hexdigest(),'s':service_id})
    if not result.rowcount:
        raise HTTPException(404,'Service not found')
    db.commit()
    return {'credential':key}

@router.post('/players', status_code=201)
def create_player(body: PlayerCreate, service=Depends(service_auth), db=Depends(get_db)):
    scope(service,'players:write')
    row=db.execute(text('INSERT INTO service_players(player_id,tenant_id,subject) VALUES (:p,:t,:s) ON CONFLICT(tenant_id,subject) DO UPDATE SET subject=EXCLUDED.subject RETURNING player_id,subject'), {'p':str(uuid.uuid4()),'t':service['tenant_id'],'s':body.subject}).mappings().one()
    db.commit()
    return dict(row)

@router.post('/rooms', status_code=201)
def create_room(body: RoomCreate, service=Depends(service_auth), db=Depends(get_db)):
    scope(service,'rooms:write')
    params=body.model_dump() | {'r':str(uuid.uuid4()),'t':service['tenant_id'],'s':service['service_id']}
    row=db.execute(text("INSERT INTO rooms(room_id,tenant_id,service_id,code,game,protocol,capacity,public_address,policy,lease_until) VALUES (:r,:t,:s,:code,:game,:protocol,:capacity,:public_address,:policy,CURRENT_TIMESTAMP + INTERVAL '90 seconds') RETURNING *"),params).mappings().one()
    db.commit()
    return dict(row)

@router.get('/rooms')
def discover(limit: int=Query(50,ge=1,le=100), offset: int=Query(0,ge=0,le=100000), service=Depends(service_auth), db=Depends(get_db)):
    scope(service,'rooms:read')
    return [dict(row) for row in db.execute(text("SELECT room_id,code,game,protocol,capacity,public_address,version,lease_until FROM rooms WHERE tenant_id=:t AND NOT closed AND policy='public' AND lease_until>CURRENT_TIMESTAMP ORDER BY room_id LIMIT :l OFFSET :o"), {'t':service['tenant_id'],'l':limit,'o':offset}).mappings()]

@router.get('/rooms/{room_id}')
def get_room(room_id: str, service=Depends(service_auth), db=Depends(get_db)):
    row=room(db,room_id,service)
    if row['policy']=='private' and row['service_id']!=service['service_id']:
        raise HTTPException(404,'Room not found')
    active(row)
    row['members']=[r[0] for r in db.execute(text('SELECT player_id FROM room_members WHERE room_id=:r'), {'r':room_id})]
    return row

@router.post('/rooms/{room_id}/join')
def join(room_id: str, body: Member, service=Depends(service_auth), db=Depends(get_db)):
    row=room(db,room_id,service,True); active(row)
    if not db.execute(text('SELECT 1 FROM service_players WHERE player_id=:p AND tenant_id=:t'), {'p':body.player_id,'t':service['tenant_id']}).scalar():
        raise HTTPException(404,'Player not found')
    if db.execute(text('SELECT 1 FROM room_bans WHERE room_id=:r AND player_id=:p'), {'r':room_id,'p':body.player_id}).scalar():
        raise HTTPException(403,'Player banned')
    existing=db.execute(text('SELECT 1 FROM room_members WHERE room_id=:r AND player_id=:p'), {'r':room_id,'p':body.player_id}).scalar()
    if not existing:
        count=db.execute(text('SELECT COUNT(*) FROM room_members WHERE room_id=:r'), {'r':room_id}).scalar()
        if count>=row['capacity']:
            raise HTTPException(409,'Room full')
        db.execute(text('INSERT INTO room_members(room_id,player_id) VALUES (:r,:p)'), {'r':room_id,'p':body.player_id})
    db.commit()
    return {'joined':True,'player_id':body.player_id}

@router.post('/rooms/{room_id}/leave')
def leave(room_id: str, body: Member, service=Depends(service_auth), db=Depends(get_db)):
    room(db,room_id,service,True)
    db.execute(text('DELETE FROM room_members WHERE room_id=:r AND player_id=:p'), {'r':room_id,'p':body.player_id})
    db.commit()
    return {'left':True}

@router.post('/rooms/{room_id}/ban')
def ban(room_id: str, body: Member, service=Depends(service_auth), db=Depends(get_db)):
    room(db,room_id,service,True)
    if not db.execute(text('SELECT 1 FROM service_players WHERE player_id=:p AND tenant_id=:t'), {'p':body.player_id,'t':service['tenant_id']}).scalar():
        raise HTTPException(404,'Player not found')
    db.execute(text('INSERT INTO room_bans(room_id,player_id) VALUES (:r,:p) ON CONFLICT DO NOTHING'), {'r':room_id,'p':body.player_id})
    db.execute(text('DELETE FROM room_members WHERE room_id=:r AND player_id=:p'), {'r':room_id,'p':body.player_id})
    db.commit()
    return {'banned':True}

@router.post('/rooms/{room_id}/heartbeat')
def heartbeat(room_id: str, body: Version, service=Depends(service_auth), db=Depends(get_db)):
    row=room(db,room_id,service,True); active(row)
    if row['version']!=body.version:
        raise HTTPException(409,'Version conflict')
    updated=db.execute(text("UPDATE rooms SET lease_until=CURRENT_TIMESTAMP+INTERVAL '90 seconds', version=version+1 WHERE room_id=:r RETURNING version,lease_until"), {'r':room_id}).mappings().one()
    db.commit()
    return dict(updated)

@router.post('/rooms/{room_id}/close')
def close(room_id: str, body: Version, service=Depends(service_auth), db=Depends(get_db)):
    row=room(db,room_id,service,True)
    if row['version']!=body.version:
        raise HTTPException(409,'Version conflict')
    db.execute(text('UPDATE rooms SET closed=TRUE,version=version+1 WHERE room_id=:r'), {'r':room_id})
    db.execute(text('DELETE FROM room_members WHERE room_id=:r'), {'r':room_id})
    db.commit()
    return {'closed':True,'version':row['version']+1}
