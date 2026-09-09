"""Bounded process-local metrics and request IDs; never label with user input."""
import json
import logging
from collections import defaultdict
from contextvars import ContextVar
from threading import Lock
from time import perf_counter
from uuid import uuid4

request_id = ContextVar('request_id', default=None)
logger = logging.getLogger('api.requests')
_lock = Lock()
_counts = defaultdict(int)
_seconds = defaultdict(float)
_buckets = defaultdict(lambda: [0] * 7)
BOUNDARIES = (0.01, 0.05, 0.1, 0.5, 1, 5, float('inf'))

class TelemetryMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        identity = str(uuid4())
        token = request_id.set(identity)
        scope.setdefault('state', {})['request_id'] = identity
        start, status, started = perf_counter(), 500, False
        async def send_with_id(message):
            nonlocal status, started
            if message['type'] == 'http.response.start':
                started = True
                status = message['status']
                message = dict(message)
                message['headers'] = list(message.get('headers', [])) + [(b'x-request-id', identity.encode())]
            await send(message)
        try:
            await self.app(scope, receive, send_with_id)
        except Exception as exc:
            logger.error('request_failed', extra={'error_type': type(exc).__name__})
            if started:
                raise RuntimeError('Response failed') from None
            from starlette.responses import JSONResponse
            await JSONResponse({'detail': {'code': 'internal_error'}}, status_code=500)(scope, receive, send_with_id)
        finally:
            elapsed = perf_counter() - start
            route = getattr(scope.get('route'), 'path', 'unmatched')
            method = scope.get('method', 'OTHER')
            if method not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'):
                method = 'OTHER'
            key = (method, route, status)
            with _lock:
                _counts[key] += 1
                _seconds[key] += elapsed
                for index, boundary in enumerate(BOUNDARIES):
                    if elapsed <= boundary:
                        _buckets[key][index] += 1
            logger.info('request_completed', extra={'method': method, 'route': route,
                        'status': status, 'duration_ms': round(elapsed * 1000, 3)})
            request_id.reset(token)

def render_metrics(pool):
    lines = ['# TYPE api_requests_total counter', '# TYPE api_request_duration_seconds histogram']
    with _lock:
        for key in sorted(_counts):
            method, route, status = key
            labels = f'method={json.dumps(method)},route={json.dumps(route)},status="{status}"'
            lines += [f'api_requests_total{{{labels}}} {_counts[key]}',
                      f'api_request_duration_seconds_count{{{labels}}} {_counts[key]}',
                      f'api_request_duration_seconds_sum{{{labels}}} {_seconds[key]:.6f}']
            for boundary, count in zip(BOUNDARIES, _buckets[key]):
                upper = '+Inf' if boundary == float('inf') else str(boundary)
                lines.append(f'api_request_duration_seconds_bucket{{{labels},le="{upper}"}} {count}')
    lines += ['# TYPE api_db_connections_checked_out gauge',
              f'api_db_connections_checked_out {pool.checkedout()}',
              '# TYPE api_db_pool_size gauge', f'api_db_pool_size {pool.size()}']
    return '\n'.join(lines) + '\n'
