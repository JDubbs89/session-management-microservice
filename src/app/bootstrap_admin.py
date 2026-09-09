"""Create the first service administrator from a trusted operator shell."""
import argparse
import getpass
import uuid
from sqlalchemy import text
from database import SessionLocal
from crud_user import create_user
from models import UserCreate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', default='trivia-service')
    args = parser.parse_args()
    password = getpass.getpass('New administrator password: ')
    if password != getpass.getpass('Confirm password: '):
        parser.error('Passwords do not match')
    identity = str(uuid.uuid4())
    user = UserCreate(user_id=identity, steam_id='service:' + identity,
                      username=args.username, password=password)
    with SessionLocal() as db:
        if db.execute(text("SELECT 1 FROM users WHERE user_role = 'admin' LIMIT 1")).scalar():
            parser.error('An administrator already exists; use /users/register_admin')
        create_user(db, user.user_id, user.steam_id, user.username, user.password, role='admin')
    print('Administrator created:', user.username)


if __name__ == '__main__':
    main()
