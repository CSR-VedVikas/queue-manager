import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import get_settings
from app.db import engine
from app.routers import auth, queues
from app.services.queue_service import QueueError

log = logging.getLogger("queue_manager")
settings = get_settings()
settings.check_production_safety()

app = FastAPI(
    title="Queue Manager API",
    # Interactive API docs are handy locally but needn't be public.
    docs_url=None if settings.env == "production" else "/docs",
    redoc_url=None,
    openapi_url=None if settings.env == "production" else "/openapi.json",
)


@app.middleware("http")
async def catch_unexpected_errors(request: Request, call_next):
    """Turn crashes into a JSON 500 *inside* the CORS middleware.

    Without this, an unhandled exception is answered by Starlette's outermost
    error handler, after CORS has been skipped, so the browser sees a
    response with no CORS headers and reports a misleading network error
    instead of the real 500."""
    try:
        return await call_next(request)
    except Exception:
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "The server ran into a problem. Try again in a moment."})


# Registered after the catch-all, so it wraps it (last added = outermost)
# and every response, including 500s, gets CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,  # we send a bearer token, not cookies
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(QueueError)
def queue_error_handler(_: Request, exc: QueueError) -> JSONResponse:
    """Turn business-rule violations into clean 404/409 responses."""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.get("/api/health")
def health():
    """Used by the frontend to wake the free-tier server, and by uptime pings."""
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(queues.router)
