import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request, status
from jose import JWTError, jwt

from app.core.config import settings
from app.utils.logger import create_logger

logger = create_logger("Auth")

COOKIE_NAME = "session"


def validate_credentials(username: str, password: str) -> Optional[dict]:
    """Check username/password against env-var accounts.
    Returns {"username": ..., "role": ...} on success, None on failure.
    """
    if secrets.compare_digest(username, settings.ADMIN_USERNAME) and \
       secrets.compare_digest(password, settings.ADMIN_PASSWORD):
        return {"username": username, "role": "admin"}

    if secrets.compare_digest(username, settings.USER_USERNAME) and \
       secrets.compare_digest(password, settings.USER_PASSWORD):
        return {"username": username, "role": "user"}

    return None


def create_session_token(username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(
        payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )


def decode_session_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        username: Optional[str] = payload.get("sub")
        role: Optional[str] = payload.get("role")
        if username is None or role is None:
            return None
        return {"username": username, "role": role}
    except JWTError:
        return None


def get_current_user(request: Request) -> Optional[dict]:
    """Extract user from the session cookie. Returns None if absent/invalid."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    return decode_session_token(token)


def require_auth(request: Request) -> dict:
    """Dependency: any authenticated user (admin or user)."""
    user = get_current_user(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return user


def require_admin(request: Request) -> dict:
    """Dependency: admin role only."""
    user = require_auth(request)
    if user["role"] != "admin":
        logger.warn(
            "Forbidden: user '%s' (role=%s) attempted admin action",
            user["username"], user["role"],
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
