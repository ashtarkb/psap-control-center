"""Pydantic schemas for the Fournos Testing Tab API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# -- Job schemas --

class FournosJobSummary(BaseModel):
    name: str
    project: str = ""
    preset: str = ""
    cluster: str = ""
    pipeline: str = ""
    owner: str = ""
    status: str = "Pending"
    message: str = ""
    created_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None
    mlflow_url: str = ""
    trigger_type: str = "manual"
    triggered_by_schedule: Optional[str] = None
    # When set (deferred one-off jobs only), the actual planned start —
    # distinct from created_at, which is just when the CR object was
    # created. Powers the cluster calendar's day view.
    scheduled_start_time: Optional[str] = None
    source: str = "live"

    class Config:
        from_attributes = True


class FournosJobDetail(BaseModel):
    metadata: Dict[str, Any] = Field(default_factory=dict)
    spec: Dict[str, Any] = Field(default_factory=dict)
    status: Dict[str, Any] = Field(default_factory=dict)
    source: str = "live"
    duration_seconds: Optional[float] = None
    mlflow_url: str = ""
    ci_artifacts_url: str = ""


class PipelineStage(BaseModel):
    name: str
    displayName: str = ""
    status: str = "Pending"
    startTime: Optional[str] = None
    completionTime: Optional[str] = None
    is_finally: bool = Field(False, alias="finally")

    class Config:
        populate_by_name = True


class TaskProgress(BaseModel):
    completed: int = 0
    failed: int = 0
    cancelled: int = 0
    incomplete: int = 0
    skipped: int = 0
    total: int = 0


class FournosPod(BaseModel):
    name: str
    phase: str = "Unknown"
    container: str = "unknown"
    ready: bool = False
    restarts: int = 0
    age_minutes: int = 0
    exit_code: Optional[int] = None
    term_reason: str = ""
    term_message: str = ""


class CurrentStep(BaseModel):
    name: str
    displayName: str = ""
    startTime: Optional[str] = None


class ForgeInfo(BaseModel):
    project: str = ""
    args: List[str] = Field(default_factory=list)
    config_overrides: Dict[str, Any] = Field(default_factory=dict)
    pr_number: str = ""
    pr_title: str = ""
    pr_url: str = ""


# -- Job event schemas --

class JobEventResponse(BaseModel):
    id: str
    phase: str
    message: str = ""
    timestamp: Optional[datetime] = None

    class Config:
        from_attributes = True


# -- Job list response --

class JobListResponse(BaseModel):
    jobs: List[FournosJobSummary]
    total: int
    page: int
    per_page: int


# -- Submit job --

class SubmitJobRequest(BaseModel):
    project: str
    cluster: str
    pipeline: str = "forge-test-only"
    preset: str = ""
    # Generic multi-arg support for schema-driven forms (see ui_schema.py):
    # a project can declare several "arg fields" (e.g. model + deployment
    # preset + cluster config), each contributing one or more preset keys
    # here, all passed through to Forge as CLI args. Takes precedence over
    # `preset` when non-empty.
    args: List[str] = Field(default_factory=list)
    version: str = ""
    owner: str = ""
    exclusive: bool = False
    config_overrides: Dict[str, str] = Field(default_factory=dict)
    pull_sha: str = ""
    priority: str = "manual"
    gpu_type: str = ""
    gpu_count: int = 1
    # Scheduling — mirrors FournosJob's own spec.schedule / scheduledStartTime
    # (see fournos/manifests/crd.yaml) exactly; the Control Center is just a
    # UTC-converting UI on top, mutually exclusive same as the CRD itself.
    scheduled_start_time: Optional[str] = None
    schedule: str = ""


class SubmitJobResponse(BaseModel):
    status: str = "ok"
    job_name: str
    redirect: str = ""


# -- Matrix (pipeline/CPT-style) submission --
#
# Generic multi-job submission for a schema-driven "matrix" mode (see
# app/schemas/ui_schema.py): one job per selected model, matrixed against
# the selected workloads. Not project-specific — any project whose
# ui/submit.yaml declares a `kind: matrix` mode can use this.

class SubmitMatrixModelInput(BaseModel):
    key: str
    overrides: Dict[str, Any] = Field(default_factory=dict)
    gpu_count: Optional[int] = None


class SubmitMatrixRequest(BaseModel):
    project: str
    cluster: str
    pipeline: str = "forge-full"
    # Shared args/overrides applied to every generated job (e.g. the
    # mode's own accelerator/engine/cluster field selections).
    args: List[str] = Field(default_factory=list)
    config_overrides: Dict[str, str] = Field(default_factory=dict)
    models: List[SubmitMatrixModelInput]
    workloads: List[str]
    owner: str = "fournos-dashboard"
    priority: str = "manual"
    exclusive: bool = False
    pull_sha: str = ""
    gpu_type: str = ""
    scheduled_start_time: Optional[str] = None
    schedule: str = ""


class SubmitMatrixResultItem(BaseModel):
    model: str
    job_name: Optional[str] = None
    status: str
    error: Optional[str] = None


class SubmitMatrixResponse(BaseModel):
    status: str = "ok"
    jobs: List[SubmitMatrixResultItem]
    total: int


# -- Recurring jobs --
#
# A "recurring job" is not a separate resource — it's a FournosJob whose
# spec.schedule is set, which the operator keeps in "Recurring" phase and
# uses as a template to stamp out child FournosJobs on each cron tick (see
# fournos/fournos/handlers/lifecycle.py). Children carry the
# fournos.dev/recurring-parent label pointing back at this job's name.

class RecurringJobResponse(BaseModel):
    name: str
    project: str = ""
    cluster: str = ""
    pipeline: str = ""
    preset: str = ""
    owner: str = ""
    schedule: str = ""  # cron expression, UTC
    phase: str = ""
    message: str = ""
    last_scheduled_time: Optional[str] = None
    created_at: str = ""


class ScheduleChildJobResponse(BaseModel):
    name: str
    status: str = "Pending"
    trigger_type: str = "recurring"
    duration_seconds: Optional[float] = None
    mlflow_url: str = ""
    created_at: str = ""


# -- Cluster locks --
#
# Also not a separate resource — a FournosJob with spec.lockOnly (or a bare
# spec.lockUntil) is a sentinel that holds the cluster's exclusive Kueue
# quota without running a pipeline (see fournos/fournos/handlers/
# execution.py::is_lock_only). Can be scheduled to start later via the same
# spec.scheduledStartTime every other FournosJob supports.

class ClusterLockResponse(BaseModel):
    name: str
    cluster: str = ""
    owner: str = ""
    reason: str = ""
    phase: str = ""
    lock_until: Optional[str] = None
    scheduled_start_time: Optional[str] = None
    created_at: str = ""


class CreateClusterLockRequest(BaseModel):
    cluster: str
    owner: str = ""
    reason: str = ""
    lock_until: Optional[str] = None  # ISO 8601 UTC; omit = held indefinitely
    scheduled_start_time: Optional[str] = None  # ISO 8601 UTC; omit = now


class ClusterOverviewResponse(BaseModel):
    """Combined per-cluster view backing the "Defer / Recurring / Lock"
    popup on the Submit page: what's running now, what recurs, and what's
    locked (now or scheduled for later) — all sourced live from the fournos
    namespace, the same data the Schedules tab and Live Jobs tab use.
    """

    cluster: str
    current_jobs: List[FournosJobSummary] = Field(default_factory=list)
    recurring_jobs: List[RecurringJobResponse] = Field(default_factory=list)
    locks: List[ClusterLockResponse] = Field(default_factory=list)


# -- Calendar slot holds --
#
# Purely a Control Center UX nicety, not a Fournos concept: a short-lived,
# in-memory claim on a (cluster, start_time) slot in the scheduling
# calendar so two users can't both be mid-way through booking the exact
# same slot at once. Fournos itself is happy to queue multiple jobs
# targeting the same cluster/time regardless — see slot_hold_service.py.

class SlotHoldResponse(BaseModel):
    cluster: str
    start_time: str  # ISO 8601 UTC, truncated to the slot granularity
    held_by: str
    expires_at: str


class HoldSlotRequest(BaseModel):
    start_time: str  # ISO 8601 UTC


# -- Project info --

class ProjectInfoResponse(BaseModel):
    name: str
    cluster: str = ""
    presets: List[str] = Field(default_factory=list)
    config_keys: List[str] = Field(default_factory=list)
    has_cli: bool = False


# -- GitHub PR --

class GitHubPR(BaseModel):
    number: int
    title: str
    author: str
    head_sha: str
    branch: str
    draft: bool = False


# -- GitHub sync status --
#
# Everything sourced from the Forge GitHub repo (project discovery,
# ui/submit.yaml schemas, pipeline definitions, open PRs) is refreshed on
# one shared schedule/lock (see github_sync_service.py) instead of on every
# page load, to stay well under GitHub's unauthenticated 60 req/hr limit.

class GithubSyncStatusResponse(BaseModel):
    in_progress: bool = False
    last_synced_at: Optional[str] = None
    last_error: Optional[str] = None
    project_count: int = 0
