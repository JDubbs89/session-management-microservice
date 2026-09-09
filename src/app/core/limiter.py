"""Verified identity budgets and a separate IP ceiling; no forwarded headers are trusted."""
from hashlib import sha256
from threading import Lock
from time import time
from fastapi import HTTPException
from slowapi import Limiter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from config import settings


def client_ip(request):
    # Configure the ASGI server with --no-proxy-headers unless ingress IPs are pinned.
    return request.client.host if request.client else 'unknown'


def verified_key(request):
    return getattr(request.state, 'rate_limit_principal', None) or client_ip(request)


limiter = Limiter(key_func=verified_key)
_memory = {}
_lock = Lock()


def _consume(key, limit, seconds):
    now = int(time())
    window = now // seconds * seconds
    if settings.rate_limit_storage == 'postgresql':
        from database import engine
        try:
            # A separate transaction commits charged requests, including rejected calls.
            with engine.begin() as conn:
                hits = conn.execute(text('''
                    INSERT INTO rate_limit_buckets(bucket_key, window_start, hits, expires_at)
                    VALUES (:key, :window, 1, to_timestamp(:expiry))
                    ON CONFLICT(bucket_key) DO UPDATE SET
                      hits = CASE WHEN rate_limit_buckets.window_start = EXCLUDED.window_start
                             THEN rate_limit_buckets.hits + 1 ELSE 1 END,
                      window_start = EXCLUDED.window_start, expires_at = EXCLUDED.expires_at
                    RETURNING hits
                '''), {'key': key, 'window': window, 'expiry': window + seconds}).scalar_one()
                # Bound abandoned keys without a scheduler; active fixed keys are reused.
                conn.execute(text('DELETE FROM rate_limit_buckets WHERE bucket_key IN '
                                  '(SELECT bucket_key FROM rate_limit_buckets WHERE expires_at < now() '
                                  'ORDER BY expires_at LIMIT 100)'))
        except SQLAlchemyError:
            raise HTTPException(status_code=503, detail='Rate limiter unavailable') from None
    else:
        with _lock:
            for expired in [k for k, (_, expiry) in _memory.items() if expiry <= now]:
                del _memory[expired]
            count, expiry = _memory.get(key, (0, window + seconds))
            hits = count + 1
            _memory[key] = (hits, expiry)
    if hits > limit:
        raise HTTPException(status_code=429, detail='Rate limit exceeded',
                            headers={'Retry-After': str(window + seconds - now)})


def enforce_limit(request, principal, scope='service', limit=120, seconds=60):
    """Call only after verifying a principal. Principal and IP are independent budgets."""
    if not limiter.enabled:
        return
    # The IP ceiling intentionally allows many players on one game-server connection.
    for kind, identity, budget in [('principal', principal, limit), ('ip', client_ip(request), 1200)]:
        key = sha256(f'{scope}:{kind}:{identity}:{seconds}'.encode()).hexdigest()
        _consume(key, budget, seconds)


def enforce_anonymous_limit(request):
    if limiter.enabled:
        key = sha256(f'edge:{client_ip(request)}'.encode()).hexdigest()
        _consume(key, 1200, 60)
