"""Single shared point of truth for refreshing everything sourced from the
Forge GitHub repo — project discovery, each project's ui/submit.yaml
schema, Tekton pipeline definitions, and the open-PR list.

Each of those already has its own in-process cache (forge_discovery,
project_ui_schema, pipeline_definitions, the open-PR cache in api/
fournos.py) that's served forever until explicitly refreshed. This module
is what actually *does* the refreshing:

- Automatically, on a fixed interval (see ``PERIODIC_INTERVAL_SECONDS``,
  wired up as a background task in ``main.py``).
- On demand, via the "Refresh now" button on the Submit page (see the
  ``/fournos/github/refresh`` route in ``api/fournos.py``).

Both paths go through ``refresh_now()``, which coalesces concurrent callers
onto a single in-flight refresh (the same "inflight future" pattern already
used by ``project_ui_schema.py`` and ``pipeline_definitions.py``) — so if
two people mash the button at the same time, or a button-press lands while
the periodic refresh is already running, only one round of GitHub calls
actually happens and everyone gets the same result.

This is deliberately the *only* thing that triggers those services' network
fetches — every other caller (API routes) only ever reads their cache.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from app.services import forge_discovery
from app.services import pipeline_definitions
from app.services import project_ui_schema

logger = logging.getLogger(__name__)

# 5 minutes — frequent enough that project/preset/PR changes show up
# promptly, but with the manual refresh button also going through this
# same coalesced path, this is nowhere near GitHub's 60 req/hr unauthenticated
# limit (a full sync is roughly 1 project-list call + a handful per project,
# well under 60, and it can't run more than once per interval either way).
PERIODIC_INTERVAL_SECONDS = 5 * 60

_status = {
    "in_progress": False,
    "last_synced_at": None,  # type: Optional[datetime]
    "last_error": None,  # type: Optional[str]
    "project_count": 0,
}

_inflight: "Optional[asyncio.Future[dict]]" = None


def get_status() -> dict:
    return dict(_status)


async def _do_refresh() -> dict:
    """The actual work — runs once per coalesced call. Best-effort at every
    step: one failing project's ui/submit.yaml (or the PR fetch, etc.)
    shouldn't stop the rest of the sync, since each of those sub-caches is
    independently useful even if others are momentarily stale.
    """
    logger.info("GitHub sync: starting")

    projects = await asyncio.to_thread(forge_discovery.discover_projects, True)

    # Pipeline definitions (Tekton Pipeline CRDs) — one shared refresh, not
    # per-project.
    try:
        await pipeline_definitions.refresh_all()
    except Exception as exc:
        logger.warning("GitHub sync: pipeline_definitions refresh failed: %s", exc)

    # Each project's ui/submit.yaml — sequential on purpose (this whole
    # module exists to stay under GitHub's rate limit, so no point firing
    # these concurrently and burning through it faster).
    for project in projects:
        try:
            await project_ui_schema.refresh_schema(project.name)
        except Exception as exc:
            logger.warning(
                "GitHub sync: ui/submit.yaml refresh failed for %s: %s",
                project.name,
                exc,
            )

    # Open PRs — imported lazily to avoid a circular import (api/fournos.py
    # imports several of the services this module also imports).
    try:
        from app.api.fournos import refresh_open_prs

        await refresh_open_prs()
    except Exception as exc:
        logger.warning("GitHub sync: open PR refresh failed: %s", exc)

    logger.info("GitHub sync: complete (%d projects)", len(projects))
    return {"project_count": len(projects)}


async def refresh_now() -> dict:
    """Refresh everything, coalescing concurrent callers onto one shared
    in-flight refresh. Safe to call from multiple requests (or the
    periodic background task) at once.
    """
    global _inflight

    if _inflight is not None:
        await _inflight
        return get_status()

    _status["in_progress"] = True
    future = asyncio.ensure_future(_do_refresh())
    _inflight = future
    try:
        result = await future
        _status["last_error"] = None
        _status["project_count"] = result.get("project_count", 0)
    except Exception as exc:
        logger.error("GitHub sync failed: %s", exc)
        _status["last_error"] = str(exc)
    finally:
        _status["in_progress"] = False
        _status["last_synced_at"] = datetime.now(timezone.utc)
        _inflight = None

    return get_status()


async def periodic_refresh_task() -> None:
    """Background task (started from main.py's lifespan) that keeps every
    GitHub-sourced cache warm on a fixed interval, so normal page loads
    never trigger a GitHub call themselves.
    """
    # Give the app a moment to finish starting up before the first sync.
    await asyncio.sleep(5)
    while True:
        try:
            await refresh_now()
        except Exception as exc:
            logger.error("Periodic GitHub sync error: %s", exc)
        await asyncio.sleep(PERIODIC_INTERVAL_SECONDS)
