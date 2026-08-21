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
    CreateScheduleRequest,
    FournosJobDetail,
    FournosJobSummary,
    FournosPod,
    GitHubPR,
    JobEventResponse,
    JobListResponse,
    PipelineStage,
    ProjectInfoResponse,
    ResolverScriptResponse,
    ScheduleResponse,
    SubmitJobRequest,
    SubmitJobResponse,
)
from app.services import fournos_db_service as db_svc
from app.services import fournos_k8s_client as k8s
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


def _live_job_to_summary(job: dict) -> dict:
    meta = job.get("metadata", {})
    spec = job.get("spec", {})
    status = job.get("status", {})
    forge = spec.get("executionEngine", {}).get("forge", {})

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
        "trigger_type": meta.get("labels", {}).get(
            "fournos-launcher/trigger-type", "manual"
        ),
        "triggered_by_schedule": meta.get("labels", {}).get(
            "fournos-launcher/schedule-name"
        ),
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


def _compute_current_steps_sync(jobs: list) -> dict:
    steps = {}
    for j in jobs:
        phase = j.get("status", {}).get("phase", "")
        if phase not in ("Running", "Admitted"):
            continue
        name = j.get("metadata", {}).get("name", "")
        try:
            step = k8s.get_current_step_for_job(name)
            if step:
                steps[name] = step
        except Exception:
            pass
    return steps


# ─── routes: jobs ────────────────────────────────────────────────────────

@router.get("/jobs", response_model=JobListResponse)
async def list_jobs(
    tab: str = Query("live", regex="^(live|history)$"),
    project: str = Query(""),
    cluster: str = Query(""),
    status: str = Query(""),
    owner: str = Query(""),
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
        total = len(jobs)
        offset = (page - 1) * per_page
        jobs = jobs[offset: offset + per_page]
        summaries = [_live_job_to_summary(j) for j in jobs]
    else:
        async with AsyncSessionLocal() as session:
            db_jobs, total = await db_svc.list_jobs(
                session,
                project=project or None,
                cluster=cluster or None,
                status=status or None,
                owner=owner or None,
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

@router.post("/submit", response_model=SubmitJobResponse)
async def submit_job(req: SubmitJobRequest, _=Depends(require_auth)):
    config_overrides = dict(req.config_overrides)

    if req.version:
        version_key = _VERSION_KEYS.get(
            req.project, "infrastructure.version"
        )
        config_overrides[version_key] = req.version

    args = [req.preset] if req.preset else []
    job_name = k8s.sanitize_job_name("forge-{}".format(req.project))

    env = {}
    if req.pull_sha.strip():
        env["PULL_PULL_SHA"] = req.pull_sha.strip()

    body: dict[str, Any] = {
        "apiVersion": "{}/{}".format(
            settings.FOURNOS_API_GROUP, settings.FOURNOS_API_VERSION
        ),
        "kind": "FournosJob",
        "metadata": {
            "name": job_name,
            "namespace": settings.FOURNOS_NAMESPACE,
        },
        "spec": {
            "cluster": req.cluster,
            "displayName": "{} {}".format(req.project, req.preset).strip(),
            "owner": req.owner or "fournos-dashboard",
            "pipeline": req.pipeline,
            "exclusive": req.exclusive,
            "executionEngine": {
                "forge": {
                    "project": req.project,
                    "args": args,
                    "configOverrides": config_overrides,
                }
            },
        },
    }
    if env:
        body["spec"]["env"] = env

    try:
        created = await asyncio.to_thread(k8s.create_fournos_job, body)
    except Exception as exc:
        raise HTTPException(500, "Failed to create FournosJob: {}".format(exc))

    created_name = created.get("metadata", {}).get("name", job_name)

    try:
        async with AsyncSessionLocal() as session, session.begin():
            await db_svc.upsert_job(
                session,
                name=created_name,
                project=req.project,
                preset=req.preset,
                cluster=req.cluster,
                pipeline=req.pipeline,
                owner=req.owner or "fournos-dashboard",
                status="Pending",
                config_overrides=config_overrides,
                fjob_spec=body.get("spec", {}),
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


@router.get("/pipelines")
async def list_pipelines():
    return settings.FOURNOS_DEFAULT_PIPELINES.split(",")


# ─── routes: GitHub PRs ─────────────────────────────────────────────────

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


@router.get("/github/open-prs", response_model=List[GitHubPR])
async def github_open_prs():
    try:
        return await asyncio.to_thread(_fetch_github_open_prs_sync)
    except Exception as exc:
        raise HTTPException(502, "GitHub API error: {}".format(exc))


# ─── routes: schedules ──────────────────────────────────────────────────

@router.get("/schedules", response_model=List[ScheduleResponse])
async def list_schedules():
    return await asyncio.to_thread(k8s.list_managed_cronjobs)


@router.post("/schedules", response_model=ScheduleResponse)
async def create_schedule(
    req: CreateScheduleRequest, _=Depends(require_admin)
):
    try:
        result = await asyncio.to_thread(
            k8s.create_cronjob,
            name=req.name,
            schedule=req.cron_expr,
            project=req.project,
            cluster=req.cluster,
            pipeline=req.pipeline,
            preset=req.preset,
            image=req.image_source,
            owner=req.owner,
            resolver_script=req.resolver_script.strip()
            .replace("\r\n", "\n")
            .replace("\r", "\n"),
            resolver_image=req.resolver_image.strip(),
            resolver_filename=req.resolver_filename.strip(),
        )
        return result
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/schedules/{name}/runs")
async def schedule_runs(name: str):
    async with AsyncSessionLocal() as session:
        jobs = await db_svc.list_jobs_by_schedule(session, name)
        return [
            {
                "name": j.name,
                "status": j.status,
                "preset": j.preset,
                "trigger_type": j.trigger_type or "scheduled",
                "duration_seconds": j.duration_seconds,
                "mlflow_url": j.mlflow_url,
                "created_at": (
                    j.created_at.isoformat() if j.created_at else ""
                ),
            }
            for j in jobs
        ]


@router.post("/schedules/{name}/toggle")
async def toggle_schedule(name: str, _=Depends(require_admin)):
    cj = await asyncio.to_thread(k8s.get_managed_cronjob, name)
    if cj is None:
        raise HTTPException(404, "Schedule not found")
    await asyncio.to_thread(
        k8s.patch_cronjob_suspend, name, not cj["suspend"]
    )
    return {"status": "ok"}


@router.get("/schedules/{name}/resolver", response_model=ResolverScriptResponse)
async def get_resolver_script_route(name: str):
    cj = await asyncio.to_thread(k8s.get_managed_cronjob, name)
    if cj is None:
        raise HTTPException(404, "Schedule not found")
    cm_name = cj.get("resolver_configmap", "")
    if not cm_name:
        raise HTTPException(404, "No resolver script configured")
    filename, content = await asyncio.to_thread(
        k8s.get_resolver_script, cm_name
    )
    if not content:
        raise HTTPException(404, "Resolver ConfigMap not found")
    return {"filename": filename, "content": content}


@router.post("/schedules/{name}/trigger")
async def trigger_schedule(name: str, _=Depends(require_admin)):
    try:
        job = await asyncio.to_thread(k8s.trigger_cronjob, name)
        return {"status": "ok", "job_name": job}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.delete("/schedules/{name}")
async def delete_schedule(name: str, _=Depends(require_admin)):
    try:
        await asyncio.to_thread(k8s.delete_cronjob, name)
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(500, str(exc))
