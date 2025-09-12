from fastapi import Request, APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
import os
import os
from core.limiter import limiter
from database import get_db
from models import UserCreate, UserDelete, User, Token
from auth import create_access_token, require_role
from crud_user import (
    create_user, 
    get_user_by_username, 
    delete_user, verify_password, 
    log_out_user, 
    log_in_user
    )

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

router = APIRouter(prefix="/users")

# Constants are unused for now, they won't work for some reason
ROLE_STANDARD = "user", "admin"
ROLE_ADMIN = "admin"
ROLE_USER = "user"


# Create User
@router.post("/register", response_model=User)
@limiter.limit("6/minute")
def register(request: Request, user: UserCreate, db: Session = Depends(get_db)):
    create_user(db, user.user_id, user.steam_id, user.username, user.password)
    out_user = get_user_by_username(db, user.username)
    
    return User(user_id=out_user["user_id"], username=out_user["username"], role=out_user["role"])


# Create Admin User
@router.post("/register_admin", response_model=User)
@limiter.limit("6/minute")
def register_admin(request: Request, user: UserCreate, db: Session = Depends(get_db), admin = Depends(require_role("admin"))):
    create_user(db, user.user_id, user.steam_id, user.username, user.password, role="admin")
    out_user = get_user_by_username(db, user.username)
    
    return User(user_id=out_user["user_id"], username=out_user["username"], role=out_user["role"])


# Read User
@router.get("/me", response_model=User)
@limiter.limit("1/second")
def get_me(request: Request, current_user=Depends(require_role("user", "admin"))):
    return User(user_id=current_user["user_id"], username=current_user["username"], role=current_user["role"])


# Admin only function to read any user
@router.get("/get_user", response_model=User)
@limiter.limit("1/second")
def get_user(request: Request, target_username: str, db: Session = Depends(get_db), current_user=Depends(require_role("admin")), ):
    
    user = get_user_by_username(db, target_username)
    
    return User(user_id=user["user_id"], username=user["username"], role=user["role"])


# Update User
@router.post("/login", response_model=Token)
@limiter.limit("1/second")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Tries to find the user by name and then validate the inputted password with the user's hashed password stored in the db
    user = get_user_by_username(db, form_data.username)
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Creates an access token with the user's name and role
    access_token = create_access_token(
        data={"sub": user["username"], "role": user["role"]}, 
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    
    log_in_user(db, user["username"], user["hashed_password"])
    
    return Token(access_token=access_token, token_type="bearer")


@router.post("/logout")
@limiter.limit("1/second")
def logout(request: Request, db: Session = Depends(get_db), current_user=Depends(require_role("user", "admin"))):
    log_out_user(db, current_user["username"], current_user["hashed_password"])


# Delete User
@router.delete("/delete")
@limiter.limit("1/second")
def delete(request: Request, user: UserDelete, db: Session = Depends(get_db), current_user=Depends(require_role("admin"))):
    
    delete_user(db, user.username, user.password, current_user["username"], current_user["hashed_password"])
    

@router.delete("/delete_me")
@limiter.limit("1/second")
def delete_me(request: Request, db: Session = Depends(get_db), current_user=Depends(require_role("user", "admin"))):
   
    delete_user(db, current_user["username"], current_user["hashed_password"], current_user["username"], current_user["hashed_password"])