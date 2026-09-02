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
from typing import Dict, Optional

from app.services.github_content import fetch_yaml, list_yamls

logger = logging.getLogger(__name__)

_WORKFLOWS_DIR = "fournos/gitops/base/workflows"

_cache: Optional[Dict[str, dict]] = None
_inflight: Optional["asyncio.Future[Dict[str, dict]]"] = None


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


def load_all_sync() -> Dict[str, dict]:
    """Blocking load of every Pipeline definition in Forge's workflows dir,
    keyed by Pipeline name (e.g. "forge-test-only"). Safe to call from a
    plain thread (used directly by the local dev mock) or via
    ``asyncio.to_thread`` (used by ``get_all``/``refresh_all`` below).
    """
    result: Dict[str, dict] = {}
    try:
        paths = list_yamls(_WORKFLOWS_DIR)
    except Exception as exc:
        logger.warning("Could not list Forge pipeline definitions in %s: %s", _WORKFLOWS_DIR, exc)
        return result
    for path in paths:
        try:
            doc = fetch_yaml(path)
        except Exception as exc:
            logger.warning("Could not fetch pipeline definition %s: %s", path, exc)
            continue
        parsed = _extract(doc)
        if parsed:
            result[parsed["name"]] = parsed
    return result


def get_all_sync() -> Dict[str, dict]:
    """Cached, blocking accessor — loads once, then reuses the cache."""
    global _cache
    if _cache is None:
        _cache = load_all_sync()
    return _cache


def get_definition_sync(pipeline_name: str) -> Optional[dict]:
    return get_all_sync().get(pipeline_name)


async def _fetch_coalesced() -> Dict[str, dict]:
    global _inflight
    if _inflight is not None:
        return await _inflight
    _inflight = asyncio.ensure_future(asyncio.to_thread(load_all_sync))
    try:
        return await _inflight
    finally:
        _inflight = None


async def get_all() -> Dict[str, dict]:
    """Async, cached accessor for the FastAPI layer — never blocks the
    event loop, and concurrent callers share one fetch.
    """
    global _cache
    if _cache is not None:
        return _cache
    _cache = await _fetch_coalesced()
    return _cache


async def refresh_all() -> Dict[str, dict]:
    global _cache
    _cache = await _fetch_coalesced()
    return _cache


async def get_definition(pipeline_name: str) -> Optional[dict]:
    defs = await get_all()
    return defs.get(pipeline_name)
