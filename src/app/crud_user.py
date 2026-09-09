from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
import bcrypt
from uuid import uuid4
from fastapi import HTTPException
from core.errors import database_error

# Initialize the password context with a hashing algorithm
def hash_password(password: str):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(prefix=b'2a')).decode()


# Takes in username, password, and role to create a new user with said parameters
def create_user(db: Session, user_id: str, steam_id: str, username: str, password: str, role: str = "user"):
    hashed = hash_password(password)
    user_id = str(uuid4())
    try:
        db.execute(text("SELECT create_new_user(:i, :s, :u, :p, :r)"),
                   {"i": user_id, "s": steam_id or None,"u": username, "p": hashed, "r": role})
        if steam_id:
            db.execute(text("INSERT INTO account_external_identities(user_id, provider, external_subject) "
                            "VALUES (:user_id, 'steam', :steam_id)"),
                       {"user_id": user_id, "steam_id": steam_id})
        db.commit()
    except DBAPIError as e:
        db.rollback()
        # Detect the custom error message
        raise database_error(db, e) from e


# Takes in a username, password, and executor credentials, removing user upon success
def delete_user(db: Session, username: str, password: str, executor_name: str, executor_password: str):
    target = get_user_by_username(db, username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if password is not None and not verify_password(password, target["hashed_password"]):
        raise HTTPException(status_code=403, detail="Invalid target credentials")
    if password is None and username != executor_name:
        raise HTTPException(status_code=403, detail="Invalid target credentials")
    hashed = target["hashed_password"]
    try:
        db.execute(text("SELECT delete_user(:u, :p, :eu, :ep)"),
                   {"u": username, "p": hashed, "eu": executor_name, "ep": executor_password})
        db.commit()
    except DBAPIError as e:
        db.rollback()
        raise database_error(db, e) from e


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
        raise database_error(db, e) from e


# Takes the user's ID and password to log out the user, assuming the token is already verified
def log_out_user(db: Session, username: str, password: str):
    #hashed = hash_password(password)
    try:
        result = db.execute(text("SELECT get_user_id_by_name(:u)"),
                         {"u": username})

        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="User Invalid")
        user_id = row[0]

        db.execute(text("UPDATE users SET token_version = token_version + 1 WHERE user_id=:u"), {"u": user_id})
        db.execute(text("SELECT log_out_user(:u, :p)"),
               {"u": user_id, "p": password})
        db.commit()
    except DBAPIError as e:
        db.rollback()
        raise database_error(db, e) from e



# Takes the username in and fetches the user by their name from the db (NOTE: FOR IN API USE ONLY, PASSWORD IS NOT TO BE SENT BACK FROM API)
def get_user_by_username(db: Session, username: str):
    try:
        result = db.execute(text("SELECT * FROM users WHERE username = :u"),
                            {"u": username})
        row = result.fetchone()
        if row:
            data = dict(row._mapping)
            data["role"] = data.pop("user_role")
            data["subject"] = str(data.get("subject", data["user_id"]))
            return data
        return None
    except DBAPIError as e:
        db.rollback()
        raise database_error(db, e) from e


# Takes the steam id in and fetches the user by their name from the db (NOTE: FOR IN API USE ONLY, PASSWORD IS NOT TO BE SENT BACK FROM API)
def get_user_by_steam_id(db: Session, steam_id: str):
    try:
        result = db.execute(text("SELECT * FROM users WHERE user_steam_id = :s"),
                            {"s": steam_id})
        row = result.fetchone()
        if row:
            data = dict(row._mapping)
            data["role"] = data.pop("user_role")
            data["subject"] = str(data.get("subject", data["user_id"]))
            return data
        return None
    except DBAPIError as e:
        db.rollback()
        raise database_error(db, e) from e


# Takes in plain password and hashed password, returning true if the password matches and false if it does not.
def verify_password(plain_password: str, hashed_password: str):
    try:
        return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())
    except ValueError:
        return False


def get_user_by_subject(db: Session, subject: str):
    try:
        row = db.execute(text("SELECT username FROM users WHERE subject::text = :subject"),
                         {"subject": subject}).fetchone()
        return get_user_by_username(db, row[0]) if row else None
    except DBAPIError as exc:
        db.rollback()
        raise database_error(db, exc) from exc
