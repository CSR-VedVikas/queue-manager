"""Password hashing and JWT handling."""

from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import get_settings

BCRYPT_MAX_BYTES = 72

# A real bcrypt hash of a random string. Verified against when the email
# doesn't exist, so a failed login takes the same time either way and
# response timing can't reveal which emails are registered.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser", bcrypt.gensalt()).decode()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    candidate = password.encode()
    if len(candidate) > BCRYPT_MAX_BYTES:
        return False
    if password_hash is None:
        bcrypt.checkpw(candidate, _DUMMY_HASH.encode())
        return False
    return bcrypt.checkpw(candidate, password_hash.encode())


def create_access_token(manager_id: int) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(manager_id),
        "iat": now,
        "exp": now + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> int | None:
    """Return the manager id, or None if the token is invalid or expired."""
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
