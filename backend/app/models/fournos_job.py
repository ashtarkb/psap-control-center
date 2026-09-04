"""SQLAlchemy models for FournosJob history archival (PostgreSQL-only)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, Index,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base


class FournosJob(Base):
    __tablename__ = "fournos_jobs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name = Column(String(255), unique=True, nullable=False, index=True)
    project = Column(String(255), nullable=False, index=True)
    preset = Column(String(255), default="")
    cluster = Column(String(255), nullable=False, index=True)
    pipeline = Column(String(255), default="")
    owner = Column(String(255), default="", index=True)
    status = Column(String(50), default="Pending", index=True)
    message = Column(Text, default="")
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    completed_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Float, nullable=True)
    mlflow_url = Column(String(1024), default="")
    ci_artifacts_url = Column(String(1024), default="")
    config_overrides = Column(JSONB, default=dict)
    tags = Column(ARRAY(String), default=list)
    fjob_spec = Column(JSONB, default=dict)
    fjob_status = Column(JSONB, default=dict)
    # Snapshot of the merged pipeline stage list (same shape the live
    # job-detail endpoint builds via pipeline_definitions.merge_pipeline_
    # stages) taken when the job reaches a terminal phase (with a small retry
    # window for transient K8s failures). The PipelineRun/TaskRuns themselves
    # may be gone by the time a job is opened from History, so this is the
    # durable copy used to render the timeline and failed step.
    stages = Column(JSONB, default=list)
    # Failed/missing PipelineRun snapshots are retried a small, bounded number
    # of times. Keeping this state in the DB prevents every watcher restart or
    # full-sync pass from creating another Kubernetes API storm.
    stage_snapshot_attempts = Column(Integer, default=0, nullable=False)
    stage_snapshot_attempted_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, default="")
    triggered_by_schedule = Column(String(255), nullable=True, index=True)
    trigger_type = Column(String(50), default="manual")
    # A cluster lock is just a FournosJob with spec.lockOnly=True — tracked
    # explicitly (rather than inferred from name/trigger_type, both of which
    # can collide with real deferred jobs) so the History tab can exclude
    # locks the same way it excludes recurring-parent templates.
    is_lock = Column(Boolean, default=False, index=True)

    events = relationship(
        "FournosJobEvent",
        back_populates="job",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_fournos_jobs_created", "created_at"),
        # History tab defaults to sorting by completed_at (most recently
        # finished first) and always filters on status/is_lock/trigger_type
        # — without an index on completed_at, that ORDER BY forces a full
        # table scan + filesort that gets slower as history grows.
        Index("ix_fournos_jobs_completed", "completed_at"),
        Index("ix_fournos_jobs_trigger_type", "trigger_type"),
        # Composite index matching the History query's WHERE + ORDER BY
        # shape (status IN (...) AND is_lock = false AND trigger_type != ...
        # ORDER BY completed_at DESC) so it can be satisfied with an index
        # scan instead of a scan over the whole table.
        Index(
            "ix_fournos_jobs_history",
            "status", "is_lock", "trigger_type", "completed_at",
        ),
    )

    def __repr__(self):
        return f"<FournosJob({self.name} status={self.status})>"


class FournosJobEvent(Base):
    __tablename__ = "fournos_job_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    job_id = Column(
        String(36),
        ForeignKey("fournos_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phase = Column(String(50), nullable=False)
    message = Column(Text, default="")
    timestamp = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    job = relationship("FournosJob", back_populates="events")

    def __repr__(self):
        return f"<FournosJobEvent({self.phase} @ {self.timestamp})>"
