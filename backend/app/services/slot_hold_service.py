"""Ephemeral, in-memory "soft lock" on a (cluster, start_time) calendar slot.

Two users looking at the same cluster's scheduling calendar could otherwise
both start booking the exact same slot and race to submit — this gives the
first one a short-lived claim so the UI can gray out that slot for everyone
else while they're actively working on it. Purely a Control Center UX
nicety: Fournos itself has no notion of this and happily queues multiple
jobs targeting the same cluster/time regardless (it only cares about the
start time, not an end time — see FournosJob's spec.scheduledStartTime).

In-memory only, same single-process assumption as the rest of this app's
background watcher/threads (see fournos_watcher.py) — a hold is never
worth persisting across a backend restart, and expires on its own shortly
after a tab is closed without releasing it.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

HOLD_TTL_SECONDS = 120


@dataclass
class SlotHold:
    cluster: str
    start_time: str
    held_by: str
    expires_at: datetime


class SlotAlreadyHeldError(Exception):
    def __init__(self, hold: SlotHold):
        self.hold = hold
        super().__init__(
            "Slot held by {} until {}".format(hold.held_by, hold.expires_at.isoformat())
        )


_lock = threading.Lock()
_holds: Dict[Tuple[str, str], SlotHold] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _prune(cluster: Optional[str] = None) -> None:
    now = _now()
    expired = [
        key for key, hold in _holds.items()
        if hold.expires_at <= now and (cluster is None or key[0] == cluster)
    ]
    for key in expired:
        _holds.pop(key, None)


def hold_slot(cluster: str, start_time: str, username: str) -> SlotHold:
    """Claim (or refresh) a slot. Raises SlotAlreadyHeldError if a
    *different* user currently holds it and that hold hasn't expired.
    """
    with _lock:
        _prune(cluster)
        key = (cluster, start_time)
        existing = _holds.get(key)
        if existing is not None and existing.held_by != username:
            raise SlotAlreadyHeldError(existing)
        hold = SlotHold(
            cluster=cluster,
            start_time=start_time,
            held_by=username,
            expires_at=_now() + timedelta(seconds=HOLD_TTL_SECONDS),
        )
        _holds[key] = hold
        return hold


def release_slot(cluster: str, start_time: str, username: str, force: bool = False) -> None:
    with _lock:
        key = (cluster, start_time)
        existing = _holds.get(key)
        if existing is None:
            return
        if force or existing.held_by == username:
            _holds.pop(key, None)


def list_holds(cluster: str) -> List[SlotHold]:
    with _lock:
        _prune(cluster)
        return [h for h in _holds.values() if h.cluster == cluster]
