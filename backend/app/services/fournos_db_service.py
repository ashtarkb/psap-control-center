"""Database operations for FournosJob history — uses the shared PSAP database."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional, Sequence, Tuple
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fournos_job import FournosJob, FournosJobEvent

logger = logging.getLogger(__name__)

# History is meant to be "jobs that ran end to end" — recurring *templates*
# and cluster locks have their own tabs (Schedules/Locks) and never belong
# here, and a job that's still live shouldn't show up twice (once live,
# once mid-run in history) before it actually finishes.
TERMINAL_STATUSES = ("Succeeded", "Failed", "Stopped")

# Maps the sortable keys the frontend's table headers use to actual
# columns — "date" means "when it finished" (completed_at), which is what
# history is naturally ordered by; duration/name/etc. are exposed too so
# every column header can drive the sort.
_SORT_COLUMNS = {
    "name": FournosJob.name,
    "project": FournosJob.project,
    "cluster": FournosJob.cluster,
    "status": FournosJob.status,
    "owner": FournosJob.owner,
    "date": FournosJob.completed_at,
    "duration": FournosJob.duration_seconds,
    "triggered_by": FournosJob.triggered_by_schedule,
}


async def upsert_job(session: AsyncSession, **kwargs: Any) -> FournosJob:
    if "id" not in kwargs:
        kwargs["id"] = str(uuid4())

    update_cols = {
        k: v for k, v in kwargs.items()
        if k not in ("id", "name") and v is not None
    }

    stmt = (
        pg_insert(FournosJob)
        .values(**kwargs)
        .on_conflict_do_update(index_elements=["name"], set_=update_cols)
        .returning(FournosJob)
    )
    result = await session.execute(stmt)
    return result.scalar_one()


async def add_job_event(
    session: AsyncSession,
    job_id: str,
    phase: str,
    message: str = "",
) -> FournosJobEvent:
    event = FournosJobEvent(job_id=job_id, phase=phase, message=message)
    session.add(event)
    await session.flush()
    return event


async def get_job_by_name(
    session: AsyncSession, name: str
) -> Optional[FournosJob]:
    result = await session.execute(
        select(FournosJob).where(FournosJob.name == name)
    )
    return result.scalar_one_or_none()


async def list_jobs(
    session: AsyncSession,
    *,
    project: Optional[str] = None,
    cluster: Optional[str] = None,
    status: Optional[str] = None,
    owner: Optional[str] = None,
    created_after: Optional[datetime] = None,
    created_before: Optional[datetime] = None,
    sort_by: Optional[str] = None,
    sort_dir: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> Tuple[Sequence[FournosJob], int]:
    stmt = select(FournosJob).where(
        FournosJob.status.in_(TERMINAL_STATUSES),
        FournosJob.is_lock.is_(False),
        FournosJob.trigger_type != "recurring-parent",
    )
    count_stmt = select(func.count(FournosJob.id)).where(
        FournosJob.status.in_(TERMINAL_STATUSES),
        FournosJob.is_lock.is_(False),
        FournosJob.trigger_type != "recurring-parent",
    )

    if project:
        stmt = stmt.where(FournosJob.project == project)
        count_stmt = count_stmt.where(FournosJob.project == project)
    if cluster:
        stmt = stmt.where(FournosJob.cluster == cluster)
        count_stmt = count_stmt.where(FournosJob.cluster == cluster)
    if status:
        stmt = stmt.where(FournosJob.status == status)
        count_stmt = count_stmt.where(FournosJob.status == status)
    if owner:
        stmt = stmt.where(FournosJob.owner == owner)
        count_stmt = count_stmt.where(FournosJob.owner == owner)
    if created_after:
        stmt = stmt.where(FournosJob.created_at >= created_after)
        count_stmt = count_stmt.where(FournosJob.created_at >= created_after)
    if created_before:
        stmt = stmt.where(FournosJob.created_at <= created_before)
        count_stmt = count_stmt.where(FournosJob.created_at <= created_before)

    sort_col = _SORT_COLUMNS.get(sort_by or "date", FournosJob.completed_at)
    order_by = sort_col.asc() if sort_dir == "asc" else sort_col.desc()
    stmt = stmt.order_by(order_by).limit(limit).offset(offset)

    result = await session.execute(stmt)
    jobs = result.scalars().all()

    count_result = await session.execute(count_stmt)
    total = count_result.scalar() or 0

    return jobs, total


async def list_jobs_by_schedule(
    session: AsyncSession, schedule_name: str
) -> Sequence[FournosJob]:
    result = await session.execute(
        select(FournosJob)
        .where(FournosJob.triggered_by_schedule == schedule_name)
        .order_by(FournosJob.created_at.desc())
    )
    return result.scalars().all()


async def delete_job_by_name(
    session: AsyncSession, name: str
) -> bool:
    job = await get_job_by_name(session, name)
    if job is None:
        return False
    await session.delete(job)
    await session.flush()
    return True


async def get_job_events(
    session: AsyncSession, job_id: str
) -> Sequence[FournosJobEvent]:
    result = await session.execute(
        select(FournosJobEvent)
        .where(FournosJobEvent.job_id == job_id)
        .order_by(FournosJobEvent.timestamp)
    )
    return result.scalars().all()
