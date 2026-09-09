"""Structured application events with an explicit allowlist of safe fields."""
import json
import logging
from core.telemetry import request_id

class SafeFormatter(logging.Formatter):
    def format(self, record):
        result = {'level': record.levelname, 'event': record.getMessage(), 'request_id': request_id.get()}
        for key in ('error_type', 'sqlstate', 'method', 'route', 'status', 'duration_ms'):
            value = getattr(record, key, None)
            if value is not None:
                result[key] = value
        return json.dumps(result)

def configure_logging():
    for name in ('api.database', 'api.requests'):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        handler = logging.StreamHandler()
        handler.setFormatter(SafeFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
