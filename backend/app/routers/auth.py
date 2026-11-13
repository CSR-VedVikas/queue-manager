from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_manager
from app.models import Manager
from app.schemas import AuthOut, LoginIn, ManagerOut, SignupIn
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
def signup(body: SignupIn, db: Session = Depends(get_db)):
    manager = Manager(name=body.name, email=body.email, password_hash=hash_password(body.password))
    db.add(manager)
    try:
        db.commit()
    except IntegrityError:
        # The unique index on email is the real guard: checking first and
        # inserting second would race if two signups arrive together.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists") from None
    return AuthOut(access_token=create_access_token(manager.id), manager=ManagerOut.model_validate(manager))


@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    manager = db.execute(select(Manager).where(Manager.email == body.email)).scalar_one_or_none()
    # verify_password still runs bcrypt when the account doesn't exist,
    # so both failure cases take the same time and return the same message.
    if not verify_password(body.password, manager.password_hash if manager else None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    return AuthOut(access_token=create_access_token(manager.id), manager=ManagerOut.model_validate(manager))


@router.get("/me", response_model=ManagerOut)
def me(manager: Manager = Depends(current_manager)):
    return manager
