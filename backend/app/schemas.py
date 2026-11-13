"""Request and response shapes. Pydantic validates every request body
before any handler code runs, so handlers can trust their inputs."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import TokenStatus
from app.security import BCRYPT_MAX_BYTES


def _clean_text(value: str | None, field: str, *, required: bool) -> str | None:
    if value is None:
        if required:
            raise ValueError(f"{field} is required")
        return None
    # Collapse runs of whitespace so "  Front   desk " and "Front desk" match.
    value = " ".join(value.split())
    if not value:
        if required:
            raise ValueError(f"{field} cannot be blank")
        return None
    return value


# ---------- auth

class SignupIn(BaseModel):
    name: str = Field(max_length=100)
    email: EmailStr
    password: str = Field(min_length=8)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_text(v, "Name", required=True)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return v.lower()

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v.encode()) > BCRYPT_MAX_BYTES:
            raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return v.lower()


class ManagerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str


class AuthOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    manager: ManagerOut


# ---------- queues and tokens

class QueueIn(BaseModel):
    name: str = Field(max_length=80)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_text(v, "Queue name", required=True)


class TokenIn(BaseModel):
    label: str | None = Field(default=None, max_length=80)

    @field_validator("label")
    @classmethod
    def _label(cls, v: str | None) -> str | None:
        return _clean_text(v, "Name", required=False)


class MoveIn(BaseModel):
    direction: Literal["up", "down"]


class TokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    label: str | None
    status: TokenStatus
    created_at: datetime
    serving_at: datetime | None
    served_at: datetime | None
    cancelled_at: datetime | None


class QueueSummaryOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    waiting_count: int
    serving: TokenOut | None
    served_today: int


class QueueDetailOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    serving: TokenOut | None
    waiting: list[TokenOut]          # in queue order, front first
    recent: list[TokenOut]           # last finished tokens, newest first
    server_time: datetime            # lets the client correct for clock skew
