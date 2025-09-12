from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError
from sqlalchemy import text
from fastapi import HTTPException
from models import UserSession, BeaconMetadata, UserSessionUpdate, UserSessionCreate
from crud_user import get_user_by_username
import json


def safe_json_parse(json_string, default=None):
    """Safely parse JSON string, return default if parsing fails"""
    if default is None:
        default = {}
    
    # Handle None, empty string, or whitespace-only strings
    if not json_string or not str(json_string).strip():
        return default
    
    try:
        return json.loads(str(json_string))
    except (json.JSONDecodeError, TypeError) as e:
        print(f"JSON parse error for '{json_string}': {e}")
        return default


# Create a session, called after token validation
def create_session(db: Session, session: UserSessionCreate, beacon_metadata: BeaconMetadata):
    try:
        beacon_metadata_string = beacon_metadata.model_dump_json()
        
        result = db.execute(text("SELECT * FROM create_session(:c, :h, :b, :p, :s, :w, :bl, :a)"),
                   {"c": session.session_code, "h": session.host_username, "b": beacon_metadata_string, "p": session.session_passcode, 
                    "s": session.session_status, "w": session.session_whitelist, "bl": session.session_blacklist, 
                    "a": session.allow_join})
        row = result.fetchone()
        db.commit()
        if row:
            print(f"Row type: {type(row)}")
            print(f"Row length: {len(row) if row else 'None'}")
            print(f"Row content: {row}")
            beacon_metadata_parsed = safe_json_parse(row[6], {})
            session_whitelist_parsed = safe_json_parse(row[8], {})
            session_blacklist_parsed = safe_json_parse(row[9], {})
            return UserSession(
                session_passcode=str(row[1]), 
                session_code=int(row[0]),
                host_username=str(row[3]),
                host_steam_id=str(row[4]),
                host_user_id=str(row[2]),
                beacon_metadata=beacon_metadata_parsed,
                session_status=str(row[6]),
                session_whitelist=session_whitelist_parsed,
                session_blacklist=session_blacklist_parsed,
                allow_join=str(row[9]) if len(row) > 9 else None  # Add safety check
            )
        return None
    except (DBAPIError, json.JSONDecodeError) as e:
        db.rollback()
        if isinstance(e, json.JSONDecodeError):
            raise HTTPException(status_code=500, detail=f"Invalid JSON data: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e.orig))


# Delete a session from the database
def delete_session(db: Session, session_code: int, host_username: str, session_passcode: str = ''):
    try:
        db.execute(text("SELECT delete_session(:c, :h, :p)"), 
                   {"c": session_code, "h": host_username, "p": session_passcode})
        db.commit()
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))


# Takes in a Host username and returns the session row as a dict
def get_user_session_by_host(db: Session, host_username: str, client_username: str, session_passcode: str = ''):
    try:
        result = db.execute(text("SELECT get_session_by_username(:h, :c, :p)"), 
                            {"h": host_username, "c": client_username, "p": session_passcode})
        row = result.fetchone()
        if row:
            return UserSession(row[0], row[2], row[3], row[4],
                               row[5], row[1], row[6], row[7], 
                               row[8], row[9])
        else:
            raise HTTPException(status_code=404, detail="Session not found")
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))


# Takes in a host ID and returns the session data
def get_user_session_data_by_host(db: Session, host_username: str):
    default_flavortext = "Some delicious flavor text"
    default_player_count = 0
    default_max_player_count = 4
    default_start_time = "2025-01-01T00:00:00Z"
    try:
        result = db.execute(text("SELECT get_session_preview_by_username(:h)"),
            {"h": host_username})
        row = result.fetchone()
        if row:
            beacon_data = row[0]
            return BeaconMetadata(
                session_flavortext = beacon_data.get("session_flavortext", default_flavortext),
                player_count = beacon_data.get("player_count", default_player_count),
                max_player_count = beacon_data.get("max_player_count", default_max_player_count),
                session_start_time = beacon_data.get("session_start_time", default_start_time),
                host_username = beacon_data.get("host_username", ""),
                host_steam_id = beacon_data.get("host_steam_id", "")
                )
        else:
            raise HTTPException(status_code=404, detail="Session not found")
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))
    
    
# Takes in a session code and returns the session data
def get_user_session_data_by_code(db: Session, session_code: int):
    default_flavortext = "Some delicious flavor text"
    default_player_count = 0
    default_max_player_count = 4
    default_start_time = "2025-01-01T00:00:00Z"
    try:
        result = db.execute(text("SELECT get_session_preview_by_code(:c)"),
            {"c": session_code})
        row = result.fetchone()
        if row:
            beacon_data = row[0]
            return BeaconMetadata(
                session_flavortext = beacon_data.get("session_flavortext", default_flavortext),
                player_count = beacon_data.get("player_count", default_player_count),
                max_player_count = beacon_data.get("max_player_count", default_max_player_count),
                session_start_time = beacon_data.get("session_start_time", default_start_time),
                host_username = beacon_data.get("host_username", ""),
                host_steam_id = beacon_data.get("host_steam_id", "")
                )
        else:
            raise HTTPException(status_code=404, detail="Session not found")
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))
    

def is_friend_hosting_session(db: Session, friend_name: str):
    friend = get_user_by_username(db, friend_name)
    if friend and check_user_hosting_session(db, friend["username"]):
        return True
    return False


def check_session_exists(db: Session, session_code: int):
    try:
        result = db.execute(text("SELECT does_session_exist(:c)"),
                            {"c": session_code})
        row = result.fetchone()
        if row and row[0]:
            return True
        else:
            return False
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))
    

def check_user_hosting_session(db: Session, host_username: str):
    try:
        result = db.execute(text("SELECT check_user_hosting_session(:h)"),
                            {"h": host_username})
        row = result.fetchone()
        if row and row[0]:
            return True
        else:
            return False
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))


def update_session(db: Session, session_update: UserSessionUpdate, current_username: str):

    if not check_session_exists(db, session_update.session_code):
        raise HTTPException(status_code=404, detail="Session does not exist")

    session_data = get_user_session_data_by_code(db, session_update.session_code)
    
    session_host = get_user_by_username(db, session_data.host_username)
    if not session_host:
        raise HTTPException(status_code=404, detail="Session host does not exist")

    session = get_user_session_by_host(db, session_host, current_username, session_update.session_passcode)

    settings = session_update.settings_to_update


    try:
        db.execute(
            text(
                "SELECT update_session(:sc, :hn, :hp, :sp, :nc, :np, :ns, :nm, :nw, :nb, :na)"
                 ),
                   {
                       "sc": session_update.session_code,
                       "hn": session_host["username"], # Hostname and host password are not modifier params
                       "hp": session_host["hashed_password"],
                       "sp": settings.get("session_passcode", session_update.session_passcode),
                       "nc": settings.get("session_code", session_update.session_code),
                       "np": settings.get("session_passcode", session_update.session_passcode),
                       "ns": settings.get("session_status", session.session_status),
                       "nm": settings.get("beacon_metadata", session.beacon_metadata),
                       "nw": settings.get("session_whitelist", session.session_whitelist),
                       "nb": settings.get("session_blacklist", session.session_blacklist),
                       "na": settings.get("allow_join", session.allow_join)
                    })
        db.commit()
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))