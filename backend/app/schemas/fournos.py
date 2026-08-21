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
    version: str = ""
    owner: str = ""
    exclusive: bool = False
    config_overrides: Dict[str, str] = Field(default_factory=dict)
    pull_sha: str = ""


class SubmitJobResponse(BaseModel):
    status: str = "ok"
    job_name: str
    redirect: str = ""


# -- Schedule schemas --

class ScheduleResponse(BaseModel):
    name: str
    namespace: str = ""
    schedule: str
    suspend: bool = False
    project: str = ""
    cluster: str = ""
    pipeline: str = ""
    preset: str = ""
    owner: str = ""
    has_resolver: bool = False
    resolver_configmap: str = ""
    resolver_image: str = ""
    resolver_filename: str = ""
    created_at: str = ""
    last_schedule: str = ""
    active_count: int = 0


class CreateScheduleRequest(BaseModel):
    name: str
    project: str
    cluster: str
    pipeline: str = "forge-test-only"
    preset: str = ""
    cron_expr: str
    image_source: str = ""
    owner: str = ""
    resolver_script: str = ""
    resolver_image: str = ""
    resolver_filename: str = ""


class ResolverScriptResponse(BaseModel):
    filename: str
    content: str


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
