"""Cost estimation: public IBM rates, billing actuals, GPU pod history."""

import calendar
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cluster import Cluster
from app.models.cluster_cost import ClusterCost
from app.models.gpu_pod_history import GpuPodHistory
from app.models.node_history import NodeHistory
from app.services import ibm_catalog_service
from app.utils.logger import create_logger

logger = create_logger("CostEstimationService")

_CACHE_TTL = 300  # 5 minutes
_year_summary_cache: Dict[int, Tuple[float, Dict[str, Any]]] = {}


async def estimate_month(
    cluster_id: str, db: AsyncSession,
    month: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute a cost estimate for a given month (defaults to current).
    Includes actual billing cost when available."""
    now = datetime.utcnow()
    if month:
        yr, mo = (int(p) for p in month.split("-"))
    else:
        yr, mo = now.year, now.month
    billing_month = f"{yr:04d}-{mo:02d}"

    days_in_month = calendar.monthrange(yr, mo)[1]
    month_start = datetime(yr, mo, 1)
    month_end = datetime(yr, mo, days_in_month, 23, 59, 59)
    is_current = billing_month == now.strftime("%Y-%m")

    result = await db.execute(
        select(NodeHistory).where(NodeHistory.cluster_id == cluster_id)
    )
    nodes = result.scalars().all()
    if not nodes:
        return _empty_estimate(cluster_id, billing_month)

    type_region_pairs = list({
        (n.instance_type, n.region)
        for n in nodes
        if n.instance_type and n.instance_type != "unknown"
        and n.region and n.region != "unknown"
    })
    rates = await ibm_catalog_service.ensure_rates_for_types(
        type_region_pairs, db
    )

    discount_pct = await compute_discount(cluster_id, db)

    # Fetch actual billing for this month
    cost_result = await db.execute(
        select(ClusterCost).where(
            ClusterCost.cluster_id == cluster_id,
            ClusterCost.billing_month == billing_month,
            ClusterCost.total_cost.isnot(None),
        )
    )
    billing_row = cost_result.scalar_one_or_none()
    actual_total = (
        billing_row.total_cost if billing_row and billing_row.total_cost
        else None
    )

    node_estimates = []
    total_public = 0.0
    total_estimated = 0.0

    for node in nodes:
        rate = rates.get((node.instance_type, node.region))
        if rate is None:
            node_estimates.append({
                "node_name": node.node_name,
                "instance_type": node.instance_type,
                "region": node.region,
                "is_gpu": node.is_gpu_node,
                "hours_active": 0,
                "public_cost": 0,
                "estimated_cost": 0,
                "actual_cost": None,
                "rate_available": False,
            })
            continue

        effective_end = min(now, month_end) if is_current else month_end
        active_start = max(node.first_seen, month_start)
        active_end = min(node.last_seen, effective_end)
        hours_active = max(
            0, (active_end - active_start).total_seconds() / 3600
        )

        public_cost = rate * hours_active
        estimated_cost = public_cost * (1 - discount_pct)

        total_public += public_cost
        total_estimated += estimated_cost

        node_estimates.append({
            "node_name": node.node_name,
            "instance_type": node.instance_type,
            "region": node.region,
            "is_gpu": node.is_gpu_node,
            "hours_active": round(hours_active, 1),
            "public_rate": rate,
            "public_cost": round(public_cost, 2),
            "estimated_cost": round(estimated_cost, 2),
            "actual_cost": None,
            "rate_available": True,
        })

    # Pro-rate actual cost to individual nodes based on public cost share
    if actual_total and total_public > 0:
        for ne in node_estimates:
            if ne["rate_available"] and ne["public_cost"] > 0:
                share = ne["public_cost"] / total_public
                ne["actual_cost"] = round(actual_total * share, 2)

    return {
        "cluster_id": cluster_id,
        "billing_month": billing_month,
        "total_public_cost": round(total_public, 2),
        "total_estimated_cost": round(total_estimated, 2),
        "total_actual_cost": (
            round(actual_total, 2) if actual_total else None
        ),
        "discount_pct": round(discount_pct * 100, 1),
        "node_count": len(nodes),
        "nodes": node_estimates,
    }


async def estimate_current_month(
    cluster_id: str, db: AsyncSession
) -> Dict[str, Any]:
    """Convenience wrapper for current month."""
    return await estimate_month(cluster_id, db)


async def compute_discount(
    cluster_id: str, db: AsyncSession
) -> float:
    """Derive discount % by comparing most recent billing actual vs public rate cost.
    Returns a float between 0.0 and 1.0."""
    result = await db.execute(
        select(ClusterCost)
        .where(
            ClusterCost.cluster_id == cluster_id,
            ClusterCost.total_cost.isnot(None),
        )
        .order_by(ClusterCost.billing_month.desc())
        .limit(1)
    )  # most recent billing month
    latest_cost = result.scalar_one_or_none()
    if not latest_cost or not latest_cost.total_cost or not latest_cost.node_breakdown:
        return 0.0

    bm = latest_cost.billing_month
    yr, mo = (int(p) for p in bm.split("-"))
    hours_in_month = calendar.monthrange(yr, mo)[1] * 24

    nh_result = await db.execute(
        select(NodeHistory).where(
            NodeHistory.cluster_id == cluster_id
        )
    )
    node_map = {
        nh.node_name: nh
        for nh in nh_result.scalars().all()
    }

    type_region_pairs = list({
        (nh.instance_type, nh.region)
        for nh in node_map.values()
        if nh.instance_type and nh.instance_type != "unknown"
        and nh.region and nh.region != "unknown"
    })
    rates = await ibm_catalog_service.ensure_rates_for_types(
        type_region_pairs, db
    )

    public_total = 0.0
    matched_nodes = 0
    cluster = await db.get(Cluster, cluster_id)
    infra_id = cluster.infra_id if cluster else None

    for entry in latest_cost.node_breakdown:
        instance_name = (
            entry.get("instance_name", "")
            or entry.get("node", "")
        )
        node_name = _strip_infra_prefix(
            instance_name, infra_id
        )
        nh = node_map.get(node_name)
        if not nh:
            continue
        rate = rates.get((nh.instance_type, nh.region))
        if rate is None:
            continue
        public_total += rate * hours_in_month
        matched_nodes += 1

    if public_total <= 0 or matched_nodes == 0:
        return 0.0

    actual_total = latest_cost.total_cost
    discount = max(0.0, 1.0 - (actual_total / public_total))
    return min(discount, 1.0)


async def attribute_workloads(
    cluster_id: str, month: str, db: AsyncSession
) -> List[Dict[str, Any]]:
    """Distribute GPU-node cost by namespace GPU-hours."""
    year, mon = (int(p) for p in month.split("-"))
    month_start = datetime(year, mon, 1)
    days = calendar.monthrange(year, mon)[1]
    month_end = datetime(year, mon, days, 23, 59, 59)

    result = await db.execute(
        select(GpuPodHistory).where(
            GpuPodHistory.cluster_id == cluster_id,
            GpuPodHistory.first_seen <= month_end,
            GpuPodHistory.last_seen >= month_start,
        )
    )
    pods = result.scalars().all()
    if not pods:
        return []

    ns_gpu_hours: Dict[str, float] = {}
    for pod in pods:
        start = max(pod.first_seen, month_start)
        end = min(pod.last_seen, month_end)
        hours = max(0, (end - start).total_seconds() / 3600)
        gpu_hours = hours * pod.gpu_count
        ns_gpu_hours[pod.namespace] = ns_gpu_hours.get(pod.namespace, 0) + gpu_hours

    total_gpu_hours = sum(ns_gpu_hours.values())
    if total_gpu_hours <= 0:
        return []

    estimate = await estimate_month(cluster_id, db, month)
    gpu_cost = sum(
        n["estimated_cost"]
        for n in estimate.get("nodes", [])
        if n.get("is_gpu")
    )

    workloads = []
    for ns, gpu_hrs in sorted(ns_gpu_hours.items(), key=lambda x: -x[1]):
        pct = gpu_hrs / total_gpu_hours
        workloads.append({
            "namespace": ns,
            "gpu_hours": round(gpu_hrs, 1),
            "percentage": round(pct * 100, 1),
            "estimated_cost": round(gpu_cost * pct, 2),
        })

    return workloads


async def get_year_summary(
    year: int, db: AsyncSession
) -> Dict[str, Any]:
    """Build a 12-month cost view with caching, projected costs, and discount."""
    now_ts = time.time()
    cached = _year_summary_cache.get(year)
    if cached and (now_ts - cached[0]) < _CACHE_TTL:
        return cached[1]

    result = await _compute_year_summary(year, db)
    _year_summary_cache[year] = (now_ts, result)
    return result


def invalidate_year_cache(year: Optional[int] = None):
    """Clear cached year summaries (called after billing upload or rate refresh)."""
    if year:
        _year_summary_cache.pop(year, None)
    else:
        _year_summary_cache.clear()


async def _compute_year_summary(
    year: int, db: AsyncSession
) -> Dict[str, Any]:
    now = datetime.utcnow()
    current_month = now.strftime("%Y-%m")

    clusters_result = await db.execute(
        select(Cluster).where(
            Cluster.is_active == True  # noqa: E712
        )
    )
    clusters = clusters_result.scalars().all()

    cost_result = await db.execute(
        select(ClusterCost).where(
            ClusterCost.billing_month.like(f"{year}-%"),
            ClusterCost.total_cost.isnot(None),
        )
    )
    all_costs = cost_result.scalars().all()

    cost_by_cluster_month: Dict[Tuple[str, str], float] = {}
    for c in all_costs:
        cost_by_cluster_month[(c.cluster_id, c.billing_month)] = c.total_cost

    nh_result = await db.execute(select(NodeHistory))
    all_nodes = nh_result.scalars().all()
    nodes_by_cluster: Dict[str, List[NodeHistory]] = {}
    for nh in all_nodes:
        nodes_by_cluster.setdefault(nh.cluster_id, []).append(nh)

    type_region_pairs = list({
        (nh.instance_type, nh.region)
        for nh in all_nodes
        if nh.instance_type and nh.instance_type != "unknown"
        and nh.region and nh.region != "unknown"
    })
    rates = await ibm_catalog_service.ensure_rates_for_types(
        type_region_pairs, db
    )

    aggregate_actual = sum(c.total_cost for c in all_costs)
    aggregate_public = 0.0
    for c in all_costs:
        yr, mo = (int(p) for p in c.billing_month.split("-"))
        h = calendar.monthrange(yr, mo)[1] * 24
        c_nodes = nodes_by_cluster.get(c.cluster_id, [])
        for node in c_nodes:
            rate = rates.get((node.instance_type, node.region))
            if rate:
                aggregate_public += rate * h

    aggregate_discount = 0.0
    if aggregate_actual > 0 and aggregate_public > 0:
        aggregate_discount = max(
            0.0, min(1.0, 1.0 - (aggregate_actual / aggregate_public))
        )

    months = []
    ytd_actual = 0.0
    ytd_public = 0.0
    ytd_estimated = 0.0

    for mon in range(1, 13):
        month_str = f"{year}-{mon:02d}"
        days_in_month = calendar.monthrange(year, mon)[1]
        hours_in_month = days_in_month * 24

        is_current = month_str == current_month
        is_future = month_str > current_month

        cluster_data = []
        month_actual_total = 0.0
        month_public_total = 0.0

        for cluster in clusters:
            actual = cost_by_cluster_month.get((cluster.id, month_str))
            if actual is not None:
                month_actual_total += actual

            c_nodes = nodes_by_cluster.get(cluster.id, [])
            public = 0.0
            for node in c_nodes:
                rate = rates.get((node.instance_type, node.region))
                if rate:
                    public += rate * hours_in_month
            month_public_total += public

            c_estimated = (
                round(public * (1 - aggregate_discount), 2)
                if (is_current or is_future) and public > 0
                else None
            )
            cluster_data.append({
                "cluster_id": cluster.id,
                "cluster_name": cluster.name,
                "cluster_color": cluster.color,
                "actual_cost": round(actual, 2) if actual is not None else None,
                "public_cost": round(public, 2),
                "estimated_cost": c_estimated,
            })

        savings = (
            round(month_public_total - month_actual_total, 2)
            if month_actual_total > 0 and month_public_total > 0
            else None
        )
        discount = (
            round(
                (1 - month_actual_total / month_public_total) * 100, 1
            )
            if month_actual_total > 0 and month_public_total > 0
            else None
        )

        month_estimated = None
        if (is_current or is_future) and month_public_total > 0:
            month_estimated = round(
                month_public_total * (1 - aggregate_discount), 2
            )

        if not is_future:
            ytd_actual += month_actual_total
            ytd_public += month_public_total
            ytd_estimated += (
                month_estimated if month_estimated is not None
                else month_actual_total
            )

        months.append({
            "month": month_str,
            "actual_total": (
                round(month_actual_total, 2) if month_actual_total else None
            ),
            "public_total": round(month_public_total, 2),
            "estimated_total": month_estimated,
            "savings": savings,
            "discount_pct": discount,
            "aggregate_discount_pct": (
                round(aggregate_discount * 100, 1)
                if aggregate_discount > 0 else None
            ),
            "is_estimate": is_current or is_future,
            "clusters": cluster_data,
        })

    ytd_savings = (
        round(ytd_public - ytd_actual, 2) if ytd_actual > 0 else None
    )
    ytd_discount = (
        round((1 - ytd_actual / ytd_public) * 100, 1)
        if ytd_actual > 0 and ytd_public > 0 else None
    )

    return {
        "year": year,
        "months": months,
        "ytd_actual": round(ytd_actual, 2),
        "ytd_public": round(ytd_public, 2),
        "ytd_estimated": round(ytd_estimated, 2),
        "ytd_savings": ytd_savings,
        "ytd_discount_pct": ytd_discount,
        "aggregate_discount_pct": (
            round(aggregate_discount * 100, 1)
            if aggregate_discount > 0 else None
        ),
        "cluster_count": len(clusters),
    }


def _strip_infra_prefix(instance_name: str, infra_id: Optional[str]) -> str:
    """Strip the infra_id prefix from a billing instance name to get the K8s node name."""
    if not infra_id or not instance_name:
        return instance_name
    prefix = f"{infra_id}-"
    if instance_name.startswith(prefix):
        return instance_name[len(prefix):]
    return instance_name


def _empty_estimate(cluster_id: str, billing_month: str) -> Dict[str, Any]:
    return {
        "cluster_id": cluster_id,
        "billing_month": billing_month,
        "total_public_cost": 0,
        "total_estimated_cost": 0,
        "discount_pct": 0,
        "node_count": 0,
        "nodes": [],
    }
