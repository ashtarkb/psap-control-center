from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import require_admin
from app.services.settings_service import SettingsService
from app.services.slack_notifier import send_test_message, validate_webhook_url
from app.utils.logger import create_logger

router = APIRouter()
logger = create_logger("SettingsAPI")

SLACK_WEBHOOK_KEY = "slack_webhook_url"


def _mask_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    return url[:25] + "..." + url[-6:] if len(url) > 35 else url[:10] + "..."


class SlackSettingsResponse(BaseModel):
    webhook_url_masked: Optional[str] = None
    enabled: bool = False


class SlackSettingsUpdate(BaseModel):
    webhook_url: Optional[str] = None


@router.get("/slack", response_model=SlackSettingsResponse)
async def get_slack_settings(
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    service = SettingsService(db)
    url = await service.get(SLACK_WEBHOOK_KEY)
    return SlackSettingsResponse(
        webhook_url_masked=_mask_url(url),
        enabled=bool(url),
    )


@router.put("/slack", response_model=SlackSettingsResponse)
async def update_slack_settings(
    body: SlackSettingsUpdate,
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    service = SettingsService(db)
    url = body.webhook_url.strip() if body.webhook_url else None
    if url:
        error = validate_webhook_url(url)
        if error:
            raise HTTPException(status_code=400, detail=error)
    await service.set(SLACK_WEBHOOK_KEY, url)
    action = "configured" if url else "cleared"
    logger.info(
        f"Slack webhook {action} by {_user['username']}"
    )
    return SlackSettingsResponse(
        webhook_url_masked=_mask_url(url),
        enabled=bool(url),
    )


@router.post("/slack/test")
async def test_slack_webhook(
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    service = SettingsService(db)
    url = await service.get(SLACK_WEBHOOK_KEY)
    if not url:
        raise HTTPException(
            status_code=400,
            detail="No Slack webhook URL configured",
        )

    success = await send_test_message(url)
    if not success:
        raise HTTPException(
            status_code=502,
            detail="Failed to send test message to Slack",
        )

    return {"status": "ok", "message": "Test message sent successfully"}
