"""SQLAlchemy models for FournosJob history archival (PostgreSQL-only)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Column, DateTime, Float, ForeignKey, String, Text, Index,
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
    error_message = Column(Text, default="")
    triggered_by_schedule = Column(String(255), nullable=True, index=True)
    trigger_type = Column(String(50), default="manual")

    events = relationship(
        "FournosJobEvent",
        back_populates="job",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_fournos_jobs_created", "created_at"),
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
