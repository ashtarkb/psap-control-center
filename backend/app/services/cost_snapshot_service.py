"""Compute and store daily cost snapshots per cluster.

Snapshots are the single source of truth for the Cost Explorer UI.
They are recomputed when:
  - A cluster refresh updates NodeHistory
  - Billing CSV is uploaded (actual costs)
  - Public rates are refreshed
  - On-demand via API
"""

import calendar
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cluster import Cluster
from app.models.cluster_cost import ClusterCost
from app.models.cost_snapshot import CostSnapshot
from app.models.node_history import NodeHistory
from app.models.instance_type_rate import InstanceTypeRate
from app.utils.logger import create_logger

logger = create_logger("CostSnapshotService")


async def backfill_node_history(db: AsyncSession) -> int:
    """Backfill NodeHistory first_seen to the cluster's created_at date.
    Nodes were likely running since the cluster was added, not since we
    started tracking them. Only updates nodes whose first_seen == last_seen
    (i.e. never refreshed beyond the initial discovery)."""
    cluster_result = await db.execute(select(Cluster))
    clusters = {c.id: c for c in cluster_result.scalars().all()}

    nh_result = await db.execute(select(NodeHistory))
    all_nodes = nh_result.scalars().all()

    updated = 0
    for node in all_nodes:
        cluster = clusters.get(node.cluster_id)
        if not cluster or not cluster.created_at:
            continue
        cluster_created = cluster.created_at
        if isinstance(cluster_created, date) and not isinstance(cluster_created, datetime):
            cluster_created = datetime.combine(cluster_created, datetime.min.time())
        if node.first_seen > cluster_created:
            node.first_seen = cluster_created
            updated += 1

    if updated:
        try:
            await db.commit()
            logger.info(f"Backfilled first_seen for {updated} nodes")
        except Exception as e:
            logger.warning(f"Backfill commit failed: {e}")
            await db.rollback()
            return 0

    return updated


async def initialize_snapshots(db: AsyncSession) -> None:
    """One-time bootstrap: backfill node history and compute all snapshots.
    Skipped if snapshots already exist."""
    result = await db.execute(
        select(CostSnapshot).limit(5)
    )
    existing_count = len(result.scalars().all())

    backfilled = await backfill_node_history(db)
    if backfilled > 0 or existing_count < 5:
        logger.info("Initializing cost snapshots from stored data...")
        total = await recompute_all(db)
        logger.info(f"Snapshot initialization complete: {total} snapshots created")


async def _compute_aggregate_discount(db: AsyncSession) -> float:
    """Compute a single discount from all clusters with real billing data.
    Only uses non-NULL, non-zero billing and only public (non-estimated) rates
    so the discount reflects the real negotiated price reduction."""
    rate_result = await db.execute(select(InstanceTypeRate))
    rate_map = {}
    estimated_keys: set = set()
    for r in rate_result.scalars().all():
        rate_map[(r.instance_type, r.region)] = r.public_hourly_rate
        if r.is_estimated:
            estimated_keys.add((r.instance_type, r.region))

    cost_result = await db.execute(
        select(ClusterCost).where(
            ClusterCost.total_cost.isnot(None),
            ClusterCost.total_cost > 0,
        )
    )
    billing_rows = cost_result.scalars().all()
    if not billing_rows:
        return 0.0

    billing_by_cluster: Dict[str, Dict[str, float]] = {}
    for cc in billing_rows:
        billing_by_cluster.setdefault(
            cc.cluster_id, {}
        )[cc.billing_month] = cc.total_cost

    nh_result = await db.execute(select(NodeHistory))
    nodes_by_cluster: Dict[str, list] = {}
    for n in nh_result.scalars().all():
        nodes_by_cluster.setdefault(n.cluster_id, []).append(n)

    total_actual = 0.0
    total_public = 0.0
    for cid, months in billing_by_cluster.items():
        nodes = nodes_by_cluster.get(cid, [])
        total_actual += sum(months.values())
        for month_key in months:
            yr, mo = (int(p) for p in month_key.split("-"))
            hours = calendar.monthrange(yr, mo)[1] * 24
            for n in nodes:
                key = (n.instance_type, n.region)
                if key in estimated_keys:
                    continue
                rate = rate_map.get(key)
                if rate:
                    total_public += rate * hours

    if total_public <= 0:
        return 0.0

    discount = max(0.0, min(0.95, 1.0 - (total_actual / total_public)))
    logger.info(
        f"Aggregate discount: {discount*100:.1f}% "
        f"(actual=${total_actual:,.0f} / public=${total_public:,.0f})"
    )
    return discount


