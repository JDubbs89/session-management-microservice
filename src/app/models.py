import json
from typing import Literal
from pydantic import BaseModel, Field, field_validator

Privacy = Literal['public', 'private', 'friends only']

class UserCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    steam_id: str = Field(min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=72)

    @field_validator('password')
    @classmethod
    def password_bytes(cls, value):
        if len(value.encode()) > 72:
            raise ValueError('Password must be at most 72 UTF-8 bytes')
        return value

class UserDelete(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class User(BaseModel):
    user_id: str
    username: str
    role: str

class UserSessionCreate(BaseModel):
    session_code: int = Field(ge=1, le=2147483647)
    host_username: str
    host_steam_id: str = ''
    host_user_id: str = ''
    beacon_metadata: str = '{}'
    session_passcode: str = ''
    session_whitelist: str = '[]'
    session_blacklist: str = '[]'
    session_status: str = 'active'
    allow_join: Privacy = 'public'

    @field_validator('session_whitelist', 'session_blacklist')
    @classmethod
    def json_array(cls, value):
        parsed = json.loads(value)
        if not isinstance(parsed, list) or any(not isinstance(item, str) for item in parsed):
            raise ValueError('Expected a JSON array of usernames')
        return value

class UserSessionUpdate(BaseModel):
    session_code: int = Field(ge=1, le=2147483647)
    session_passcode: str = ''
    settings_to_update: dict

    @field_validator('settings_to_update')
    @classmethod
    def settings(cls, value):
        allowed = {'session_code', 'session_passcode', 'session_status', 'beacon_metadata',
                   'session_whitelist', 'session_blacklist', 'allow_join'}
        if value.keys() - allowed:
            raise ValueError('Unknown session setting')
        for key, item in value.items():
            if key == 'beacon_metadata':
                BeaconMetadata.model_validate(json.loads(item) if isinstance(item, str) else item)
            elif key in ('session_whitelist', 'session_blacklist'):
                UserSessionCreate.json_array(item if isinstance(item, str) else json.dumps(item))
            elif key == 'allow_join' and item not in ('public', 'private', 'friends only'):
                raise ValueError('Invalid privacy')
            elif key == 'session_code' and (type(item) is not int or not 1 <= item <= 2147483647):
                raise ValueError('Invalid session code')
            elif key in ('session_passcode', 'session_status') and not isinstance(item, str):
                raise ValueError('Expected a string')
        return value

class UserSession(BaseModel):
    session_code: int
    host_user_id: str
    host_username: str
    host_steam_id: str
    beacon_metadata: dict
    session_passcode: str
    session_whitelist: list[str]
    session_blacklist: list[str]
    session_status: str
    allow_join: Privacy

class BeaconMetadata(BaseModel):
    session_flavortext: str
    player_count: int = Field(ge=0)
    max_player_count: int = Field(ge=1)
    session_start_time: str
    host_username: str
    host_steam_id: str = ''
    session_status: str | None = None

class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'
