"""Create the local demo administrator when explicitly enabled."""
import os
import uuid
from sqlalchemy import text
from database import SessionLocal
from crud_user import create_user

username = os.environ.get('DEMO_ADMIN_USERNAME')
password = os.environ.get('DEMO_ADMIN_PASSWORD')
if not username or not password:
    raise SystemExit(0)
with SessionLocal() as db:
    if db.execute(text("SELECT 1 FROM users WHERE user_role = 'admin' LIMIT 1")).scalar():
        raise SystemExit(0)
    identity = str(uuid.uuid4())
    create_user(db, identity, 'service:' + identity, username, password, role='admin')
print('Demo administrator ready:', username)
