from unittest.mock import Mock
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from routers.friendship_routes import send, resolve, remove, FriendRequest, Resolution
from main import app


def test_social_routes_registered_and_bodies_strict():
    paths = app.openapi()['paths']
    assert '/friends' in paths and '/friends/requests/{request_id}' in paths
    with pytest.raises(ValidationError):
        FriendRequest(username='target', sender_id='spoof')
    with pytest.raises(ValidationError):
        Resolution(action='accepted')


def test_self_and_unknown_requests_are_rejected():
    for target, status in [(None, 404), ('self', 409)]:
        db = Mock(); db.execute.return_value.scalar.return_value = target
        with pytest.raises(HTTPException) as exc:
            send(FriendRequest(username='name'), {'user_id': 'self'}, db)
        assert exc.value.status_code == status
        db.commit.assert_not_called()


@pytest.mark.parametrize('identity,action,status', [('sender','accept',403), ('sender','reject',403), ('recipient','cancel',403), ('outsider','accept',404)])
def test_only_recipient_resolves_and_only_sender_cancels(identity, action, status):
    db = Mock(); db.execute.return_value.mappings.return_value.first.return_value = {'sender_id':'sender','recipient_id':'recipient'}
    with pytest.raises(HTTPException) as exc:
        resolve(1, Resolution(action=action), {'user_id':identity}, db)
    assert exc.value.status_code == status
    db.commit.assert_not_called()
    assert db.execute.call_count == 1


def test_expired_or_already_resolved_requests_do_not_create_friendship():
    db = Mock(); db.execute.return_value.mappings.return_value.first.return_value = {'sender_id':'sender','recipient_id':'recipient'}
    db.execute.return_value.scalar.return_value = None
    with pytest.raises(HTTPException) as exc:
        resolve(1, Resolution(action='accept'), {'user_id':'recipient'}, db)
    assert exc.value.status_code == 409
    db.commit.assert_not_called()
    assert not any('INSERT INTO user_friendships' in str(call.args[0]) for call in db.execute.call_args_list)


def test_remove_nonexistent_friend_is_not_success():
    db = Mock(); db.execute.return_value.rowcount = 0
    with pytest.raises(HTTPException) as exc:
        remove('target', {'user_id':'self'}, db)
    assert exc.value.status_code == 404
    db.commit.assert_not_called()
