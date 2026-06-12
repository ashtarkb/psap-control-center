from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.auth import (
    validate_credentials,
    create_session_token,
    get_current_user,
    COOKIE_NAME,
)
from app.core.config import settings
from app.utils.logger import create_logger

router = APIRouter()
logger = create_logger("AuthAPI")


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    user = validate_credentials(body.username, body.password)
    if user is None:
        logger.warn(f"Failed login attempt for user: {body.username}")
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid credentials"},
        )

    token = create_session_token(user["username"], user["role"])

    is_secure = request.url.scheme == "https" or \
        request.headers.get("x-forwarded-proto") == "https"

    response = JSONResponse(content={
        "username": user["username"],
        "role": user["role"],
    })
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        path="/api",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    logger.info(f"User '{user['username']}' logged in (role={user['role']})")
    return response


@router.post("/logout")
async def logout():
    response = JSONResponse(content={"detail": "Logged out"})
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/api",
    )
    return response


@router.get("/me")
async def me(request: Request):
    user = get_current_user(request)
    if user is None:
        return JSONResponse(
            status_code=401,
            content={"detail": "Not authenticated"},
        )
    return {"username": user["username"], "role": user["role"]}
