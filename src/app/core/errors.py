import logging
from fastapi import HTTPException

logger = logging.getLogger('api.database')

def database_error(db, exc):
    db.rollback()
    code = getattr(getattr(exc, 'orig', None), 'pgcode', None)
    status, public = {
        '23505': (409, 'conflict'),
        '23503': (409, 'conflict'),
        '23514': (409, 'conflict'),
        '42501': (403, 'forbidden'),
        'P0002': (404, 'not_found'),
    }.get(code, (503, 'unavailable'))
    logger.error('database_operation_failed', extra={'error_type': type(exc).__name__, 'sqlstate': code})
    return HTTPException(status_code=status, detail={'code': public})
