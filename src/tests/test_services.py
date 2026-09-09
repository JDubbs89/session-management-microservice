from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from routers.service_routes import (
    Member, RoomCreate, ServiceCreate, Version, active, ban, heartbeat,
    join, leave, player_grant, public_origin, room,
)


@pytest.mark.parametrize('address', [
    'http://game.example.com', 'https://localhost', 'wss://127.0.0.1',
    'https://10.1.1.1', 'https://[::1]', 'https://game.internal',
    'https://localhost.', 'wss://user:password@game.example.com',
    'wss://game.example.com?token=secret', 'https://game.example.com/#secret',
    'https://game.example.com\\@127.0.0.1', 'https://game.example.com:bad',
])
def test_connection_metadata_rejects_unsafe_addresses(address):
    with pytest.raises(ValidationError):
        RoomCreate(code='abc', game='trivia', protocol='trivia/1', capacity=4, public_address=address)


def test_origins_are_admin_approved_and_normalized():
    body = ServiceCreate(tenant_id='a', allowed_origins=['wss://Game.Example.com:443/'])
    assert body.allowed_origins == ['wss://game.example.com']
    assert 'players:act' not in body.scopes
    assert public_origin('wss://game.example.com/play') == body.allowed_origins[0]
    with pytest.raises(ValidationError):
        ServiceCreate(tenant_id='a', allowed_origins=['wss://game.example.com/play'])


@pytest.mark.parametrize('operation', [join, leave, ban])
def test_membership_requires_explicit_act_scope_even_room_owner(operation):
    db = Mock()
    with pytest.raises(HTTPException) as exc:
        operation('room', Member(player_id='p'), {'scopes':['rooms:write']}, db)
    assert exc.value.status_code == 403
    db.execute.assert_not_called()


def test_act_scope_does_not_grant_another_services_player():
    db = Mock()
    db.execute.return_value.scalar.return_value = None
    with pytest.raises(HTTPException) as exc:
        player_grant(db, {'scopes':['players:act'], 'tenant_id':'a','service_id':'s'}, 'p')
    assert exc.value.status_code == 403


def test_room_mutation_checks_tenant_and_owner():
    db = Mock()
    db.execute.return_value.mappings.return_value.first.return_value = {'service_id':'other'}
    with pytest.raises(HTTPException) as exc:
        room(db,'r',{'scopes':['rooms:write'],'tenant_id':'a','service_id':'s'}, True)
    assert exc.value.status_code == 403
    assert db.execute.call_args.args[1] == {'r':'r','t':'a'}


def test_expired_lease_is_not_revived():
    with pytest.raises(HTTPException) as exc:
        active({'closed':False,'lease_until':datetime.now(timezone.utc)-timedelta(seconds=1)})
    assert exc.value.status_code == 409


def test_heartbeat_rejects_stale_version_without_writing():
    db=Mock()
    db.execute.return_value.mappings.return_value.first.return_value = {
        'service_id':'s','closed':False,'lease_until':datetime.now(timezone.utc)+timedelta(seconds=60),'version':2}
    with pytest.raises(HTTPException) as exc:
        heartbeat('r', Version(version=1), {'scopes':['rooms:write'],'tenant_id':'a','service_id':'s'}, db)
    assert exc.value.status_code == 409
    assert db.execute.call_count == 1
    db.commit.assert_not_called()
