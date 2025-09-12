from fastapi import Request, APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from auth import require_role
from crud_user import get_user_by_username
from core.limiter import limiter
from database import get_db
from models import UserSession, BeaconMetadata, UserSessionUpdate, UserSessionCreate
from crud_user_session import (
    create_session,
    delete_session as crud_delete_session, 
    check_session_exists, 
    check_user_hosting_session, 
    get_user_session_by_host, 
    get_user_session_data_by_host,
    update_session as update_user_session,
    is_friend_hosting_session
    )


router = APIRouter(prefix="/sessions")

# Constants are unused for now, they won't work for some reason
ROLE_STANDARD = "user", "admin"
ROLE_ADMIN = "admin"
ROLE_USER = "user"

# CREATE SESSION ENDPOINT
@router.post("/create", response_model=UserSession)
@limiter.limit("1/second")
def create(
    request: Request, 
    session: UserSessionCreate,
    beacon_metadata: BeaconMetadata, 
    db: Session = Depends(get_db), 
    current_user = Depends(require_role("user", "admin"))
    ):
    # Does not need user steam id or user id, as they are in the db already and will be fetched
    return create_session(db, session, beacon_metadata)
    

# READ SESSION ENDPOINTS
# GET endpoint returning a friend's session reference
@router.get("/read_friend_session", response_model=UserSession)
@limiter.limit("20/second")
def read_friend_session(
    request: Request, db: Session = Depends(get_db), 
    current_user = Depends(require_role("user", "admin")), 
    friend_name: str = '', session_passcode: str = ''
    ):
    
    if not is_friend_hosting_session(db, friend_name):
        raise HTTPException(status_code=404, detail="User does not exist or is not hosting")

    return get_user_session_by_host(db, friend_name, current_user["username"], session_passcode)


# GET endpoint returning a friend's beacon metadata
@router.get("/read_friend_session_data", response_model=BeaconMetadata)
@limiter.limit("20/second")
def read_friend_session_data(
    request: Request, 
    db: Session = Depends(get_db), 
    current_user = Depends(require_role("user", "admin")), 
    friend_name: str = '', 
    ):
    
    if not is_friend_hosting_session(db, friend_name):
        raise HTTPException(status_code=404, detail="User does not exist or is not hosting")

    return get_user_session_data_by_host(db, friend_name, current_user["username"])


# GET endpoint returning the session data by session code
@router.get("/read_session_data", response_model=BeaconMetadata)
@limiter.limit("20/second")
def read_session_data(
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(require_role("user", "admin")),
    session_code: int = 0
    ):
    
    if not check_session_exists(db, session_code):
        raise HTTPException(status_code=404, detail="Session does not exist")

    return get_user_session_data_by_host(db, current_user["username"], session_code)


# UPDATE SESSION ENDPOINT
@router.put("/update")
@limiter.limit("1/second")
def update_session(
    request: Request,
    session: UserSessionUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(require_role("user", "admin"))
    ):
    
    if not check_session_exists(db, session.session_code):
        raise HTTPException(status_code=404, detail="Session does not exist")
    
    update_user_session(db, session, current_user["username"])


# DELETE SESSION ENDPOINT
@router.delete("/delete")
@limiter.limit("1/second")
def delete_session(
    request: Request, 
    session_code: int,
    host_username: str,
    session_passcode: str = '', 
    db: Session = Depends(get_db), 
    current_user = Depends(require_role("user", "admin"))
    ):
    
    if not check_session_exists(db, session_code):
        raise HTTPException(status_code=404, detail="Session does not exist")
    
    if host_username != current_user["username"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    crud_delete_session(db, session_code, host_username, session_passcode)