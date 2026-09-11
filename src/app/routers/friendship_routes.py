"""Account friendships; identities always come from the authenticated account."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from database import get_db
from auth import require_role
from typing import Literal
from datetime import date

router = APIRouter(prefix='/friends', tags=['friends'])
account = require_role('user', 'admin')

class FriendRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=64)

class Resolution(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['accept', 'reject', 'cancel']

class Friend(BaseModel):
    user_id: str
    username: str
    friendship_age: date

class RequestResult(BaseModel):
    id: int
    status: Literal['pending', 'accepted', 'rejected', 'cancelled']

class SentRequest(RequestResult):
    expire_date: date

class PendingRequest(SentRequest):
    sender: str
    recipient: str


def pair_lock(db, a, b):
    # Serialize all transitions for a pair, including remove versus accept/send.
    db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:pair, 0))'),
               {'pair': repr(sorted([a, b]))})

@router.get('', response_model=list[Friend])
def friends(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=100000),
            user=Depends(account), db=Depends(get_db)):
    return db.execute(text('''SELECT u.user_id, u.username, f.friendship_age
        FROM user_friendships f JOIN users u ON u.user_id =
        CASE WHEN f.friend_1_id=:me THEN f.friend_2_id ELSE f.friend_1_id END
        WHERE :me IN (f.friend_1_id, f.friend_2_id)
        ORDER BY f.id LIMIT :limit OFFSET :offset'''),
        {'me': user['user_id'], 'limit': limit, 'offset': offset}).mappings().all()

@router.get('/requests', response_model=list[PendingRequest])
def requests(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=100000),
             user=Depends(account), db=Depends(get_db)):
    return db.execute(text('''SELECT r.id, s.username AS sender, t.username AS recipient,
        r.transaction_status AS status, r.expire_date
        FROM user_friend_transactions r JOIN users s ON s.user_id=r.sender_id
        JOIN users t ON t.user_id=r.recipient_id
        WHERE :me IN (r.sender_id,r.recipient_id) AND r.transaction_status='pending'
        AND r.expire_date >= CURRENT_DATE ORDER BY r.id LIMIT :limit OFFSET :offset'''),
        {'me': user['user_id'], 'limit': limit, 'offset': offset}).mappings().all()

@router.post('/requests', status_code=201, response_model=SentRequest)
def send(body: FriendRequest, user=Depends(account), db=Depends(get_db)):
    target = db.execute(text('SELECT user_id FROM users WHERE username=:name'), {'name': body.username}).scalar()
    if target is None:
        raise HTTPException(404)
    me = user['user_id']
    if target == me:
        raise HTTPException(409)
    pair_lock(db, me, target)
    params = {'me': me, 'target': target}
    if db.execute(text('''SELECT 1 FROM user_friendships WHERE
        (friend_1_id=:me AND friend_2_id=:target) OR (friend_2_id=:me AND friend_1_id=:target)'''), params).scalar():
        raise HTTPException(409)
    db.execute(text('''UPDATE user_friend_transactions SET transaction_status='cancelled'
        WHERE LEAST(sender_id,recipient_id)=LEAST(:me,:target)
        AND GREATEST(sender_id,recipient_id)=GREATEST(:me,:target)
        AND transaction_status='pending' AND expire_date<CURRENT_DATE'''), params)
    row = db.execute(text('''INSERT INTO user_friend_transactions(sender_id,recipient_id)
        VALUES (:me,:target) RETURNING id, transaction_status AS status, expire_date'''), params).mappings().one()
    db.commit()
    return row

@router.post('/requests/{request_id}', response_model=RequestResult)
def resolve(request_id: int, body: Resolution, user=Depends(account), db=Depends(get_db)):
    row = db.execute(text('SELECT * FROM user_friend_transactions WHERE id=:id'), {'id': request_id}).mappings().first()
    if not row or user['user_id'] not in (row['sender_id'], row['recipient_id']):
        raise HTTPException(404)
    expected = row['sender_id'] if body.action == 'cancel' else row['recipient_id']
    if user['user_id'] != expected:
        raise HTTPException(403)
    pair_lock(db, row['sender_id'], row['recipient_id'])
    status = {'accept': 'accepted', 'reject': 'rejected', 'cancel': 'cancelled'}[body.action]
    changed = db.execute(text('''UPDATE user_friend_transactions SET transaction_status=:status
        WHERE id=:id AND transaction_status='pending' AND expire_date>=CURRENT_DATE RETURNING id'''),
        {'status': status, 'id': request_id}).scalar()
    if changed is None:
        raise HTTPException(409)
    if body.action == 'accept':
        db.execute(text('INSERT INTO user_friendships(friend_1_id,friend_2_id) VALUES (:a,:b)'),
                   {'a': row['sender_id'], 'b': row['recipient_id']})
    db.commit()
    return {'id': request_id, 'status': status}

@router.delete('/{friend_id}', status_code=204)
def remove(friend_id: str, user=Depends(account), db=Depends(get_db)):
    pair_lock(db, user['user_id'], friend_id)
    result = db.execute(text('''DELETE FROM user_friendships WHERE
        (friend_1_id=:me AND friend_2_id=:target) OR (friend_2_id=:me AND friend_1_id=:target)'''),
        {'me': user['user_id'], 'target': friend_id})
    if not result.rowcount:
        raise HTTPException(404)
    db.commit()
