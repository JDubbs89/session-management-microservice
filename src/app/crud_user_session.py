"""Session persistence. PostgreSQL owns admission rules; HTTP owns host identity."""
import json
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from models import UserSession, BeaconMetadata
from crud_user import get_user_by_username


def _execute(db, sql, params):
    try:
        return db.execute(text(sql), params)
    except DBAPIError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Session operation failed") from exc


def _session(row):
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")
    data = dict(row._mapping)
    for key in ('beacon_metadata', 'session_whitelist', 'session_blacklist'):
        data[key] = json.loads(data[key])
    return UserSession(**data)


def create_session(db, session, beacon_metadata):
    row = _execute(db, 'SELECT * FROM create_session(:c, :h, :b, :p, :s, :w, :bl, :a)', {
        'c': session.session_code, 'h': session.host_username,
        'b': beacon_metadata.model_dump_json(), 'p': session.session_passcode,
        's': session.session_status, 'w': session.session_whitelist,
        'bl': session.session_blacklist, 'a': session.allow_join,
    }).fetchone()
    result = _session(row)
    db.commit()
    return result


def delete_session(db, session_code, host_username, session_passcode=''):
    _execute(db, 'SELECT delete_session(:c, :h, :p)',
             {'c': session_code, 'h': host_username, 'p': session_passcode})
    db.commit()


def get_user_session_by_host(db, host_username, client_username, session_passcode=''):
    return _session(_execute(db, 'SELECT * FROM get_session_by_username(:h, :c, :p)',
                    {'h': host_username, 'c': client_username, 'p': session_passcode}).fetchone())


def get_user_session_data_by_host(db, host_username):
    row = _execute(db, 'SELECT get_session_preview_by_username(:h)', {'h': host_username}).fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=404, detail='Session not found')
    return BeaconMetadata(**row[0])


def get_user_session_data_by_code(db, session_code):
    row = _execute(db, 'SELECT get_session_preview_by_code(:c)', {'c': session_code}).fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=404, detail='Session not found')
    return BeaconMetadata(**row[0])


def is_friend_hosting_session(db, friend_name):
    # Legacy route name: public host discovery does not assert friendship.
    return bool(get_user_by_username(db, friend_name)) and check_user_hosting_session(db, friend_name)


def check_session_exists(db, session_code):
    return bool(_execute(db, 'SELECT does_session_exist(:c)', {'c': session_code}).scalar())


def check_user_hosting_session(db, host_username):
    return bool(_execute(db, 'SELECT check_user_hosting_session(:h)', {'h': host_username}).scalar())


def update_session(db, session_update, current_username):
    row = _execute(db, 'SELECT * FROM user_sessions WHERE session_code = :c FOR UPDATE',
                   {'c': session_update.session_code}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='Session not found')
    if row._mapping['host_username'] != current_username:
        raise HTTPException(status_code=403, detail='Only the host can update this session')
    if row._mapping['session_passcode'] != session_update.session_passcode:
        raise HTTPException(status_code=403, detail='Invalid session passcode')
    settings = session_update.settings_to_update
    assignments, params = [], {'code': session_update.session_code}
    for key, value in settings.items():
        if key == 'beacon_metadata':
            value = json.loads(value) if isinstance(value, str) else dict(value)
            value['host_username'] = row._mapping['host_username']
            value['host_steam_id'] = row._mapping['host_steam_id']
        if key in ('beacon_metadata', 'session_whitelist', 'session_blacklist'):
            value = json.dumps(value) if not isinstance(value, str) else value
        assignments.append(f'{key} = :{key}')  # Keys validated by UserSessionUpdate.
        params[key] = value
    if assignments:
        _execute(db, 'UPDATE user_sessions SET ' + ', '.join(assignments) + ' WHERE session_code = :code', params)
    db.commit()
