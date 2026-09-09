import os
from sqlalchemy.orm import Session
from database import get_db
from crud_user import get_user_by_username
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status, Security
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

# Secret and token settings and oauth setup
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/users/login")
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable not set")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))


# Creates a jwt token to send back to the client
def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# Checks required role to perform action
def require_role(*roles: str):
    def _role_guard(user=Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Access denied: insufficient permissions.")
        return user
    return _role_guard


# Decodes the submitted jwt token and tries to find and validate the user
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):

    # Defines an exception in the event of a failed authentication attempt
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


    # Tries to decode the jwt token and discern the username and role from it
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        role = payload.get("role")
        if not username or not role:
            raise credentials_exception
    except JWTError:
        raise credentials_exception


    # Tries to get the user from the database
    user = get_user_by_username(db, username)
    if not user or not user["user_online"]:
        raise credentials_exception


    # Check that db user role matches token role to prevent tampering
    if user["role"] != role:
        raise credentials_exception

    return user
