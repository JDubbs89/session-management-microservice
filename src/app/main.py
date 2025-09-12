from fastapi import FastAPI, Depends, HTTPException, Header, Request
from dotenv import load_dotenv

load_dotenv()

from routers.user_routes import router as user_router
from routers.session_routes import router as session_router

from core.limiter import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded


# Initialize FastAPI application
app = FastAPI()
app.include_router(user_router)
app.include_router(session_router)

app.state.limiter = limiter

app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.get("/")
@limiter.limit("6/minute")
def health_check(request: Request):
    return {"status": "ok"}