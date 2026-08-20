from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import datetime
from typing import List, Dict, Any

from app.models.gpu_pod_history import GpuPodHistory
from app.utils.logger import create_logger

logger = create_logger("GpuPodHistoryService")


async def sync_gpu_pods(
    db: AsyncSession,
    cluster_id: str,
    active_pods: List[Dict[str, Any]],
) -> None:
    """
    Upsert currently-running GPU pods and mark
    vanished ones as finished.
    """
    now = datetime.utcnow()

    active_keys = {
        (p["namespace"], p["name"]) for p in active_pods
    }

    # Fetch ALL records for this cluster (including finished) so we can
    # detect re-appeared pods instead of hitting the unique constraint.
    result = await db.execute(
        select(GpuPodHistory).where(
            GpuPodHistory.cluster_id == cluster_id,
        )
    )
    existing: List[GpuPodHistory] = list(
        result.scalars().all()
    )
    existing_by_key = {
        (r.namespace, r.pod_name): r for r in existing
    }

    for key, record in existing_by_key.items():
        if key not in active_keys and record.finished_at is None:
            record.finished_at = now
            record.last_seen = now

    for pod in active_pods:
        key = (pod["namespace"], pod["name"])
        if key in existing_by_key:
            record = existing_by_key[key]
            if record.finished_at is not None:
                record.finished_at = None
                record.first_seen = now
            record.last_seen = now
            record.gpu_count = pod["gpu_count"]
            record.node = pod.get("node")
        else:
            db.add(GpuPodHistory(
                cluster_id=cluster_id,
                pod_name=pod["name"],
                namespace=pod["namespace"],
                gpu_count=pod["gpu_count"],
                node=pod.get("node"),
                first_seen=now,
                last_seen=now,
            ))

    await db.commit()


async def get_pod_history(
    db: AsyncSession,
    cluster_id: str,
    limit: int = 25,
) -> List[GpuPodHistory]:
    """Return recently finished GPU pods, newest first."""
    result = await db.execute(
        select(GpuPodHistory)
        .where(
            and_(
                GpuPodHistory.cluster_id == cluster_id,
                GpuPodHistory.finished_at.is_not(None),
            )
        )
        .order_by(GpuPodHistory.finished_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
