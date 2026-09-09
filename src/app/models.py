import json
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Privacy = Literal['public', 'private', 'friends only']
Name = Annotated[str, Field(min_length=1, max_length=64)]
Identifier = Annotated[str, Field(min_length=1, max_length=128)]
Code = Annotated[int, Field(strict=True, ge=1, le=2147483647)]
Status = Annotated[str, Field(min_length=1, max_length=32)]

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

class UserLogin(StrictModel):
    username: Name
    password: str = Field(min_length=1, max_length=72)

    @field_validator('password')
    @classmethod
    def password_bytes(cls, value):
        if len(value.encode()) > 72:
            raise ValueError('Password must be at most 72 UTF-8 bytes')
        return value

class UserCreate(UserLogin):
    # Accepted for old clients; the server always generates the stored ID.
    user_id: Identifier | None = None
    steam_id: Identifier | None = None
    password: str = Field(min_length=8, max_length=72)
    model_config = ConfigDict(extra='forbid', json_schema_extra={'examples': [{
        'user_id': 'player-001', 'steam_id': 'external-001', 'username': 'alice',
        'password': 'example-password-only'}]})

class UserDelete(UserLogin):
    pass

class User(BaseModel):
    subject: str | None = None
    user_id: str
    username: str
    role: Literal['user', 'admin']

class BeaconMetadata(StrictModel):
    session_flavortext: str = Field(max_length=512)
    player_count: int = Field(strict=True, ge=0, le=1000)
    max_player_count: int = Field(strict=True, ge=1, le=1000)
    session_start_time: str = Field(min_length=1, max_length=64)
    host_username: Name
    host_steam_id: str = Field(default='', max_length=128)
    session_status: Status | None = None

    @model_validator(mode='after')
    def capacity(self):
        if self.player_count > self.max_player_count:
            raise ValueError('Player count exceeds capacity')
        return self

class UserSessionCreate(StrictModel):
    session_code: Code
    host_username: Name
    host_steam_id: str = Field(default='', max_length=128)
    host_user_id: str = Field(default='', max_length=128)
    beacon_metadata: str = Field(default='{}', max_length=4096)
    session_passcode: str = Field(default='', max_length=72)
    session_whitelist: str = Field(default='[]', max_length=16384)
    session_blacklist: str = Field(default='[]', max_length=16384)
    session_status: Status = 'active'
    allow_join: Privacy = 'public'

    @field_validator('session_passcode')
    @classmethod
    def passcode_bytes(cls, value):
        if len(value.encode()) > 72 or '\x00' in value:
            raise ValueError('Passcode must be at most 72 UTF-8 bytes without NUL')
        return value

    @field_validator('session_whitelist', 'session_blacklist')
    @classmethod
    def json_array(cls, value):
        parsed = json.loads(value)
        if not isinstance(parsed, list) or len(parsed) > 100 or any(
            not isinstance(item, str) or not 1 <= len(item) <= 64 for item in parsed):
            raise ValueError('Expected at most 100 usernames of 1 to 64 characters')
        return value

    @field_validator('beacon_metadata')
    @classmethod
    def metadata(cls, value):
        parsed = json.loads(value)
        if parsed != {}:
            BeaconMetadata.model_validate(parsed)
        return value

class SessionCreateRequest(StrictModel):
    session: UserSessionCreate
    beacon_metadata: BeaconMetadata
    model_config = ConfigDict(extra='forbid', json_schema_extra={'examples': [{
        'session': {'session_code': 123456, 'host_username': 'alice'},
        'beacon_metadata': {'session_flavortext': 'Trivia', 'player_count': 1,
                            'max_player_count': 4, 'session_start_time': '2026-09-09T12:00:00Z',
                            'host_username': 'alice'}
    }]})

class UserSessionUpdate(StrictModel):
    session_code: Code
    # Kept as an empty compatibility field; authenticated ownership authorizes updates.
    session_passcode: Literal[''] = ''
    settings_to_update: dict = Field(max_length=7)

    @field_validator('settings_to_update')
    @classmethod
    def settings(cls, value):
        allowed = {'session_code', 'session_passcode', 'session_status', 'beacon_metadata',
                   'session_whitelist', 'session_blacklist', 'allow_join'}
        if value.keys() - allowed:
            raise ValueError('Unknown session setting')
        candidate = {'session_code': 1, 'host_username': 'host'}
        for key, item in value.items():
            if key in ('beacon_metadata', 'session_whitelist', 'session_blacklist'):
                candidate[key] = item if isinstance(item, str) else json.dumps(item)
            else:
                candidate[key] = item
        UserSessionCreate.model_validate(candidate)
        if 'beacon_metadata' in value:
            item = value['beacon_metadata']
            BeaconMetadata.model_validate(json.loads(item) if isinstance(item, str) else item)
        return value

class UserSession(BaseModel):
    """Public session view: credentials and admission lists never leave persistence."""
    session_code: int
    host_user_id: str
    host_username: str
    host_steam_id: str | None = None
    beacon_metadata: dict
    session_status: str
    allow_join: Privacy

class Token(BaseModel):
    access_token: str
    token_type: Literal['bearer'] = 'bearer'

class Health(BaseModel):
    status: Literal['ok'] = 'ok'
