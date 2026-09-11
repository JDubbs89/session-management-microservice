"""Authenticated friendship lifecycle and races against a disposable migrated DB/API."""
import concurrent.futures
import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Set INTEGRATION_TEST_DATABASE=1 for a disposable database')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/app'))
from database import SessionLocal
from sqlalchemy import text
from crud_user import create_user
from auth import create_access_token

base = os.environ.get('SESSION_API_URL', 'http://127.0.0.1:8000')
prefix = 'friends_' + uuid.uuid4().hex[:12]
users = [prefix + suffix for suffix in ('a', 'b', 'c')]
tokens = []

def call(method, path, who=0, body=None):
    req = Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                  headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tokens[who]} if who is not None else {})})
    try:
        with urlopen(req, timeout=15) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except HTTPError as error:
        return error.code, json.loads(error.read())

def expect(status, *args, **kwargs):
    actual, body = call(*args, **kwargs)
    assert actual == status, (actual, status, body)
    return body

try:
    with SessionLocal() as db:
        for user in users:
            create_user(db, user, user, user, 'friend-test-password')
            db.execute(text('UPDATE users SET user_online=TRUE WHERE username=:u'), {'u':user})
            db.commit()
            tokens.append(create_access_token({'sub':user, 'role':'user', 'ver':0}))
    expect(401, 'GET', '/friends', None)
    expect(409, 'POST', '/friends/requests', body={'username':users[0]})
    expect(422, 'POST', '/friends/requests', body={'username':users[1], 'sender_id':users[2]})
    expect(404, 'POST', '/friends/requests', body={'username':prefix+'missing'})
    # Opposite-direction concurrent sends produce exactly one pending request.
    with concurrent.futures.ThreadPoolExecutor() as pool:
        results = list(pool.map(lambda who: call('POST', '/friends/requests', who, {'username':users[1-who]}), [0,1]))
    assert sorted(status for status, _ in results) == [201,409], results
    sender = next(i for i,r in enumerate(results) if r[0] == 201)
    recipient = 1-sender
    request_id = results[sender][1]['id']
    path = f'/friends/requests/{request_id}'
    assert expect(200, 'GET', '/friends/requests', 2) == []
    expect(404, 'POST', path, 2, {'action':'accept'})
    expect(403, 'POST', path, sender, {'action':'accept'})
    expect(403, 'POST', path, recipient, {'action':'cancel'})
    with concurrent.futures.ThreadPoolExecutor() as pool:
        results = list(pool.map(lambda _: call('POST', path, recipient, {'action':'accept'}), range(2)))
    assert sorted(status for status, _ in results) == [200,409], results
    a = expect(200, 'GET', '/friends?limit=1&offset=0', 0)
    b = expect(200, 'GET', '/friends', 1)
    assert a[0]['username'] == users[1] and b[0]['username'] == users[0]
    assert expect(200, 'GET', '/friends?limit=1&offset=1', 0) == []
    expect(422, 'GET', '/friends?limit=0')
    expect(409, 'POST', '/friends/requests', body={'username':users[1]})
    expect(404, 'DELETE', '/friends/'+a[0]['user_id'], 2)
    expect(204, 'DELETE', '/friends/'+a[0]['user_id'])
    assert expect(200, 'GET', '/friends', 1) == []
    for action in ('reject', 'cancel'):
        request_id = expect(201, 'POST', '/friends/requests', body={'username':users[1]})['id']
        expect(200, 'POST', f'/friends/requests/{request_id}', 1 if action == 'reject' else 0, {'action':action})
        expect(409, 'POST', f'/friends/requests/{request_id}', 1, {'action':'accept'})
    expired = expect(201, 'POST', '/friends/requests', body={'username':users[1]})['id']
    with SessionLocal() as db:
        db.execute(text("UPDATE user_friend_transactions SET expire_date=CURRENT_DATE-1 WHERE id=:id"), {'id':expired}); db.commit()
    assert expect(200, 'GET', '/friends/requests') == []
    expect(409, 'POST', f'/friends/requests/{expired}', 1, {'action':'accept'})
    new = expect(201, 'POST', '/friends/requests', body={'username':users[1]})['id']
    expect(200, 'POST', f'/friends/requests/{new}', 1, {'action':'accept'})
    # Account deletion cascades through the accepted friendship and request history.
    expect(204, 'DELETE', '/users/delete_me', 1)
    assert expect(200, 'GET', '/friends', 0) == []
    print('Friendship HTTP lifecycle, authorization, expiry, pagination, races, and cascade passed')
finally:
    with SessionLocal() as db:
        db.execute(text('DELETE FROM users WHERE username IN (:a,:b,:c)'), dict(zip(('a','b','c'),users)))
        db.commit()
