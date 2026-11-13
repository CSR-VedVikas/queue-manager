"""Database engine and per-request sessions."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

engine = create_engine(
    get_settings().sqlalchemy_url,
    pool_pre_ping=True,  # free-tier databases drop idle connections; test before use
    pool_size=5,
    max_overflow=5,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session (one transaction) per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
