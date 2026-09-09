"""Legacy SQL policy/integrity tests; disposable migrated PostgreSQL only."""
import os
import sys
import uuid
from pathlib import Path

if os.environ.get('INTEGRATION_TEST_DATABASE') != '1':
    raise SystemExit('Set INTEGRATION_TEST_DATABASE=1 for a disposable test database')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/app'))
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, DBAPIError
from database import engine
from migrate import migrate

migrate()
prefix = 'p2_' + uuid.uuid4().hex
with engine.connect() as c:
    tx = c.begin()
    def sql(query, **params):
        return c.execute(text(query), params)
    def fails(query, **params):
        save = c.begin_nested()
        try:
            sql(query, **params)
        except DBAPIError:
            save.rollback()
        else:
            save.rollback()
            raise AssertionError('Expected database rejection')
    try:
        users = [prefix + suffix for suffix in ('a','b','c')]
        a,b,d = users
        for u in users:
            sql('INSERT INTO users(user_id,user_steam_id,username,hashed_password) VALUES (:u,:u,:u,\'hash\')',u=u)
        for friend in (b,d):
            sql('INSERT INTO user_friendships(friend_1_id,friend_2_id) VALUES (:a,:b)',a=a,b=friend)
        fails('INSERT INTO user_friendships(friend_1_id,friend_2_id) VALUES (:b,:a)',a=a,b=b)
        fails('INSERT INTO user_friendships(friend_1_id,friend_2_id) VALUES (:a,:a)',a=a)
        codes=[]
        for i,u in enumerate((b,d)):
            code=sql('SELECT COALESCE(max(session_code),0)+1 FROM user_sessions').scalar()
            codes.append(code)
            sql("INSERT INTO user_sessions(session_code,host_user_id,host_username,host_steam_id,session_status,session_passcode,allow_join) VALUES (:code,:u,:u,:u,'active','secret','friends only')",code=code,u=u)
        def discover(limit=50, offset=0):
            return sql('SELECT * FROM get_friend_sessions(:a,:lim,:off)',a=a,lim=limit,off=offset).mappings().all()
        rows=discover()
        assert len(rows)==2 and all(r['session_passcode'] is None and r['session_blacklist'] is None for r in rows)
        assert discover(1,1)[0]['host_user_id']==d
        assert len(discover())==2  # repeated invocation has no temporary-table collision
        fails('SELECT * FROM get_friend_sessions(:a,0,0)',a=a)
        sql("UPDATE user_sessions SET allow_join='private' WHERE host_user_id=:b",b=b)
        assert len(discover())==1
        import json
        sql('UPDATE user_sessions SET session_whitelist=:wl WHERE host_user_id=:b',wl=json.dumps([a]),b=b)
        assert len(discover())==2
        sql('UPDATE user_sessions SET session_blacklist=:wl WHERE host_user_id=:b',wl=json.dumps([a]),b=b)
        assert len(discover())==1
        fails("SELECT * FROM get_session_by_steam_id(:b,:a,'')",b=b,a=a)
        sql("SELECT update_session(:code,:u,'hash','',:new,'rotated','ready','{}','[]','[]','public')",code=codes[0],u=b,new=codes[1]+1)
        row=sql('SELECT * FROM user_sessions WHERE host_user_id=:b',b=b).mappings().one()
        assert row['session_code']==codes[1]+1 and row['session_status']=='ready' and row['session_passcode']!='rotated'
        fails("SELECT update_session(:code,:u,'hash','',:new,NULL,'ended')",code=codes[1]+1,u=b,new=codes[1])
        assert sql('SELECT session_status FROM user_sessions WHERE host_user_id=:b',b=b).scalar()=='ready'
        sql('INSERT INTO user_friend_transactions(sender_id,recipient_id) VALUES (:a,:b)',a=a,b=b)
        fails('INSERT INTO user_friend_transactions(sender_id,recipient_id) VALUES (:b,:a)',a=a,b=b)
        sql("INSERT INTO user_messages(sender_id,recipient_id,message_content) VALUES (:a,:b,'hello')",a=a,b=b)
        sql("INSERT INTO account_external_identities(user_id,provider,external_subject) VALUES (:b,'steam',:b)",b=b)
        save=c.begin_nested()
        sql('DELETE FROM users WHERE user_id=:b',b=b)
        for table,col in [('user_sessions','host_user_id'),('user_friendships','friend_2_id'),('user_friend_transactions','recipient_id'),('user_messages','recipient_id'),('account_external_identities','user_id')]:
            assert sql(f'SELECT count(*) FROM {table} WHERE {col}=:b',b=b).scalar()==0
        save.rollback()
        assert sql('SELECT count(*) FROM user_messages WHERE recipient_id=:b',b=b).scalar()==1
        assert sql("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='last_activity'").scalar()=='timestamp with time zone'
    finally:
        tx.rollback()
print('P2 discovery policy, atomic rotation, social integrity, transactional cleanup, and timezone checks passed.')
