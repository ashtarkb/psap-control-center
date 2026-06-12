import httpx
from urllib.parse import urlparse

from app.core.database import AsyncSessionLocal
from app.services.settings_service import SettingsService
from app.utils.logger import create_logger

logger = create_logger("SlackNotifier")

SLACK_WEBHOOK_KEY = "slack_webhook_url"

_ALLOWED_WEBHOOK_HOSTS = {"hooks.slack.com", "hooks.slack-gov.com"}


def validate_webhook_url(url: str) -> str | None:
    """Return an error string if the URL is not a valid Slack webhook, else None."""
    try:
        parsed = urlparse(url)
    except Exception:
        return "Invalid URL"
    if parsed.scheme != "https":
        return "Webhook URL must use HTTPS"
    if parsed.hostname not in _ALLOWED_WEBHOOK_HOSTS:
        return f"Webhook host must be one of: {', '.join(_ALLOWED_WEBHOOK_HOSTS)}"
    return None


def _escape_mrkdwn(value) -> str:
    """Escape Slack mrkdwn special characters in untrusted text."""
    text = "" if value is None else str(value)
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _is_workflow_webhook(url: str) -> bool:
    """Workflow Builder webhooks use /triggers/, Incoming Webhooks use /services/."""
    return "/triggers/" in url


def _reservation_fields(reservation) -> dict:
    """Extract flat key-value fields from a reservation for reuse across formats."""
    res_type = "Full Cluster" if (reservation.reservation_type or "cluster") == "cluster" else f"{reservation.gpu_count or '?'} GPUs"
    return {
        "title": reservation.title or "",
        "requested_by": reservation.user_name or "",
        "cluster": reservation.cluster_name or "",
        "type": res_type,
        "time": f"{reservation.start_time:%b %d, %H:%M} — {reservation.end_time:%b %d, %H:%M} UTC",
        "priority": (reservation.priority or "normal").capitalize(),
        "purpose": reservation.purpose or "",
    }


def _format_workflow_payload(reservation) -> dict:
    """Flat key-value payload for Slack Workflow Builder webhook triggers."""
    return _reservation_fields(reservation)


def _format_incoming_webhook_payload(reservation) -> dict:
    """Block Kit payload for standard Incoming Webhooks."""
    fields = _reservation_fields(reservation)

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "New Reservation Request", "emoji": True},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Title:*\n{_escape_mrkdwn(fields['title'])}"},
                {"type": "mrkdwn", "text": f"*Requested By:*\n{_escape_mrkdwn(fields['requested_by'])}"},
                {"type": "mrkdwn", "text": f"*Cluster:*\n{_escape_mrkdwn(fields['cluster'])}"},
                {"type": "mrkdwn", "text": f"*Type:*\n{_escape_mrkdwn(fields['type'])}"},
                {"type": "mrkdwn", "text": f"*Time:*\n{_escape_mrkdwn(fields['time'])}"},
                {"type": "mrkdwn", "text": f"*Priority:*\n{_escape_mrkdwn(fields['priority'])}"},
            ],
        },
    ]

    if fields["purpose"]:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Purpose:*\n{_escape_mrkdwn(fields['purpose'])}"},
        })

    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": "PSAP Control Center · Awaiting admin approval"}],
    })

    return {"blocks": blocks}


def _build_payload(reservation, webhook_url: str) -> dict:
    if _is_workflow_webhook(webhook_url):
        return _format_workflow_payload(reservation)
    return _format_incoming_webhook_payload(reservation)


