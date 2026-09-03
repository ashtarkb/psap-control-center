"""Fournos Testing Tab API router.

Re-implements fournos-ui routes as a JSON API for the React frontend.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import urllib.request
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.auth import require_admin, require_auth
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.schemas.fournos import (
    ClusterLockResponse,
    ClusterOverviewResponse,
    CreateClusterLockRequest,
    FournosJobSummary,
    GitHubPR,
    HoldSlotRequest,
    JobEventResponse,
    JobListResponse,
    ProjectInfoResponse,
    RecurringJobResponse,
    ScheduleChildJobResponse,
    SlotHoldResponse,
    SubmitJobRequest,
    SubmitJobResponse,
    SubmitMatrixRequest,
    SubmitMatrixResponse,
)
from app.services import slot_hold_service as slot_holds
from app.schemas.ui_schema import ProjectUiSchemaResponse
from app.services import fournos_db_service as db_svc
from app.services import fournos_k8s_client as k8s
from app.services import pipeline_definitions
from app.services import project_ui_schema
from app.services.forge_discovery import discover_projects, get_project

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fournos", tags=["fournos"])

_COMPLETED_GRACE_SECONDS = 180

_VERSION_KEYS = {"mcp_gateway": "infrastructure.mcp_gateway_version"}


# ─── helper functions ────────────────────────────────────────────────────

def _extract_forge_info(job: dict) -> dict:
    forge = job.get("spec", {}).get("executionEngine", {}).get("forge", {})
    env = job.get("spec", {}).get("env", {})
    pr_number = env.get("PULL_NUMBER", "")
    pr_title = env.get("PULL_TITLE", "")
    repo_owner = env.get("REPO_OWNER", "")
    repo_name = env.get("REPO_NAME", "")
    pr_url = ""
    if pr_number:
        pr_url = "https://github.com/{}/{}/pull/{}".format(
            repo_owner, repo_name, pr_number
        )
    return {
        "project": forge.get("project", ""),
        "args": forge.get("args", []),
        "config_overrides": forge.get("configOverrides", {}),
        "pr_number": pr_number,
        "pr_title": pr_title,
        "pr_url": pr_url,
    }


def _parse_task_progress(message: str) -> Optional[dict]:
    m = re.search(
        r"Tasks Completed:\s*(\d+)\s*\(Failed:\s*(\d+),\s*Cancelled\s*(\d+)\),"
        r"\s*Incomplete:\s*(\d+),\s*Skipped:\s*(\d+)",
        message,
    )
    if not m:
        return None
    return {
        "completed": int(m.group(1)),
        "failed": int(m.group(2)),
        "cancelled": int(m.group(3)),
        "incomplete": int(m.group(4)),
        "skipped": int(m.group(5)),
        "total": int(m.group(1)) + int(m.group(4)) + int(m.group(5)),
    }


def _trigger_type_for_live_job(meta: dict, spec: dict, schedule_parent: str) -> str:
    if schedule_parent:
        return "recurring"
    if spec.get("scheduledStartTime"):
        return "deferred"
    if spec.get("schedule"):
        return "recurring-parent"
    return "manual"


def _live_job_to_summary(job: dict) -> dict:
    meta = job.get("metadata", {})
    spec = job.get("spec", {})
    status = job.get("status", {})
    forge = spec.get("executionEngine", {}).get("forge", {})
    schedule_parent = meta.get("labels", {}).get(k8s.LABEL_RECURRING_PARENT, "")

    return {
        "name": meta.get("name", ""),
        "project": forge.get("project", ""),
        "preset": " ".join(forge.get("args", [])),
        "cluster": spec.get("cluster", ""),
        "pipeline": spec.get("pipeline", ""),
        "owner": spec.get("owner", ""),
        "status": status.get("phase", "Pending"),
        "message": status.get("message", ""),
        "created_at": meta.get("creationTimestamp", ""),
        "completed_at": None,
        "duration_seconds": None,
        "mlflow_url": "",
        "trigger_type": _trigger_type_for_live_job(meta, spec, schedule_parent),
        "triggered_by_schedule": schedule_parent or None,
        "scheduled_start_time": spec.get("scheduledStartTime"),
        "source": "live",
    }


def _db_job_to_summary(job) -> dict:
    return {
        "name": job.name,
        "project": job.project,
        "preset": job.preset,
        "cluster": job.cluster,
        "pipeline": job.pipeline,
        "owner": job.owner,
        "status": job.status,
        "message": job.message,
        "created_at": job.created_at.isoformat() if job.created_at else "",
        "completed_at": (
            job.completed_at.isoformat() if job.completed_at else ""
        ),
        "duration_seconds": job.duration_seconds,
        "mlflow_url": job.mlflow_url or "",
        "trigger_type": job.trigger_type or "manual",
        "triggered_by_schedule": job.triggered_by_schedule,
        "source": "history",
    }


def _db_job_to_fjob_dict(job) -> dict:
    spec = job.fjob_spec or {}
    status = job.fjob_status or {}

    forge = spec.get("executionEngine", {}).get("forge", {})
    if not forge:
        forge = {
            "project": job.project,
            "args": job.preset.split() if job.preset else [],
            "configOverrides": job.config_overrides or {},
        }
        spec.setdefault("executionEngine", {})["forge"] = forge

    spec.setdefault("cluster", job.cluster)
    spec.setdefault("pipeline", job.pipeline)
    spec.setdefault("owner", job.owner)
    spec.setdefault("displayName", "{} {}".format(job.project, job.preset).strip())

    status.setdefault("phase", job.status)
    status.setdefault("message", job.message)
    status.setdefault("conditions", [])

    return {
        "metadata": {
            "name": job.name,
            "namespace": settings.FOURNOS_NAMESPACE,
            "creationTimestamp": (
                job.created_at.isoformat() if job.created_at else ""
            ),
            "uid": job.id,
        },
        "spec": spec,
        "status": status,
        "source": "history",
        "duration_seconds": job.duration_seconds,
        "mlflow_url": job.mlflow_url or "",
        "ci_artifacts_url": job.ci_artifacts_url or "",
    }


def _get_live_jobs_sync() -> list:
    from dateutil.parser import parse

    jobs = k8s.list_fournos_jobs()
    now = datetime.now(timezone.utc)
    visible = []
    for j in jobs:
        # Cluster locks are FournosJobs too (spec.lockOnly) but they're
        # surfaced separately via /cluster-locks (Schedules/Locks tab, the
        # scheduling calendar's `locks` array) — without this they'd show
        # up a second time here as if they were an ordinary running job.
        if j.get("spec", {}).get("lockOnly"):
            continue
        # Likewise, a recurring *template* (spec.schedule set) isn't itself
        # a run — it's surfaced in the Schedules/Locks tab's Recurring Jobs
        # list. Its actual child runs (fournos.dev/recurring-parent label,
        # no spec.schedule of their own) are real jobs and stay visible here.
        if j.get("spec", {}).get("schedule"):
            continue
        phase = j.get("status", {}).get("phase", "")
        if phase in ("Succeeded", "Failed", "Stopped"):
            conditions = j.get("status", {}).get("conditions", [])
            last_ts = None
            for c in conditions:
                ts_str = c.get("lastTransitionTime")
                if ts_str:
                    try:
                        last_ts = parse(ts_str)
                    except Exception:
                        pass
            if last_ts and (now - last_ts).total_seconds() > _COMPLETED_GRACE_SECONDS:
                continue
        visible.append(j)
    visible.sort(
        key=lambda j: j.get("metadata", {}).get("creationTimestamp", ""),
        reverse=True,
    )
    return visible


async def _get_live_jobs() -> list:
    return await asyncio.to_thread(_get_live_jobs_sync)


def _merge_pipeline_stages(pipeline_def: Optional[dict], actual_stages: list) -> list:
    """Overlay real per-task status (from whatever TaskRuns Tekton has
    created so far) onto a pipeline's full, predefined task order — so the
    Pipeline Timeline shows every step a job *will* run, not just the ones
    that happen to have started already. Falls back to `actual_stages`
    as-is if the pipeline isn't one we have a definition for.
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


