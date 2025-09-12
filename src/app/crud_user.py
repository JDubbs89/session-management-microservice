from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from passlib.context import CryptContext
from fastapi import HTTPException

# Initialize the password context with a hashing algorithm
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# Takes in username, password, and role to create a new user with said parameters
def create_user(db: Session, user_id: str, steam_id: str, username: str, password: str, role: str = "user"):
    hashed = pwd_context.hash(password)
    try:
        db.execute(text("SELECT create_new_user(:i, :s, :u, :p, :r)"), 
                   {"i": user_id, "s": steam_id,"u": username, "p": hashed, "r": role})
        db.commit()
    except DBAPIError as e:
        db.rollback()
        # Detect the custom error message
        raise HTTPException(status_code=500, detail=str(e.orig))


# Takes in a username, password, and executor credentials, removing user upon success
def delete_user(db: Session, username: str, password: str, executor_name: str, executor_password: str):
    hashed = pwd_context.hash(password)
    try:
        db.execute(text("SELECT delete_user(:u, :p, :eu, :ep)"), 
                   {"u": username, "p": hashed, "eu": executor_name, "ep": executor_password})
        db.commit()
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))


# Takes the user's ID and password to log in the user (User token has already been verified when this gets called)
def log_in_user(db: Session, username: str, password: str):
    try:
        result = db.execute(text("SELECT get_user_id_by_name(:u)"), 
                         {"u": username})
        
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="User Invalid")
        user_id = row[0]
    
        db.execute(text("SELECT log_in_user(:u, :p)"),
               {"u": user_id, "p": password})
        db.commit()
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(e.orig))


# Takes the user's ID and password to log out the user, assuming the token is already verified
def log_out_user(db: Session, username: str, password: str):
    #hashed = pwd_context.hash(password)
    try:
        result = db.execute(text("SELECT get_user_id_by_name(:u)"), 
                         {"u": username})
        
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="User Invalid")
        user_id = row[0]
    
        db.execute(text("SELECT log_out_user(:u, :p)"),
               {"u": user_id, "p": password})
        db.commit()
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(e.orig))



# Takes the username in and fetches the user by their name from the db (NOTE: FOR IN API USE ONLY, PASSWORD IS NOT TO BE SENT BACK FROM API)
def get_user_by_username(db: Session, username: str):
    try:
        result = db.execute(text("SELECT * FROM get_user_by_name(:u)"), 
                            {"u": username})
        row = result.fetchone()
        if row:
            return {"user_id": row[1], "user_steam_id": row[2], "username": row[3], "hashed_password": row[4]
                    , "user_online": row[5], "last_activity": row[6], "role": row[7]}
        return None
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))


# Takes the steam id in and fetches the user by their name from the db (NOTE: FOR IN API USE ONLY, PASSWORD IS NOT TO BE SENT BACK FROM API)
def get_user_by_steam_id(db: Session, steam_id: str):
    try:
        result = db.execute(text("SELECT * FROM get_user_by_steam_id(:s)"), 
                            {"s": steam_id})
        row = result.fetchone()
        if row:
            return {"user_id": row[1], "user_steam_id": row[2], "username": row[3], "hashed_password": row[4]
                    , "user_online": row[5], "last_activity": row[6], "role": row[7]}
        return None
    except DBAPIError as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e.orig))


# Takes in plain password and hashed password, returning true if the password matches and false if it does not.
def verify_password(plain_password: str, hashed_password: str):
    return pwd_context.verify(plain_password, hashed_password)