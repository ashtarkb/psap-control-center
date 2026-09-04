"""Per-pipeline task definitions, sourced from Forge's own Tekton Pipeline
CRDs (``fournos/gitops/base/workflows/*.yaml``).

Tekton only creates a TaskRun (and therefore a ``childReference`` on the
PipelineRun) once a task actually starts — so a job's Pipeline Timeline
would otherwise only ever show tasks that have *already* run, never the
ones still queued up. This module gives the API layer each pipeline's full,
predefined task order (main ``tasks`` + ``finally``) so the running-job page
can pre-populate every step up front and simply overlay real status on the
ones that have started (see ``_merge_pipeline_stages`` in ``api/fournos.py``).

Cached in-process for the life of the backend (pipeline definitions change
about as often as the Forge repo's gitops manifests do — i.e. rarely) with
the same "single shared fetch, callable from sync or async code" shape as
``project_ui_schema.py``, since the local dev mock (a plain background
thread, not a coroutine) also needs this to drive its fake pipeline runs.
"""

from __future__ import annotations

import asyncio
import logging
from threading import Lock
from typing import Dict, Optional

from app.services.github_content import fetch_yaml, list_yamls

logger = logging.getLogger(__name__)

_WORKFLOWS_DIR = "fournos/gitops/base/workflows"

_cache: Optional[Dict[str, dict]] = None
_inflight: Optional["asyncio.Future[Dict[str, dict]]"] = None
_inflight_is_refresh = False
_cache_load_lock = Lock()


def _extract(doc: dict) -> Optional[dict]:
    if not isinstance(doc, dict) or doc.get("kind") != "Pipeline":
        return None
    name = (doc.get("metadata") or {}).get("name")
    if not name:
        return None
    spec = doc.get("spec") or {}
    tasks = [t.get("name") for t in spec.get("tasks", []) if t.get("name")]
    finally_tasks = [t.get("name") for t in spec.get("finally", []) if t.get("name")]
    return {"name": name, "tasks": tasks, "finally": finally_tasks}


def _load_all_strict_sync() -> Dict[str, dict]:
    """Load a complete snapshot or raise without touching the cache."""
    result: Dict[str, dict] = {}
    paths = list_yamls(_WORKFLOWS_DIR)
    if not paths:
        raise RuntimeError("Forge returned no pipeline definitions")
    errors = []
    for path in paths:
        try:
            doc = fetch_yaml(path)
        except Exception as exc:
            errors.append("{}: {}".format(path, exc))
            continue
        parsed = _extract(doc)
        if parsed:
            result[parsed["name"]] = parsed
    if errors:
        raise RuntimeError(
            "Could not load all pipeline definitions: {}".format("; ".join(errors))
        )
    return result


def load_all_sync() -> Dict[str, dict]:
    """Blocking load of every Pipeline definition in Forge's workflows dir,
    keyed by Pipeline name (e.g. "forge-test-only"). Safe to call from a
    plain thread (used directly by the local dev mock) or via
    ``asyncio.to_thread`` (used by ``get_all``/``refresh_all`` below).
    """
    try:
        return _load_all_strict_sync()
    except Exception as exc:
        logger.warning(
            "Could not load Forge pipeline definitions in %s: %s",
            _WORKFLOWS_DIR,
            exc,
        )
        return {}


def get_all_sync() -> Dict[str, dict]:
    """Cached, blocking accessor — loads once, then reuses the cache."""
    try:
        return _load_and_publish_sync(force_refresh=False)
    except Exception as exc:
        logger.warning(
            "Could not load Forge pipeline definitions in %s: %s",
            _WORKFLOWS_DIR,
            exc,
        )
        return _cache or {}


def get_definition_sync(pipeline_name: str) -> Optional[dict]:
    return get_all_sync().get(pipeline_name)


