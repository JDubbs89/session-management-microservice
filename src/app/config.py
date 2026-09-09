"""Fail fast with field names only; never echo configuration secrets."""
import os
from dataclasses import dataclass
from sqlalchemy.engine import make_url
from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class Settings:
    database_url: str
    secret_key: str
    access_token_expire_minutes: int
    environment: str
    rate_limit_storage: str = "memory"


def load_settings(environ=None):
    env = os.environ if environ is None else environ
    environment = env.get('APP_ENV', 'development')
    if environment not in ('development', 'production', 'test'):
        raise ValueError('APP_ENV must be development, production, or test')
    database_url = env.get('DATABASE_URL', '')
    try:
        url = make_url(database_url)
        valid = url.drivername in ('postgresql', 'postgresql+psycopg2') and bool(url.host and url.database and url.username)
        if not valid or (url.port is not None and not 1 <= url.port <= 65535):
            raise ValueError()
    except Exception:
        raise ValueError('DATABASE_URL must be a valid PostgreSQL URL with host, database, and username') from None
    secret = env.get('SECRET_KEY', '')
    if len(secret.encode()) < 32 or secret.startswith('replace-with-'):
        raise ValueError('SECRET_KEY must contain at least 32 bytes and must not be a placeholder')
    if environment == 'production' and secret.startswith(('local-', 'test-', 'isolated-')):
        raise ValueError('SECRET_KEY must be replaced for production')
    try:
        expiry = int(env.get('ACCESS_TOKEN_EXPIRE_MINUTES', '30'))
        if not 1 <= expiry <= 1440:
            raise ValueError()
    except ValueError:
        raise ValueError('ACCESS_TOKEN_EXPIRE_MINUTES must be an integer from 1 to 1440') from None
    storage = env.get('RATE_LIMIT_STORAGE', 'postgresql' if environment == 'production' else 'memory')
    if storage not in ('memory', 'postgresql'):
        raise ValueError('RATE_LIMIT_STORAGE must be memory or postgresql')
    if environment == 'production' and storage != 'postgresql':
        raise ValueError('Production requires PostgreSQL rate-limit storage')
    return Settings(database_url, secret, expiry, environment, storage)

settings = load_settings()