def _parse_iso_utc(value: Optional[str]) -> Optional[datetime]:
    """Parse a UTC ISO-8601 timestamp (as sent by the frontend's
    timezone.ts, always ending in "Z") into an aware datetime, or None."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


# Sortable-column keys shared by every jobs-table column header on the
# frontend (Live Jobs + History use these; "date" and "duration" only make
# sense for history, since a live job has no completed_at/duration yet —
# see the fallback to created_at below).
_LIVE_SORT_KEYS = {
    "name": lambda s: (s.get("name") or "").lower(),
    "project": lambda s: (s.get("project") or "").lower(),
    "cluster": lambda s: (s.get("cluster") or "").lower(),
    "status": lambda s: (s.get("status") or "").lower(),
    "owner": lambda s: (s.get("owner") or "").lower(),
    "date": lambda s: s.get("created_at") or "",
    "age": lambda s: s.get("created_at") or "",
    "triggered_by": lambda s: (s.get("triggered_by_schedule") or "").lower(),
}


# ─── routes: jobs ────────────────────────────────────────────────────────

@router.get("/jobs", response_model=JobListResponse)
@router.get("/jobs/", response_model=JobListResponse, include_in_schema=False)
async def list_jobs(
    tab: str = Query("live", regex="^(live|history)$"),
    project: str = Query(""),
    cluster: str = Query(""),
    status: str = Query(""),
    owner: str = Query(""),
    start_time: Optional[str] = Query(None, description="ISO 8601 UTC — history tab only"),
    end_time: Optional[str] = Query(None, description="ISO 8601 UTC — history tab only"),
    sort_by: str = Query(""),
    sort_dir: str = Query("desc", regex="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    if tab == "live":
        jobs = await _get_live_jobs()
        if project:
            jobs = [
                j for j in jobs
                if _extract_forge_info(j).get("project") == project
            ]
        if cluster:
            jobs = [
                j for j in jobs
                if j.get("spec", {}).get("cluster") == cluster
            ]
        if status:
            jobs = [
                j for j in jobs
                if j.get("status", {}).get("phase") == status
            ]
        if owner:
            jobs = [
                j for j in jobs
                if j.get("spec", {}).get("owner") == owner
            ]
        summaries = [_live_job_to_summary(j) for j in jobs]
        key_fn = _LIVE_SORT_KEYS.get(sort_by)
        if key_fn:
            summaries.sort(key=key_fn, reverse=(sort_dir == "desc"))
        total = len(summaries)
        offset = (page - 1) * per_page
        summaries = summaries[offset: offset + per_page]
    else:
        created_after = _parse_iso_utc(start_time)
        created_before = _parse_iso_utc(end_time)
        async with AsyncSessionLocal() as session:
            db_jobs, total = await db_svc.list_jobs(
                session,
                project=project or None,
                cluster=cluster or None,
                status=status or None,
                owner=owner or None,
                created_after=created_after,
                created_before=created_before,
                sort_by=sort_by or None,
                sort_dir=sort_dir,
                limit=per_page,
                offset=(page - 1) * per_page,
            )
        summaries = [_db_job_to_summary(j) for j in db_jobs]

    return {
        "jobs": summaries,
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/jobs/{job_name}")
async def get_job(job_name: str):
    job = await asyncio.to_thread(k8s.get_fournos_job, job_name)

    pods = []
    stages = []
    current_step = None

    if job:
        pods_raw = await asyncio.to_thread(k8s.list_pods_for_job, job_name)
        pods = [
            {
                "name": p["name"],
                "phase": p["phase"],
                "container": p["container"],
                "ready": p["ready"],
                "restarts": p["restarts"],
                "age_minutes": p["age_minutes"],
                "exit_code": p.get("exit_code"),
                "term_reason": p.get("term_reason", ""),
                "term_message": p.get("term_message", ""),
            }
            for p in pods_raw
        ]

        pr_name = job.get("status", {}).get("pipelineRun", "")
        pr = None
        if pr_name:
            pr = await asyncio.to_thread(k8s.get_pipelinerun, pr_name)
        if not pr:
            prs = await asyncio.to_thread(
                k8s.list_pipelineruns_for_job, job_name
            )
            pr = prs[0] if prs else None
        if pr:
            stages = await asyncio.to_thread(
                k8s.extract_pipeline_stages, pr
            )

        pipeline_name = job.get("spec", {}).get("pipeline", "")
        if pipeline_name:
            pipeline_def = await pipeline_definitions.get_definition(pipeline_name)
            stages = _merge_pipeline_stages(pipeline_def, stages)

        step = await asyncio.to_thread(
            k8s.get_current_step_for_job, job_name
        )
        current_step = step

        forge_info = _extract_forge_info(job)
        task_progress = _parse_task_progress(
            job.get("status", {}).get("message", "")
        )

        return {
            "job": {
                "metadata": job.get("metadata", {}),
                "spec": job.get("spec", {}),
                "status": job.get("status", {}),
                "source": "live",
                "duration_seconds": None,
                "mlflow_url": "",
                "ci_artifacts_url": "",
            },
            "pods": pods,
            "stages": stages,
            "current_step": current_step,
            "forge_info": forge_info,
            "task_progress": task_progress,
        }

    async with AsyncSessionLocal() as session:
        db_job = await db_svc.get_job_by_name(session, job_name)
    if db_job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    fjob = _db_job_to_fjob_dict(db_job)
    forge_info = _extract_forge_info(fjob)
    task_progress = _parse_task_progress(
        fjob.get("status", {}).get("message", "")
    )

    return {
        "job": fjob,
        "pods": [],
        "stages": [],
        "current_step": None,
        "forge_info": forge_info,
        "task_progress": task_progress,
    }


@router.get("/jobs/{job_name}/events", response_model=List[JobEventResponse])
async def get_job_events(job_name: str):
    async with AsyncSessionLocal() as session:
        db_job = await db_svc.get_job_by_name(session, job_name)
        if db_job is None:
            raise HTTPException(404, "Job not found in history")
        events = await db_svc.get_job_events(session, db_job.id)
        return [
            {
                "id": e.id,
                "phase": e.phase,
                "message": e.message,
                "timestamp": e.timestamp,
            }
            for e in events
        ]


@router.post("/jobs/{job_name}/cancel")
async def cancel_job(job_name: str, _=Depends(require_admin)):
    try:
        await asyncio.to_thread(k8s.shutdown_fournos_job, job_name)
        return {"status": "ok", "message": "Shutdown requested for {}".format(job_name)}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/jobs/{job_name}/rerun")
async def rerun_job(job_name: str, _=Depends(require_admin)):
    job = await asyncio.to_thread(k8s.get_fournos_job, job_name)
    if not job:
        async with AsyncSessionLocal() as session:
            db_job = await db_svc.get_job_by_name(session, job_name)
            if db_job:
                job = _db_job_to_fjob_dict(db_job)

    if job is None:
        raise HTTPException(404, "Job not found")

    spec = dict(job.get("spec", {}))
    forge = spec.get("executionEngine", {}).get("forge", {})
    project = forge.get("project", "unknown")
    spec.pop("shutdown", None)

    new_name = k8s.sanitize_job_name("forge-{}".format(project))
    body = {
        "apiVersion": "{}/{}".format(
            settings.FOURNOS_API_GROUP, settings.FOURNOS_API_VERSION
        ),
        "kind": "FournosJob",
        "metadata": {
            "name": new_name,
            "namespace": settings.FOURNOS_NAMESPACE,
        },
        "spec": spec,
    }

    try:
        created = await asyncio.to_thread(k8s.create_fournos_job, body)
        created_name = created.get("metadata", {}).get("name", new_name)
        return {
            "status": "ok",
            "job_name": created_name,
            "redirect": "/testing/jobs/{}".format(created_name),
        }
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.delete("/history/{job_name}")
async def delete_history_job(job_name: str, _=Depends(require_admin)):
    async with AsyncSessionLocal() as session, session.begin():
        deleted = await db_svc.delete_job_by_name(session, job_name)
    if not deleted:
        raise HTTPException(404, "Job not found in history")
    return {"status": "ok"}


@router.get("/jobs/{job_name}/logs/{pod_name}")
async def stream_logs(job_name: str, pod_name: str):
    job_pods = await asyncio.to_thread(k8s.list_pods_for_job, job_name)
    pod_names = {p["name"] for p in job_pods}
    if pod_name not in pod_names:
        raise HTTPException(404, "Pod not found for this job")

    async def generate():
        stop = asyncio.Event()
        queue: asyncio.Queue = asyncio.Queue(maxsize=64)
        loop = asyncio.get_event_loop()

        def _reader():
            try:
                for line in k8s.read_pod_log(pod_name, follow=True):
                    if stop.is_set():
                        break
                    try:
                        loop.call_soon_threadsafe(queue.put_nowait, line)
                    except asyncio.QueueFull:
                        pass
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        asyncio.get_event_loop().run_in_executor(None, _reader)
        try:
            while True:
                line = await queue.get()
                if line is None:
                    break
                yield "data: {}\n\n".format(line)
        finally:
            stop.set()

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── routes: submit ──────────────────────────────────────────────────────

def _apply_scheduling(spec: dict, schedule: str, scheduled_start_time: Optional[str]) -> None:
    """Set spec.schedule / spec.scheduledStartTime exactly as the FournosJob
    CRD expects (see fournos/manifests/crd.yaml) — the two are mutually
    exclusive on the CRD itself, so reject both being set here too rather
    than let the operator silently pick one.
    """
    if schedule and scheduled_start_time:
        raise HTTPException(
            400, "schedule and scheduled_start_time are mutually exclusive"
        )
    if schedule:
        spec["schedule"] = schedule
    elif scheduled_start_time:
        spec["scheduledStartTime"] = scheduled_start_time


@router.post("/submit", response_model=SubmitJobResponse)
async def submit_job(req: SubmitJobRequest, _=Depends(require_auth)):
    config_overrides = dict(req.config_overrides)

    if req.version:
        version_key = _VERSION_KEYS.get(
            req.project, "infrastructure.version"
        )
        config_overrides[version_key] = req.version

    display_name = "{} {}".format(req.project, req.preset).strip()
    secret_refs: List[str] = []

    if req.args:
        # Generic multi-arg submission from a schema-driven form (see
        # app/schemas/ui_schema.py) — one or more preset keys, in field order.
        args = req.args
        display_name = "{} {}".format(req.project, " ".join(args)).strip()
        job_name = k8s.sanitize_job_name("forge-{}".format(req.project))
    else:
        args = [req.preset] if req.preset else []
        job_name = k8s.sanitize_job_name("forge-{}".format(req.project))

    env = {}
    if req.pull_sha.strip():
        env["PULL_PULL_SHA"] = req.pull_sha.strip()

    spec: dict[str, Any] = {
        "cluster": req.cluster,
        "displayName": display_name,
        "owner": req.owner or "fournos-dashboard",
        "pipeline": req.pipeline,
        "exclusive": req.exclusive,
        "priority": req.priority,
        "executionEngine": {
            "forge": {
                "project": req.project,
                "args": args,
                "configOverrides": config_overrides,
            }
        },
    }
    if req.gpu_type.strip():
        spec["hardware"] = {
            "gpuType": req.gpu_type.strip(),
            "gpuCount": req.gpu_count or 1,
        }
    if secret_refs:
        spec["secretRefs"] = secret_refs
    _apply_scheduling(spec, req.schedule, req.scheduled_start_time)

    body: dict[str, Any] = {
        "apiVersion": "{}/{}".format(
            settings.FOURNOS_API_GROUP, settings.FOURNOS_API_VERSION
        ),
        "kind": "FournosJob",
        "metadata": {
            "name": job_name,
            "namespace": settings.FOURNOS_NAMESPACE,
        },
        "spec": spec,
    }
    if env:
        body["spec"]["env"] = env

    try:
        created = await asyncio.to_thread(k8s.create_fournos_job, body)
    except Exception as exc:
        raise HTTPException(500, "Failed to create FournosJob: {}".format(exc))

    created_name = created.get("metadata", {}).get("name", job_name)
    initial_status = (
        "Recurring" if req.schedule else "Scheduled" if req.scheduled_start_time else "Pending"
    )

    try:
        async with AsyncSessionLocal() as session, session.begin():
            await db_svc.upsert_job(
                session,
                name=created_name,
                project=req.project,
                preset=req.preset or " ".join(req.args),
                cluster=req.cluster,
                pipeline=req.pipeline,
                owner=req.owner or "fournos-dashboard",
                status=initial_status,
                config_overrides=config_overrides,
                fjob_spec=body.get("spec", {}),
                trigger_type=(
                    "recurring-parent" if req.schedule
                    else "deferred" if req.scheduled_start_time
                    else "manual"
                ),
            )
    except Exception as exc:
        logger.error(
            "DB upsert failed for %s (job was created in K8s): %s",
            created_name,
            exc,
        )

    return {
        "status": "ok",
        "job_name": created_name,
        "redirect": "/testing/jobs/{}".format(created_name),
    }


# ─── routes: matrix (pipeline/CPT-style) submission ─────────────────────
#
# Generic across every project that declares a `kind: matrix` mode in its
# ui/submit.yaml (see app/schemas/ui_schema.py) — no project-specific code.

@router.post("/submit-matrix", response_model=SubmitMatrixResponse)
async def submit_matrix(req: SubmitMatrixRequest, _=Depends(require_auth)):
    """Submit a matrix pipeline — creates one FournosJob per model, each
    carrying all of the selected workloads plus the shared args/overrides.
    """
    if not req.models or not req.workloads:
        raise HTTPException(400, "models and workloads are required")

    results = []
    for model_item in req.models:
        args = list(req.args) + [model_item.key] + list(req.workloads)

        job_overrides: dict[str, Any] = dict(req.config_overrides)
        job_overrides.update({k: v for k, v in model_item.overrides.items()})

        display_name = "{}-{}-{}".format(req.project, model_item.key, req.cluster)
        generate_name = re.sub(
            r"[^a-z0-9-]", "-", "{}-{}-".format(req.project, model_item.key).lower()
        )

        env: dict[str, str] = {}
        if req.pull_sha.strip():
            env["PULL_PULL_SHA"] = req.pull_sha.strip()

        spec: dict[str, Any] = {
            "cluster": req.cluster,
            "displayName": display_name,
            "owner": req.owner,
            "pipeline": req.pipeline,
            "exclusive": req.exclusive,
            "priority": req.priority,
            "executionEngine": {
                "forge": {
                    "project": req.project,
                    "args": args,
                    "configOverrides": job_overrides,
                }
            },
        }
        if req.gpu_type.strip() or model_item.gpu_count:
            spec["hardware"] = {
                "gpuType": req.gpu_type.strip() or "unknown",
                "gpuCount": model_item.gpu_count or 1,
            }
        _apply_scheduling(spec, req.schedule, req.scheduled_start_time)

        body: dict[str, Any] = {
            "apiVersion": "{}/{}".format(
                settings.FOURNOS_API_GROUP, settings.FOURNOS_API_VERSION
            ),
            "kind": "FournosJob",
            "metadata": {
                "generateName": generate_name,
                "namespace": settings.FOURNOS_NAMESPACE,
            },
            "spec": spec,
        }
        if env:
            body["spec"]["env"] = env

        try:
            created = await asyncio.to_thread(k8s.create_fournos_job, body)
            created_name = created.get("metadata", {}).get("name", generate_name)
            results.append({
                "model": model_item.key,
                "job_name": created_name,
                "status": "created",
            })

            try:
                async with AsyncSessionLocal() as session, session.begin():
                    await db_svc.upsert_job(
                        session,
                        name=created_name,
                        project=req.project,
                        preset="{} {}".format(model_item.key, " ".join(req.workloads)),
                        cluster=req.cluster,
                        pipeline=req.pipeline,
                        owner=req.owner,
                        status=(
                            "Recurring" if req.schedule
                            else "Scheduled" if req.scheduled_start_time
                            else "Pending"
                        ),
                        config_overrides=job_overrides,
                        fjob_spec=body.get("spec", {}),
                        trigger_type=(
                            "recurring-parent" if req.schedule
                            else "deferred" if req.scheduled_start_time
                            else "manual"
                        ),
                    )
            except Exception as exc:
                logger.error(
                    "DB upsert failed for matrix job %s: %s", created_name, exc
                )
        except Exception as exc:
            results.append({
                "model": model_item.key,
                "status": "failed",
                "error": str(exc),
            })

    return {"status": "ok", "jobs": results, "total": len(results)}


# ─── routes: projects ───────────────────────────────────────────────────

@router.get("/projects", response_model=List[ProjectInfoResponse])
async def list_projects():
    projects = discover_projects()
    return [
        {
            "name": p.name,
            "cluster": p.cluster,
            "presets": p.presets,
            "config_keys": p.config_keys,
            "has_cli": p.has_cli,
        }
        for p in projects
    ]


@router.get("/projects/{project_name}", response_model=ProjectInfoResponse)
async def project_info(project_name: str):
    proj = get_project(project_name)
    if proj is None:
        return {"name": project_name, "presets": [], "cluster": ""}
    return {
        "name": proj.name,
        "cluster": proj.cluster,
        "presets": proj.presets,
        "config_keys": proj.config_keys,
        "has_cli": proj.has_cli,
    }


@router.get("/projects/{project_name}/ui-schema", response_model=ProjectUiSchemaResponse)
async def project_ui_schema_api(project_name: str):
    """Fetch a project's declarative submit-form schema
    (``projects/<name>/ui/submit.yaml`` in the Forge repo), if it publishes one.

    This is the generic, shared mechanism: any Forge project can add this
    file to get a fully dynamic submit form without project-specific code
    in the Control Center.
    """
    schema = await project_ui_schema.get_schema(project_name)
    return ProjectUiSchemaResponse(
        found=schema is not None, project=project_name, ui_schema=schema
    )


@router.post("/projects/{project_name}/ui-schema/refresh")
async def project_ui_schema_refresh(project_name: str, _=Depends(require_auth)):
    """Force-refresh the cached ui/submit.yaml for a project from GitHub."""
    schema = await project_ui_schema.refresh_schema(project_name)
    return {"status": "ok", "found": schema is not None}


@router.get("/pipelines")
async def list_pipelines():
    return settings.FOURNOS_DEFAULT_PIPELINES.split(",")


# ─── routes: GitHub PRs ─────────────────────────────────────────────────
#
# Cached server-side (like Forge project discovery) so the open-PR list is
# fetched from GitHub once and reused for every user/poll, rather than on
# every request — GitHub's unauthenticated rate limit (60/hr per source IP)
# is shared across the whole deployment, not per-user.

_open_prs_cache: Optional[list] = None
_open_prs_inflight: Optional["asyncio.Future[list]"] = None


def _fetch_github_open_prs_sync() -> list:
    url = (
        "https://api.github.com/repos/{}/pulls"
        "?state=open&per_page=100"
    ).format(settings.FORGE_GITHUB_REPO)
    req = urllib.request.Request(
        url, headers={"Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        prs = json.loads(resp.read())

    return [
        {
            "number": pr["number"],
            "title": pr["title"],
            "author": pr["user"]["login"],
            "head_sha": pr["head"]["sha"],
            "branch": pr["head"]["ref"],
            "draft": pr["draft"],
        }
        for pr in prs
    ]


async def _fetch_open_prs_coalesced() -> list:
    """Fetch open PRs from GitHub, coalescing concurrent callers into a
    single outbound request (protects against a stampede on cold cache /
    simultaneous forced refreshes) and caching the result on success.
    """
    global _open_prs_cache, _open_prs_inflight

    if _open_prs_inflight is not None:
        return await _open_prs_inflight

    future: "asyncio.Future[list]" = asyncio.ensure_future(
        asyncio.to_thread(_fetch_github_open_prs_sync)
    )
    _open_prs_inflight = future
    try:
        prs = await future
    finally:
        _open_prs_inflight = None

    _open_prs_cache = prs
    return prs


@router.get("/github/open-prs", response_model=List[GitHubPR])
async def github_open_prs():
    """Return the cached open-PR list, fetching it from GitHub on first use.
    Never refetches once cached — call POST .../open-prs/refresh to force that.
    """
    if _open_prs_cache is not None:
        return _open_prs_cache

    try:
        return await _fetch_open_prs_coalesced()
    except Exception as exc:
        logger.error("Failed to fetch open PRs from GitHub: %s", exc)
        raise HTTPException(502, "GitHub API error: {}".format(exc))


@router.post("/github/open-prs/refresh", response_model=List[GitHubPR])
async def github_open_prs_refresh(_=Depends(require_auth)):
    """Force-refresh the open-PR list from GitHub. Auth-gated since, unlike
    the cached GET above, every call here is a real outbound GitHub request
    and could otherwise be used to exhaust the deployment-wide rate limit.
    On failure this surfaces a 502 rather than silently serving stale data,
    so the UI's Refresh action gives honest feedback.
    """
    try:
        return await _fetch_open_prs_coalesced()
    except Exception as exc:
        logger.error("Failed to refresh open PRs from GitHub: %s", exc)
        raise HTTPException(502, "GitHub API error: {}".format(exc))


# ─── routes: recurring jobs ──────────────────────────────────────────────
#
# Native Fournos recurring jobs — a FournosJob with spec.schedule set, kept
# in "Recurring" phase by the operator as a template for child jobs (see
# fournos/fournos/handlers/lifecycle.py). No separate CRD, no Control
# Center-managed CronJobs — this reads/writes real FournosJob objects only.

def _recurring_job_to_response(job: dict) -> dict:
    meta = job.get("metadata", {})
    spec = job.get("spec", {})
    status = job.get("status", {})
    forge = spec.get("executionEngine", {}).get("forge", {})
    return {
        "name": meta.get("name", ""),
        "project": forge.get("project", ""),
        "cluster": spec.get("cluster", ""),
        "pipeline": spec.get("pipeline", ""),
        "preset": " ".join(forge.get("args", [])),
        "owner": spec.get("owner", ""),
        "schedule": spec.get("schedule", ""),
        "phase": status.get("phase", ""),
        "message": status.get("message", ""),
        "last_scheduled_time": status.get("lastScheduledTime"),
        "created_at": meta.get("creationTimestamp", ""),
    }


@router.get("/recurring-jobs", response_model=List[RecurringJobResponse])
async def list_recurring_jobs(cluster: str = Query("")):
    jobs = await asyncio.to_thread(k8s.list_recurring_jobs)
    if cluster:
        jobs = [j for j in jobs if j.get("spec", {}).get("cluster") == cluster]
    return [_recurring_job_to_response(j) for j in jobs]


@router.get(
    "/recurring-jobs/{name}/children",
    response_model=List[ScheduleChildJobResponse],
)
async def recurring_job_children(name: str):
    """Child jobs spawned by this recurring template, newest first.

    Sourced from the Control Center's own DB (populated by the watcher from
    the fournos.dev/recurring-parent label) — this is also what backs the
    "Triggered By" link on the History tab and the click-through from the
    Schedules tab.
    """
    async with AsyncSessionLocal() as session:
        jobs = await db_svc.list_jobs_by_schedule(session, name)
    return [
        {
            "name": j.name,
            "status": j.status,
            "trigger_type": j.trigger_type or "recurring",
            "duration_seconds": j.duration_seconds,
            "mlflow_url": j.mlflow_url or "",
            "created_at": j.created_at.isoformat() if j.created_at else "",
        }
        for j in jobs
    ]


@router.post("/recurring-jobs/{name}/trigger")
async def trigger_recurring_job(name: str, _=Depends(require_admin)):
    """Force an immediate off-cycle child run — annotates the parent job
    with fournos.dev/trigger-now=true, exactly what `kubectl annotate` would
    do; the operator picks it up on its next ~5s reconcile tick.
    """
    try:
        await asyncio.to_thread(k8s.trigger_recurring_now, name)
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.delete("/recurring-jobs/{name}")
async def delete_recurring_job(name: str, _=Depends(require_admin)):
    try:
        await asyncio.to_thread(k8s.delete_fournos_job, name)
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(500, str(exc))


# ─── routes: cluster locks ───────────────────────────────────────────────
#
# Also not a separate resource — a FournosJob with spec.lockOnly (or a bare
# spec.lockUntil) holds the cluster's full Kueue quota without running a
# pipeline (see fournos/fournos/handlers/execution.py::is_lock_only).

def _cluster_lock_to_response(job: dict) -> dict:
    meta = job.get("metadata", {})
    spec = job.get("spec", {})
    status = job.get("status", {})
    return {
        "name": meta.get("name", ""),
        "cluster": spec.get("cluster", ""),
        "owner": spec.get("owner", ""),
        "reason": spec.get("displayName", ""),
        "phase": status.get("phase", ""),
        "lock_until": spec.get("lockUntil"),
        "scheduled_start_time": spec.get("scheduledStartTime"),
        "created_at": meta.get("creationTimestamp", ""),
    }


@router.get("/cluster-locks", response_model=List[ClusterLockResponse])
async def list_cluster_locks(cluster: str = Query("")):
    locks = await asyncio.to_thread(k8s.list_cluster_locks, None, cluster or None)
    return [_cluster_lock_to_response(j) for j in locks]


@router.post("/cluster-locks", response_model=ClusterLockResponse)
async def create_cluster_lock(
    req: CreateClusterLockRequest, _=Depends(require_auth)
):
    spec: dict[str, Any] = {
        "cluster": req.cluster,
        "displayName": req.reason or "Cluster lock",
        "owner": req.owner or "fournos-dashboard",
        "exclusive": True,
        "lockOnly": True,
    }
    if req.lock_until:
        spec["lockUntil"] = req.lock_until
    if req.scheduled_start_time:
        spec["scheduledStartTime"] = req.scheduled_start_time

    job_name = k8s.sanitize_job_name("lock-{}".format(req.cluster))
    body = {
        "apiVersion": "{}/{}".format(
            settings.FOURNOS_API_GROUP, settings.FOURNOS_API_VERSION
        ),
        "kind": "FournosJob",
        "metadata": {"name": job_name, "namespace": settings.FOURNOS_NAMESPACE},
        "spec": spec,
    }
    try:
        created = await asyncio.to_thread(k8s.create_fournos_job, body)
    except Exception as exc:
        raise HTTPException(500, "Failed to create cluster lock: {}".format(exc))
    return _cluster_lock_to_response(created)


@router.delete("/cluster-locks/{name}")
async def delete_cluster_lock(name: str, _=Depends(require_admin)):
    try:
        await asyncio.to_thread(k8s.delete_fournos_job, name)
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(500, str(exc))


# ─── routes: per-cluster overview ────────────────────────────────────────

@router.get("/clusters/{cluster}/overview", response_model=ClusterOverviewResponse)
async def cluster_overview(cluster: str):
    """Backs the "Defer / Recurring / Lock cluster" popup on the Submit
    page: what's running on this cluster now, what recurs on it, and what
    locks (active or scheduled) it has — all live from the fournos
    namespace, so it's always consistent with the Live Jobs and Schedules
    tabs.
    """
    all_jobs = await _get_live_jobs()
    current = [
        j for j in all_jobs if j.get("spec", {}).get("cluster") == cluster
    ]
    recurring = await asyncio.to_thread(k8s.list_recurring_jobs)
    recurring = [j for j in recurring if j.get("spec", {}).get("cluster") == cluster]
    locks = await asyncio.to_thread(k8s.list_cluster_locks, None, cluster)

    return {
        "cluster": cluster,
        "current_jobs": [_live_job_to_summary(j) for j in current],
        "recurring_jobs": [_recurring_job_to_response(j) for j in recurring],
        "locks": [_cluster_lock_to_response(j) for j in locks],
    }


# ─── routes: calendar slot holds ─────────────────────────────────────────
#
# Ephemeral "someone else is booking this slot right now" markers for the
# scheduling calendar — see slot_hold_service.py. Not a Fournos concept, so
# there's nothing to reconcile with the live cluster state here.

def _slot_hold_to_response(hold) -> dict:
    return {
        "cluster": hold.cluster,
        "start_time": hold.start_time,
        "held_by": hold.held_by,
        "expires_at": hold.expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


@router.get("/clusters/{cluster}/slot-holds", response_model=List[SlotHoldResponse])
async def list_slot_holds(cluster: str):
    return [_slot_hold_to_response(h) for h in slot_holds.list_holds(cluster)]


@router.post("/clusters/{cluster}/slot-holds", response_model=SlotHoldResponse)
async def create_slot_hold(cluster: str, req: HoldSlotRequest, user=Depends(require_auth)):
    """Claim (or refresh, if you already hold it) a calendar slot. 409s if
    someone else is actively booking the same slot right now.
    """
    try:
        hold = slot_holds.hold_slot(cluster, req.start_time, user["username"])
    except slot_holds.SlotAlreadyHeldError as exc:
        raise HTTPException(
            409,
            f"This time slot is currently being booked by {exc.hold.held_by}. "
            "Try another slot or wait a moment.",
        )
    return _slot_hold_to_response(hold)


@router.delete("/clusters/{cluster}/slot-holds")
async def release_slot_hold(
    cluster: str, start_time: str = Query(...), user=Depends(require_auth)
):
    slot_holds.release_slot(
        cluster, start_time, user["username"], force=user["role"] == "admin"
    )
    return {"status": "ok"}
