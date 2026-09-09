"""Container readiness: the HTTP process and initialized database must respond."""
import json
import os
from urllib.request import urlopen

from sqlalchemy import create_engine, text


def main():
    with urlopen('http://127.0.0.1:8000/', timeout=2) as response:
        if json.load(response).get('status') != 'ok':
            raise RuntimeError('API is not healthy')
    engine = create_engine(os.environ['DATABASE_URL'], connect_args={'connect_timeout': 3})
    try:
        with engine.connect() as connection:
            connection.execute(text('SELECT user_id FROM users LIMIT 0'))
            connection.execute(text('SELECT session_code FROM user_sessions LIMIT 0'))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
