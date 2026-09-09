from fastapi import FastAPI, Request, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from sqlalchemy import text
from database import get_db, engine
from contextlib import asynccontextmanager
from core.telemetry import TelemetryMiddleware, render_metrics
from auth import require_role
from fastapi.responses import PlainTextResponse
from routers.user_routes import router as user_router
from routers.session_routes import router as session_router
from routers.service_routes import router as service_router
from core.logging import configure_logging
from core.limiter import limiter, enforce_anonymous_limit
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from models import Health

configure_logging()
@asynccontextmanager
async def lifespan(app):
    yield
    # Uvicorn drains in-flight requests before lifespan shutdown.
    engine.dispose()

app = FastAPI(title='Session Management API', version='1.1.0', lifespan=lifespan)
app.include_router(user_router)
app.include_router(session_router)
app.include_router(service_router)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.middleware('http')
async def edge_limit(request, call_next):
    if request.url.path not in ('/', '/health/ready'):
        try:
            # Counter I/O is synchronous; keep it off the event loop.
            from starlette.concurrency import run_in_threadpool
            await run_in_threadpool(enforce_anonymous_limit, request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code,
                content={'detail': {'code': 'rate_limited' if exc.status_code == 429 else 'unavailable'}},
                headers=exc.headers)
    return await call_next(request)

@app.exception_handler(HTTPException)
async def http_error(request, exc):
    code = {401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
            409: 'conflict', 422: 'invalid_request', 429: 'rate_limited', 503: 'unavailable'}.get(exc.status_code, 'request_failed')
    return JSONResponse(status_code=exc.status_code, content={'detail': {'code': code}}, headers=exc.headers)

@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Pydantic's default errors include rejected input (including passwords).
    return JSONResponse(status_code=422, content={'detail': {'code': 'invalid_request'}})

@app.get('/', response_model=Health)
def health_check():
    return Health()

@app.get('/health/ready', response_model=Health)
def ready(db=Depends(get_db)):
    db.execute(text('SELECT token_version FROM users LIMIT 0'))
    db.execute(text('SELECT session_code FROM user_sessions LIMIT 0'))
    db.execute(text('SELECT subject FROM users LIMIT 0'))
    db.execute(text('SELECT lease_until FROM rooms LIMIT 0'))
    db.execute(text('SELECT bucket_key FROM rate_limit_buckets LIMIT 0'))
    return Health()

@app.get('/metrics', response_class=PlainTextResponse, tags=['operations'])
def metrics(admin=Depends(require_role('admin'))):
    return PlainTextResponse(render_metrics(engine.pool), media_type='text/plain; version=0.0.4')

# Added last so request IDs cover validation and rate-limit responses as well.
app.add_middleware(TelemetryMiddleware)
