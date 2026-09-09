import logging
from fastapi import HTTPException

logger = logging.getLogger('api.database')

def database_error(db, exc):
    db.rollback()
    code = getattr(getattr(exc, 'orig', None), 'pgcode', None)
    status, public = (409, 'conflict') if code == '23505' else (503, 'database_unavailable')
    # SQLAlchemy exceptions may contain bound credentials. Log only class/code.
    logger.error('database_operation_failed', extra={'error_type': type(exc).__name__, 'sqlstate': code})
    return HTTPException(status_code=status, detail={'code': public})
