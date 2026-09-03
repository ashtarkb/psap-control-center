"""Background K8s watcher that archives FournosJobs to the PSAP database."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Optional

from dateutil.parser import parse as parse_dt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.services import fournos_k8s_client as k8s_client
from app.services import fournos_db_service as db_svc
from app.services import pipeline_definitions
from app.models.fournos_job import FournosJob

logger = logging.getLogger(__name__)

_watcher_engine = None
_watcher_session: Optional[async_sessionmaker] = None

SYNC_INTERVAL_SECONDS = 60
TERMINAL_PHASES = {"Succeeded", "Failed", "Stopped"}


def _init_watcher_db(loop: asyncio.AbstractEventLoop) -> None:
    global _watcher_engine, _watcher_session
    _watcher_engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_size=3,
        max_overflow=5,
    )
    _watcher_session = async_sessionmaker(
        _watcher_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


def _compute_terminal_stages(job_name: str, spec: dict, status: dict) -> list:
    """Snapshot the merged pipeline stage list for a job that just reached
    a terminal phase — this is the *last* moment the PipelineRun/TaskRuns
    are guaranteed to still exist in the cluster, so it's the only chance
    to capture "which step failed" before the job (and its resources) get
    cleaned up and it becomes a plain history row.
    """
    try:
        pr_name = status.get("pipelineRun", "")
        pr = k8s_client.get_pipelinerun(pr_name) if pr_name else None
        if not pr:
            prs = k8s_client.list_pipelineruns_for_job(job_name)
            pr = prs[0] if prs else None
        stages = k8s_client.extract_pipeline_stages(pr) if pr else []

        pipeline_name = spec.get("pipeline", "")
        if pipeline_name:
            pipeline_def = pipeline_definitions.get_definition_sync(pipeline_name)
            stages = pipeline_definitions.merge_pipeline_stages(pipeline_def, stages)
        return stages
    except Exception as exc:
        logger.warning(
            "Could not snapshot pipeline stages for %s: %s", job_name, exc
        )
        return []


def _extract_forge_fields(job: dict) -> dict:
    meta = job.get("metadata", {})
    spec = job.get("spec", {})
    forge = spec.get("executionEngine", {}).get("forge", {})
    status = job.get("status", {})

    mlflow_info = (
        status.get("engineStatus", {})
        .get("forge", {})
        .get("exportArtifacts", {})
        .get("caliper_artifacts_export", {})
        .get("backends", {})
        .get("mlflow", {})
    )
    mlflow_url = mlflow_info.get("run_url", "") if mlflow_info else ""

    args = forge.get("args", [])
    preset = " ".join(args) if args else ""

    created_str = meta.get("creationTimestamp", "")
    created_at = None
    if created_str:
        try:
            created_at = parse_dt(created_str)
        except Exception:
            pass

    completed_at = None
    duration_seconds = None
    conditions = status.get("conditions", [])
    for cond in conditions:
        if cond.get("type") == "PipelineRunReady" and cond.get("status") in (
            "True",
            "False",
        ):
            try:
                completed_at = parse_dt(cond["lastTransitionTime"])
            except Exception:
                pass

    if created_at and completed_at:
        duration_seconds = (completed_at - created_at).total_seconds()

    labels = meta.get("labels", {})
    # Native Fournos recurring-job label (fournos.dev/recurring-parent) —
    # set by the operator itself on every child it stamps out from a
    # recurring template (see fournos/fournos/handlers/lifecycle.py). A job
    # with no parent but its own spec.schedule *is* the recurring template;
    # one with spec.scheduledStartTime is a one-off deferred job.
    schedule_name = labels.get(k8s_client.LABEL_RECURRING_PARENT, "")
    if schedule_name:
        trigger_type = "recurring"
    elif spec.get("scheduledStartTime"):
        trigger_type = "deferred"
    elif spec.get("schedule"):
        trigger_type = "recurring-parent"
    else:
        trigger_type = "manual"

    job_name = meta.get("name", "")
    phase = status.get("phase", "Unknown")
    stages = (
        _compute_terminal_stages(job_name, spec, status)
        if phase in TERMINAL_PHASES
        else []
    )

    return {
        "name": job_name,
        "project": forge.get("project", ""),
        "preset": preset,
        "cluster": spec.get("cluster", ""),
        "pipeline": spec.get("pipeline", ""),
        "owner": spec.get("owner", ""),
        "status": phase,
        "message": status.get("message", ""),
        "created_at": created_at,
        "completed_at": completed_at,
        "duration_seconds": duration_seconds,
        "stages": stages,
        "mlflow_url": mlflow_url,
        "config_overrides": forge.get("configOverrides", {}),
        "fjob_spec": spec,
        "fjob_status": status,
        "triggered_by_schedule": schedule_name or None,
        "trigger_type": trigger_type,
        "is_lock": bool(spec.get("lockOnly")),
    }


async def _archive_job(job: dict) -> None:
    if _watcher_session is None:
        logger.warning("Watcher DB not initialised — skipping archive")
        return
    fields = _extract_forge_fields(job)
    job_name = fields.get("name")
    if not job_name:
        logger.warning("Skipping FournosJob with missing name")
        return

    async with _watcher_session() as session, session.begin():
        existing = await db_svc.get_job_by_name(session, job_name)
        previous_phase = existing.status if existing else None
        previous_message = existing.message if existing else None

        db_job = await db_svc.upsert_job(session, **fields)

        if (
            fields["status"] != previous_phase
            or fields["message"] != previous_message
        ):
            await db_svc.add_job_event(
                session,
                job_id=db_job.id,
                phase=fields["status"],
                message=fields["message"],
            )

    logger.info(
        "Archived FournosJob %s (phase=%s)", job_name, fields["status"]
    )


async def _full_sync() -> None:
    if _watcher_session is None:
        return
    try:
        all_jobs = k8s_client.list_fournos_jobs()
    except Exception as exc:
        logger.warning("Full sync: failed to list FournosJobs: %s", exc)
        return

    if not all_jobs:
        return

    synced = 0
    errors = 0
    for job in all_jobs:
        try:
            await _archive_job(job)
            synced += 1
        except Exception as exc:
            name = job.get("metadata", {}).get("name", "?")
            logger.warning(
                "Full sync: failed to archive %s: %s", name, exc
            )
            errors += 1

    logger.info(
        "Full sync complete: %d synced, %d errors (out of %d)",
        synced,
        errors,
        len(all_jobs),
    )


def _run_watch_loop(loop: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop)
    _init_watcher_db(loop)

    try:
        loop.run_until_complete(_full_sync())
    except Exception as exc:
        logger.warning("Initial full sync failed: %s", exc)

    resource_version = ""
    last_sync = time.monotonic()

    while True:
        try:
            logger.info(
                "Starting FournosJob watch (rv=%s)",
                resource_version or "latest",
            )
            for event in k8s_client.watch_fournos_jobs(
                resource_version=resource_version, timeout=300
            ):
                obj = event.get("object", {})
                rv = obj.get("metadata", {}).get("resourceVersion", "")
                if rv:
                    resource_version = rv

                event_type = event.get("type", "")
                if event_type in ("ADDED", "MODIFIED"):
                    try:
                        loop.run_until_complete(_archive_job(obj))
                    except Exception as exc:
                        name = obj.get("metadata", {}).get("name", "?")
                        logger.error(
                            "Failed to archive event for %s (type=%s): %s",
                            name,
                            event_type,
                            exc,
                        )
                elif event_type == "DELETED":
                    name = obj.get("metadata", {}).get("name", "")
                    logger.info(
                        "FournosJob %s deleted from cluster", name
                    )

                if time.monotonic() - last_sync > SYNC_INTERVAL_SECONDS:
                    try:
                        loop.run_until_complete(_full_sync())
                    except Exception as exc:
                        logger.warning("Periodic sync failed: %s", exc)
                    last_sync = time.monotonic()

        except Exception as exc:
            reason = str(exc)
            if "Forbidden" in reason or "Unauthorized" in reason:
                logger.warning(
                    "Watch stream auth error (will retry in 60s): %s", exc
                )
                time.sleep(60)
            else:
                logger.warning(
                    "Watch stream error (will restart in 5s): %s", exc
                )
                time.sleep(5)
            resource_version = ""

        try:
            loop.run_until_complete(_full_sync())
        except Exception as exc:
            logger.warning("Reconnect sync failed: %s", exc)
        last_sync = time.monotonic()


_watch_thread: Optional[threading.Thread] = None


def start_watcher() -> None:
    global _watch_thread
    if _watch_thread is not None and _watch_thread.is_alive():
        return

    if not k8s_client.is_connected():
        logger.warning("K8s not connected — fournos watcher not started")
        return

    loop = asyncio.new_event_loop()
    _watch_thread = threading.Thread(
        target=_run_watch_loop,
        args=(loop,),
        daemon=True,
        name="fjob-watcher",
    )
    _watch_thread.start()
    logger.info("FournosJob watcher started")