async def send_test_message(webhook_url: str) -> bool:
    """Send a test message to the given Slack webhook URL. Returns True on success."""
    if validate_webhook_url(webhook_url):
        logger.warning("Rejected test message to non-Slack URL")
        return False
    if _is_workflow_webhook(webhook_url):
        payload = {
            "title": "Test Message",
            "requested_by": "PSAP Control Center",
            "cluster": "N/A",
            "type": "N/A",
            "time": "N/A",
            "priority": "Normal",
            "purpose": "This is a test notification. Slack integration is working correctly.",
        }
    else:
        payload = {
            "blocks": [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "PSAP Control Center", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": "This is a test notification from PSAP Control Center. Slack integration is working correctly."},
                },
            ]
        }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code == 200:
                logger.info("Slack test message sent successfully")
                return True
            logger.warning(f"Slack test message failed: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        logger.error(f"Slack test message error: {e}")
        return False


async def _send_to_webhook(payload: dict, label: str) -> None:
    """Common helper: read webhook URL from settings and POST payload."""
    try:
        async with AsyncSessionLocal() as db:
            service = SettingsService(db)
            webhook_url = await service.get(SLACK_WEBHOOK_KEY)

        if not webhook_url:
            return

        if validate_webhook_url(webhook_url):
            logger.warning(f"Stored webhook URL is not a valid Slack host, skipping {label}")
            return

        if _is_workflow_webhook(webhook_url) and "blocks" in payload:
            payload = payload.get("_workflow_fallback", payload)

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code == 200:
                logger.info(f"Slack notification sent: {label}")
            else:
                logger.warning(f"Slack notification failed ({label}): {resp.status_code} {resp.text}")
    except Exception as e:
        logger.error(f"Slack notification error ({label}): {e}")


async def send_new_reservation_notification(reservation) -> None:
    """Best-effort Slack notification for a new reservation. Never raises."""
    try:
        async with AsyncSessionLocal() as db:
            service = SettingsService(db)
            webhook_url = await service.get(SLACK_WEBHOOK_KEY)

        if not webhook_url:
            return

        if validate_webhook_url(webhook_url):
            logger.warning("Stored webhook URL is not a valid Slack host, skipping new reservation notification")
            return

        payload = _build_payload(reservation, webhook_url)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code == 200:
                logger.info(f"Slack notification sent for reservation '{reservation.title}'")
            else:
                logger.warning(f"Slack notification failed: {resp.status_code} {resp.text}")
    except Exception as e:
        logger.error(f"Slack notification error: {e}")


def _fmt_field_value(key: str, value) -> str:
    """Format a reservation field value for human-readable display."""
    from datetime import datetime as _dt
    if isinstance(value, _dt):
        return value.strftime("%b %d, %H:%M UTC")
    if isinstance(value, str):
        try:
            dt = _dt.fromisoformat(value.replace("Z", "+00:00"))
            return dt.strftime("%b %d, %H:%M UTC")
        except (ValueError, TypeError):
            pass
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if value is None:
        return "N/A"
    return str(value)


def _build_change_description(reservation, changes: dict) -> str:
    """Build a human-readable 'from X to Y' description of each changed field."""
    lines = []
    for key, new_val in changes.items():
        label = key.replace("_", " ").title()
        old_val = getattr(reservation, key, None)
        old_str = _fmt_field_value(key, old_val)
        new_str = _fmt_field_value(key, new_val)
        lines.append(f"{label}: {old_str} → {new_str}")
    return "; ".join(lines) if lines else "No details"


async def send_modification_request_notification(reservation, changes: dict) -> None:
    """Best-effort Slack notification for a modification request. Never raises."""
    try:
        async with AsyncSessionLocal() as db:
            service = SettingsService(db)
            webhook_url = await service.get(SLACK_WEBHOOK_KEY)

        if not webhook_url:
            return

        if validate_webhook_url(webhook_url):
            logger.warning("Stored webhook URL is not a valid Slack host, skipping modification notification")
            return

        start = changes.get("start_time") or reservation.start_time
        end = changes.get("end_time") or reservation.end_time
        try:
            time_str = f"{start:%b %d, %H:%M} — {end:%b %d, %H:%M} UTC"
        except (TypeError, ValueError):
            time_str = f"{start} — {end}"

        change_desc = _build_change_description(reservation, changes)

        if _is_workflow_webhook(webhook_url):
            res_type = "Full Cluster" if (reservation.reservation_type or "cluster") == "cluster" else f"{reservation.gpu_count or '?'} GPUs"
            payload = {
                "title": f"{reservation.title} (modify)",
                "requested_by": reservation.modification_requested_by or reservation.user_name,
                "cluster": reservation.cluster_name or "",
                "type": res_type,
                "time": time_str,
                "priority": (reservation.priority or "normal").capitalize(),
                "purpose": change_desc,
            }
        else:
            change_lines = []
            for key, new_val in changes.items():
                label = _escape_mrkdwn(key.replace("_", " ").title())
                old_val = getattr(reservation, key, None)
                old_str = _escape_mrkdwn(_fmt_field_value(key, old_val))
                new_str = _escape_mrkdwn(_fmt_field_value(key, new_val))
                change_lines.append(f"• *{label}*: {old_str} → {new_str}")
            changes_text = "\n".join(change_lines) or "No details"

            payload = {
                "blocks": [
                    {
                        "type": "header",
                        "text": {"type": "plain_text", "text": "Modification Request", "emoji": True},
                    },
                    {
                        "type": "section",
                        "fields": [
                            {"type": "mrkdwn", "text": f"*Reservation:*\n{_escape_mrkdwn(reservation.title)} (modify)"},
                            {"type": "mrkdwn", "text": f"*Requested By:*\n{_escape_mrkdwn(reservation.modification_requested_by or reservation.user_name)}"},
                            {"type": "mrkdwn", "text": f"*Cluster:*\n{_escape_mrkdwn(reservation.cluster_name or 'Unknown')}"},
                            {"type": "mrkdwn", "text": f"*Status:*\n{_escape_mrkdwn(reservation.status)}"},
                        ],
                    },
                    {
                        "type": "section",
                        "text": {"type": "mrkdwn", "text": f"*Requested Changes:*\n{changes_text}"},
                    },
                    {
                        "type": "context",
                        "elements": [{"type": "mrkdwn", "text": "PSAP Control Center · Awaiting admin approval"}],
                    },
                ]
            }

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code == 200:
                logger.info(f"Slack modification notification sent for '{reservation.title}'")
            else:
                logger.warning(f"Slack modification notification failed: {resp.status_code} {resp.text}")
    except Exception as e:
        logger.error(f"Slack modification notification error: {e}")