def _load_and_publish_sync(force_refresh: bool) -> Dict[str, dict]:
    """Serialize every cache writer, including the watcher's sync accessor.

    A forced refresh always performs a strict load. A cold getter also uses a
    strict load internally, but its public wrapper retains the existing
    best-effort fallback. The cache is published only after the complete load
    succeeds, so a late failed getter can never replace newer definitions.
    """
    global _cache
    with _cache_load_lock:
        if not force_refresh and _cache is not None:
            return _cache
        refreshed = _load_all_strict_sync()
        _cache = refreshed
        return refreshed


async def _run_load(force_refresh: bool) -> Dict[str, dict]:
    global _inflight, _inflight_is_refresh
    try:
        return await asyncio.to_thread(_load_and_publish_sync, force_refresh)
    finally:
        _inflight = None
        _inflight_is_refresh = False


async def _fetch_coalesced(force_refresh: bool) -> Dict[str, dict]:
    """Coordinate cold reads and explicit refreshes through one operation.

    Readers may join either kind of in-flight load. A forced refresh may join
    another refresh, but if it arrives during an older cold load it waits for
    that load and then performs its own fetch against the newly refreshed
    repository snapshot.
    """
    global _inflight, _inflight_is_refresh

    while True:
        future = _inflight
        future_is_refresh = _inflight_is_refresh
        if future is not None:
            try:
                result = await asyncio.shield(future)
            except Exception:
                # A refresh waiting behind a cold read still owes the caller a
                # load against the newly published repository snapshot. If the
                # older read failed, continue and start that forced load rather
                # than treating the stale attempt as the refresh result.
                if force_refresh and not future_is_refresh:
                    continue
                raise
            if not force_refresh or future_is_refresh:
                return result
            continue

        if not force_refresh and _cache is not None:
            return _cache

        _inflight_is_refresh = force_refresh
        future = asyncio.ensure_future(_run_load(force_refresh))
        _inflight = future
        return await asyncio.shield(future)


async def get_all() -> Dict[str, dict]:
    """Async, cached accessor for the FastAPI layer — never blocks the
    event loop, and concurrent callers share one fetch.
    """
    if _cache is not None:
        return _cache
    try:
        return await _fetch_coalesced(force_refresh=False)
    except Exception as exc:
        logger.warning(
            "Could not load Forge pipeline definitions in %s: %s",
            _WORKFLOWS_DIR,
            exc,
        )
        return _cache or {}


async def refresh_all() -> Dict[str, dict]:
    return await _fetch_coalesced(force_refresh=True)


async def get_definition(pipeline_name: str) -> Optional[dict]:
    defs = await get_all()
    return defs.get(pipeline_name)


def merge_pipeline_stages(pipeline_def: Optional[dict], actual_stages: list) -> list:
    """Overlay real per-task status (from whatever TaskRuns Tekton has
    created so far) onto a pipeline's full, predefined task order — so the
    Pipeline Timeline shows every step a job *will* run, not just the ones
    that happen to have started already. Falls back to `actual_stages`
    as-is if the pipeline isn't one we have a definition for.

    Shared by the live job-detail endpoint (``api/fournos.py``) and the
    watcher (``fournos_watcher.py``), which snapshots the merged stage list
    into the DB at the moment a job reaches a terminal phase so the History
    tab can show the full pipeline — including exactly which step failed —
    for jobs whose pods/PipelineRun are long gone from the cluster.
    """
    if not pipeline_def:
        return actual_stages

    actual_by_name = {s["name"]: s for s in actual_stages}

    def _pending(name: str, is_finally: bool) -> dict:
        return {
            "name": name,
            "displayName": name.replace("-", " ").title(),
            "status": "Pending",
            "startTime": None,
            "completionTime": None,
            "finally": is_finally,
        }

    merged = [
        actual_by_name.get(name) or _pending(name, False)
        for name in pipeline_def.get("tasks", [])
    ]
    merged += [
        actual_by_name.get(name) or _pending(name, True)
        for name in pipeline_def.get("finally", [])
    ]

    known = set(pipeline_def.get("tasks", [])) | set(pipeline_def.get("finally", []))
    merged += [s for s in actual_stages if s["name"] not in known]
    return merged