async def recompute_cluster(
    cluster_id: str, db: AsyncSession,
    start: Optional[date] = None,
    end: Optional[date] = None,
    aggregate_discount: Optional[float] = None,
) -> int:
    """Recompute daily snapshots for a single cluster over a date range.
    Uses aggregate_discount if provided, otherwise computes one."""
    today = date.today()

    nh_result = await db.execute(
        select(NodeHistory).where(NodeHistory.cluster_id == cluster_id)
    )
    nodes = nh_result.scalars().all()
    if not nodes:
        return 0

    rate_result = await db.execute(select(InstanceTypeRate))
    rate_map = {
        (r.instance_type, r.region): r.public_hourly_rate
        for r in rate_result.scalars().all()
    }

    earliest = min(n.first_seen.date() for n in nodes)
    if start is None:
        start = earliest
    if end is None:
        end = today

    cost_result = await db.execute(
        select(ClusterCost).where(
            ClusterCost.cluster_id == cluster_id,
            ClusterCost.total_cost.isnot(None),
            ClusterCost.total_cost > 0,
        )
    )
    billing_by_month: Dict[str, float] = {}
    for cc in cost_result.scalars().all():
        billing_by_month[cc.billing_month] = cc.total_cost

    if aggregate_discount is not None:
        discount = aggregate_discount
    else:
        discount = await _compute_aggregate_discount(db)

    existing_result = await db.execute(
        select(CostSnapshot).where(
            CostSnapshot.cluster_id == cluster_id,
            CostSnapshot.period_start >= start,
            CostSnapshot.period_start <= end,
        )
    )
    existing = {
        s.period_start: s for s in existing_result.scalars().all()
    }

    created = 0
    current = start
    while current <= end:
        if current in existing and existing[current].is_finalized:
            current += timedelta(days=1)
            continue

        active_nodes = [
            n for n in nodes
            if n.first_seen.date() <= current and n.last_seen.date() >= current
        ]

        day_public = 0.0
        for node in active_nodes:
            rate = rate_map.get((node.instance_type, node.region))
            if rate:
                day_public += rate * 24

        day_estimated = day_public * (1 - discount)

        month_key = current.strftime("%Y-%m")
        actual_for_day = None
        if month_key in billing_by_month:
            days_in_month = calendar.monthrange(
                current.year, current.month
            )[1]
            actual_for_day = billing_by_month[month_key] / days_in_month

        is_past = current < today

        if current in existing:
            snap = existing[current]
            snap.public_cost = round(day_public, 2)
            snap.estimated_cost = round(day_estimated, 2)
            snap.actual_cost = (
                round(actual_for_day, 2)
                if actual_for_day is not None else None
            )
            snap.discount_pct = round(discount * 100, 1)
            snap.node_count = len(active_nodes)
            snap.is_finalized = is_past and actual_for_day is not None
            snap.computed_at = datetime.utcnow()
        else:
            db.add(CostSnapshot(
                cluster_id=cluster_id,
                period_start=current,
                public_cost=round(day_public, 2),
                estimated_cost=round(day_estimated, 2),
                actual_cost=(
                    round(actual_for_day, 2)
                    if actual_for_day is not None else None
                ),
                discount_pct=round(discount * 100, 1),
                node_count=len(active_nodes),
                is_finalized=is_past and actual_for_day is not None,
                computed_at=datetime.utcnow(),
            ))
            created += 1

        current += timedelta(days=1)

    try:
        await db.commit()
    except Exception as e:
        logger.warning(f"Snapshot commit failed for {cluster_id}: {e}")
        await db.rollback()
        return 0

    logger.info(
        f"Snapshots for {cluster_id}: {created} created, "
        f"{end.isoformat()} range {start} to {end}"
    )
    return created


