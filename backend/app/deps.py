"""Shared FastAPI dependencies."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Manager
from app.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


def current_manager(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Manager:
    unauthorised = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Not signed in", headers={"WWW-Authenticate": "Bearer"}
    )
    if creds is None:
        raise unauthorised
    manager_id = decode_access_token(creds.credentials)
    if manager_id is None:
        raise unauthorised
    manager = db.get(Manager, manager_id)
    if manager is None:  # account deleted after the token was issued
        raise unauthorised
    return manager
