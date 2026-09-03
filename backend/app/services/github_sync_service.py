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
  ``/fournos/github/sync`` route in ``api/fournos.py``).

Both paths go through ``refresh_now()``, which:

- Coalesces concurrent callers onto a single in-flight refresh (the same
  "inflight future" pattern already used by ``project_ui_schema.py`` and
  ``pipeline_definitions.py``) — so if two people mash the button at the
  same time, or a button-press lands while the periodic refresh is already
  running, only one round of GitHub calls actually happens.
- Enforces a server-side minimum interval (``MIN_REFRESH_INTERVAL_SECONDS``)
  between *completed* refreshes — unlike the in-flight coalescing above,
  this also throttles *sequential* manual button presses (each of which
  would otherwise be a brand new round of GitHub calls; a full refresh
  easily costs 1 project-list call plus several calls per project, which
  adds up fast against GitHub's 60 req/hr unauthenticated limit shared
  across the whole deployment). A press inside the cooldown window is a
  no-op that just returns the last known status.
- Never reports success on failure: a failed refresh leaves
  ``last_synced_at`` untouched (so the UI can't claim data is fresh when
  it isn't), records the error, and re-raises so the manual endpoint can
  surface a non-2xx response instead of a false "ok".

This is deliberately the *only* thing that triggers those services' network
fetches — every other caller (API routes) only ever reads their cache.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional

from app.services import forge_discovery
from app.services import pipeline_definitions
from app.services import project_ui_schema

logger = logging.getLogger(__name__)

# How often the background task runs a refresh, *and* the minimum time
# that must elapse between any two completed refreshes (manual or
# periodic) — see refresh_now()'s cooldown check below. 30 minutes keeps
# this well clear of GitHub's 60 req/hr unauthenticated limit even though
# a single refresh cycle (project discovery + per-project ui/submit.yaml +
# pipeline definitions + open PRs) can itself cost several dozen calls on
# a deployment with more than a handful of Forge projects — if that ever
# becomes a problem in practice, raise this further (env-tunable via
# GITHUB_SYNC_INTERVAL_SECONDS below) rather than lowering it.
PERIODIC_INTERVAL_SECONDS = 30 * 60
MIN_REFRESH_INTERVAL_SECONDS = PERIODIC_INTERVAL_SECONDS

_status = {
    "in_progress": False,
    "last_synced_at": None,  # type: Optional[datetime]  # only set on success
    "last_attempted_at": None,  # type: Optional[datetime]
    "last_error": None,  # type: Optional[str]
    "project_count": 0,
}

_inflight: "Optional[asyncio.Future[dict]]" = None


class GithubSyncError(RuntimeError):
    """Raised when one or more steps of a refresh failed — carries every
    individual failure so callers/logs see the full picture instead of
    just the first exception.
    """

    def __init__(self, errors: List[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def get_status() -> dict:
    return dict(_status)


async def _do_refresh() -> dict:
    """The actual work — runs once per coalesced call. Every step's
    failure is recorded rather than swallowed; if anything failed, this
    raises GithubSyncError at the end (after still attempting every other
    step) so the whole refresh is reported as failed rather than silently
    "succeeding" with partially stale caches.
    """
    logger.info("GitHub sync: starting")
    errors: List[str] = []

    try:
        projects = await asyncio.to_thread(forge_discovery.discover_projects, True)
    except Exception as exc:
        errors.append("project discovery: {}".format(exc))
        projects = []

    # Pipeline definitions (Tekton Pipeline CRDs) — one shared refresh, not
    # per-project.
    try:
        await pipeline_definitions.refresh_all()
    except Exception as exc:
        errors.append("pipeline definitions: {}".format(exc))

    # Each project's ui/submit.yaml — sequential on purpose (this whole
    # module exists to stay under GitHub's rate limit, so no point firing
    # these concurrently and burning through it faster).
    for project in projects:
        try:
            await project_ui_schema.refresh_schema(project.name)
        except Exception as exc:
            errors.append("ui/submit.yaml[{}]: {}".format(project.name, exc))

    # Open PRs — imported lazily to avoid a circular import (api/fournos.py
    # imports several of the services this module also imports).
    try:
        from app.api.fournos import refresh_open_prs

        await refresh_open_prs()
    except Exception as exc:
        errors.append("open PRs: {}".format(exc))

    if errors:
        logger.warning(
            "GitHub sync: completed with %d error(s): %s", len(errors), errors
        )
        raise GithubSyncError(errors)

    logger.info("GitHub sync: complete (%d projects)", len(projects))
    return {"project_count": len(projects)}


async def refresh_now() -> dict:
    """Refresh everything, coalescing concurrent callers onto one shared
    in-flight refresh, and skipping entirely (returning the last known
    status) if a refresh completed within the last
    ``MIN_REFRESH_INTERVAL_SECONDS``. Raises GithubSyncError if the refresh
    it triggered (or piggybacked on) failed — callers that need an HTTP
    response (the manual-refresh route) should catch this and return a
    non-2xx status rather than swallowing it.
    """
    global _inflight

    if _inflight is not None:
        return await _inflight

    last_synced = _status["last_synced_at"]
    if last_synced is not None:
        elapsed = (datetime.now(timezone.utc) - last_synced).total_seconds()
        if elapsed < MIN_REFRESH_INTERVAL_SECONDS:
            logger.debug(
                "GitHub sync: skipping refresh (%.0fs since last success, "
                "cooldown is %ds)",
                elapsed,
                MIN_REFRESH_INTERVAL_SECONDS,
            )
            return get_status()

    _status["in_progress"] = True
    _status["last_attempted_at"] = datetime.now(timezone.utc)
    future = asyncio.ensure_future(_do_refresh())
    _inflight = future
    try:
        result = await future
    except Exception as exc:
        logger.error("GitHub sync failed: %s", exc)
        _status["last_error"] = str(exc)
        # last_synced_at is deliberately left untouched on failure — a
        # failed refresh must never make stale cached data look freshly
        # synced to the UI.
        raise
    else:
        _status["last_error"] = None
        _status["project_count"] = result.get("project_count", 0)
        _status["last_synced_at"] = datetime.now(timezone.utc)
        return get_status()
    finally:
        _status["in_progress"] = False
        _inflight = None


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
            # Already logged (with full per-step detail) inside
            # refresh_now/_do_refresh — just keep the loop alive so the
            # next scheduled attempt still happens.
            logger.error("Periodic GitHub sync error: %s", exc)
        await asyncio.sleep(PERIODIC_INTERVAL_SECONDS)
