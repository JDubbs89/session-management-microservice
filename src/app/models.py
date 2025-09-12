from pydantic import BaseModel


# Input model for creating users
class UserCreate(BaseModel):
    user_id: str
    steam_id: str
    username: str
    password: str
    
    
class UserDelete(BaseModel):
    username: str
    password: str


# Input model for login (OAuth2 handles this too)
class UserLogin(BaseModel):
    username: str
    password: str


# Output model for returning user data
class User(BaseModel):
    user_id: str
    username: str
    role: str

    class Config:
        orm_mode = True  # Enables compatibility with ORM objects

# Input model for a session modification (Endpoint checks if the host is the current user)
class UserSessionCreate(BaseModel):
    session_code: int
    host_username: str
    host_steam_id: str
    host_user_id: str
    beacon_metadata: str
    session_passcode: str = ''
    session_whitelist: str = '{}'
    session_blacklist: str = '{}'
    session_status: str = "active"
    allow_join: str = "public"  # can be "private", "friends only", or "public"
    

class UserSessionUpdate(BaseModel):
    session_code: int
    session_passcode: str
    settings_to_update: dict


# Output model for a session
class UserSession(BaseModel):
    session_code: int
    host_user_id: str
    host_username: str
    host_steam_id: str
    beacon_metadata: dict
    session_passcode: str
    session_whitelist: dict
    session_blacklist: dict
    session_status: str
    allow_join: str # can be "private", "friends only", or "public"
    
class BeaconMetadata(BaseModel):
    session_flavortext: str
    player_count: int
    max_player_count: int
    session_start_time: str  # ISO format datetime string
    host_username: str
    host_steam_id: str
    
    
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"