async def recompute_all(
    db: AsyncSession,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> int:
    """Recompute snapshots for all active clusters using a shared
    aggregate discount so projections are consistent."""
    from app.services import ibm_catalog_service
    await ibm_catalog_service.derive_rates_from_billing(db)

    # Un-finalize all snapshots so they get recomputed with new rates/discount
    all_snaps = await db.execute(select(CostSnapshot))
    for snap in all_snaps.scalars().all():
        snap.is_finalized = False
    await db.commit()

    discount = await _compute_aggregate_discount(db)
    logger.info(f"Recompute all using aggregate discount: {discount*100:.1f}%")

    result = await db.execute(
        select(Cluster).where(Cluster.is_active == True)  # noqa: E712
    )
    clusters = result.scalars().all()
    total = 0
    for cluster in clusters:
        total += await recompute_cluster(
            cluster.id, db, start, end,
            aggregate_discount=discount,
        )
    return total


async def update_current_day(
    cluster_id: str, db: AsyncSession,
) -> None:
    """Fast path: only update today's snapshot for a cluster after refresh."""
    today = date.today()
    await recompute_cluster(cluster_id, db, start=today, end=today)


async def mark_billing_updated(
    db: AsyncSession, billing_month: str,
) -> int:
    """Un-finalize snapshots for a billing month so they get recomputed."""
    yr, mo = (int(p) for p in billing_month.split("-"))
    month_start = date(yr, mo, 1)
    days = calendar.monthrange(yr, mo)[1]
    month_end = date(yr, mo, days)

    result = await db.execute(
        select(CostSnapshot).where(
            CostSnapshot.period_start >= month_start,
            CostSnapshot.period_start <= month_end,
        )
    )
    count = 0
    for snap in result.scalars().all():
        snap.is_finalized = False
        count += 1

    if count:
        await db.commit()

    return count


async def get_snapshots(
    db: AsyncSession,
    start: date,
    end: date,
    granularity: str = "monthly",
    cluster_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Query snapshots and aggregate to requested granularity.
    Future dates beyond today are projected using current node
    configuration and the aggregate discount."""
    today = date.today()
    query_end = min(end, today)

    filters = [
        CostSnapshot.period_start >= start,
        CostSnapshot.period_start <= query_end,
    ]
    if cluster_id:
        filters.append(CostSnapshot.cluster_id == cluster_id)

    result = await db.execute(
        select(CostSnapshot).where(and_(*filters))
        .order_by(CostSnapshot.period_start)
    )
    snapshots = list(result.scalars().all())

    cluster_result = await db.execute(select(Cluster))
    cluster_map = {
        c.id: {"name": c.name, "color": c.color}
        for c in cluster_result.scalars().all()
    }

    # Project future dates if the requested range extends beyond today
    if end > today:
        projected = await _project_future(
            db, today, end, cluster_id
        )
        snapshots.extend(projected)

    if granularity == "daily":
        return _format_daily(snapshots, cluster_map)
    elif granularity == "weekly":
        return _format_weekly(snapshots, cluster_map)
    else:
        return _format_monthly(snapshots, cluster_map)


async def _project_future(
    db: AsyncSession,
    after: date,
    through: date,
    cluster_id: Optional[str] = None,
) -> list:
    """Generate projected snapshot-like objects for future dates."""
    from app.models.instance_type_rate import InstanceTypeRate as ITR

    rate_result = await db.execute(select(ITR))
    rate_map = {
        (r.instance_type, r.region): r.public_hourly_rate
        for r in rate_result.scalars().all()
    }

    discount = await _compute_aggregate_discount(db)

    nh_filters = []
    if cluster_id:
        nh_filters.append(NodeHistory.cluster_id == cluster_id)
    nh_result = await db.execute(
        select(NodeHistory).where(*nh_filters) if nh_filters
        else select(NodeHistory)
    )
    all_nodes = nh_result.scalars().all()

    nodes_by_cluster: Dict[str, list] = {}
    for n in all_nodes:
        nodes_by_cluster.setdefault(n.cluster_id, []).append(n)

    projected = []
    current = after + timedelta(days=1)
    while current <= through:
        for cid, nodes in nodes_by_cluster.items():
            day_public = 0.0
            for node in nodes:
                rate = rate_map.get((node.instance_type, node.region))
                if rate:
                    day_public += rate * 24

            if day_public <= 0:
                continue

            day_estimated = day_public * (1 - discount)

            proj = _ProjectedSnapshot(
                cluster_id=cid,
                period_start=current,
                public_cost=round(day_public, 2),
                estimated_cost=round(day_estimated, 2),
                actual_cost=None,
                discount_pct=round(discount * 100, 1),
                node_count=len(nodes),
            )
            projected.append(proj)

        current += timedelta(days=1)

    return projected


class _ProjectedSnapshot:
    """Lightweight stand-in for CostSnapshot for future projections."""
    __slots__ = (
        'cluster_id', 'period_start', 'public_cost',
        'estimated_cost', 'actual_cost', 'discount_pct', 'node_count',
    )

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def _bucket_key_weekly(d: date) -> str:
    iso = d.isocalendar()
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def _bucket_key_monthly(d: date) -> str:
    return d.strftime("%Y-%m")


def _aggregate(
    snapshots: list,
    cluster_map: dict,
    key_fn,
) -> List[Dict[str, Any]]:
    """Group daily snapshots into buckets and aggregate."""
    buckets: Dict[str, Dict[str, Any]] = {}

    for snap in snapshots:
        key = key_fn(snap.period_start)
        if key not in buckets:
            buckets[key] = {
                "period": key,
                "public_total": 0.0,
                "estimated_total": 0.0,
                "actual_total": 0.0,
                "has_actual": False,
                "clusters": {},
            }
        b = buckets[key]
        b["public_total"] += snap.public_cost
        b["estimated_total"] += snap.estimated_cost
        if snap.actual_cost is not None:
            b["actual_total"] += snap.actual_cost
            b["has_actual"] = True

        cid = snap.cluster_id
        if cid not in b["clusters"]:
            info = cluster_map.get(cid, {"name": cid, "color": "#888"})
            b["clusters"][cid] = {
                "cluster_id": cid,
                "cluster_name": info["name"],
                "cluster_color": info["color"],
                "public_cost": 0.0,
                "estimated_cost": 0.0,
                "actual_cost": 0.0,
                "has_actual": False,
            }
        cc = b["clusters"][cid]
        cc["public_cost"] += snap.public_cost
        cc["estimated_cost"] += snap.estimated_cost
        if snap.actual_cost is not None:
            cc["actual_cost"] += snap.actual_cost
            cc["has_actual"] = True

    results = []
    for key in sorted(buckets.keys()):
        b = buckets[key]
        cluster_list = []
        for cc in sorted(
            b["clusters"].values(),
            key=lambda x: -x["public_cost"],
        ):
            cluster_list.append({
                "cluster_id": cc["cluster_id"],
                "cluster_name": cc["cluster_name"],
                "cluster_color": cc["cluster_color"],
                "public_cost": round(cc["public_cost"], 2),
                "estimated_cost": round(cc["estimated_cost"], 2),
                "actual_cost": (
                    round(cc["actual_cost"], 2) if cc["has_actual"] else None
                ),
            })

        pub = round(b["public_total"], 2)
        est = round(b["estimated_total"], 2)
        act = round(b["actual_total"], 2) if b["has_actual"] else None
        savings = round(pub - act, 2) if act is not None and pub > 0 else None
        discount = (
            round((1 - act / pub) * 100, 1)
            if act is not None and pub > 0 else None
        )

        results.append({
            "period": key,
            "public_total": pub,
            "estimated_total": est,
            "actual_total": act,
            "savings": savings,
            "discount_pct": discount,
            "clusters": cluster_list,
        })

    return results


def _format_daily(snapshots, cluster_map):
    return _aggregate(
        snapshots, cluster_map,
        lambda d: d.isoformat(),
    )


def _format_weekly(snapshots, cluster_map):
    return _aggregate(snapshots, cluster_map, _bucket_key_weekly)


def _format_monthly(snapshots, cluster_map):
    return _aggregate(snapshots, cluster_map, _bucket_key_monthly)


def _compute_discount_from_billing(
    nodes: list,
    rate_map: Dict[Tuple[str, str], float],
    billing_by_month: Dict[str, float],
) -> float:
    """Derive aggregate discount from available billing data."""
    if not billing_by_month:
        return 0.0

    total_actual = sum(billing_by_month.values())
    total_public = 0.0

    for month_key, actual in billing_by_month.items():
        yr, mo = (int(p) for p in month_key.split("-"))
        hours = calendar.monthrange(yr, mo)[1] * 24
        for node in nodes:
            rate = rate_map.get((node.instance_type, node.region))
            if rate:
                total_public += rate * hours

    if total_public <= 0:
        return 0.0

    discount = max(0.0, min(1.0, 1.0 - (total_actual / total_public)))
    return discount
