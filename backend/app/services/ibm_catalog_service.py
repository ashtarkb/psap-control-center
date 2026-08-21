"""Fetch/cache IBM Cloud public rates from Global Catalog API."""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instance_type_rate import InstanceTypeRate
from app.utils.logger import create_logger

logger = create_logger("IBMCatalogService")

CATALOG_BASE = "https://globalcatalog.cloud.ibm.com/api/v1"
STALE_DAYS = 30
_HTTP_TIMEOUT = 20.0


async def get_or_fetch_rate(
    instance_type: str, region: str, db: AsyncSession
) -> Optional[float]:
    """Return the cached hourly rate, fetching from IBM API only if missing."""
    result = await db.execute(
        select(InstanceTypeRate).where(
            InstanceTypeRate.instance_type == instance_type,
            InstanceTypeRate.region == region,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        return row.public_hourly_rate

    rates = await _fetch_from_catalog(instance_type)
    if not rates:
        return None

    plan_id = rates.get("_plan_id")
    for r_region, r_rate in rates.items():
        if r_region.startswith("_"):
            continue
        existing = await db.execute(
            select(InstanceTypeRate).where(
                InstanceTypeRate.instance_type == instance_type,
                InstanceTypeRate.region == r_region,
            )
        )
        if existing.scalar_one_or_none():
            continue
        db.add(InstanceTypeRate(
            instance_type=instance_type,
            region=r_region,
            public_hourly_rate=r_rate,
            plan_id=plan_id,
            last_fetched=datetime.utcnow(),
        ))

    try:
        await db.commit()
    except Exception as e:
        logger.warning(f"Failed to persist rates for {instance_type}: {e}")
        await db.rollback()

    return rates.get(region)


async def ensure_rates_for_types(
    type_region_pairs: List[Tuple[str, str]], db: AsyncSession
) -> Dict[Tuple[str, str], float]:
    """Ensure rates exist for all given (instance_type, region) pairs.
    Returns a mapping of (instance_type, region) -> hourly_rate."""
    result = await db.execute(select(InstanceTypeRate))
    cached = {
        (r.instance_type, r.region): r
        for r in result.scalars().all()
    }

    missing_types = set()
    for itype, region in type_region_pairs:
        if (itype, region) not in cached:
            missing_types.add(itype)

    for itype in missing_types:
        rates = await _fetch_from_catalog(itype)
        if not rates:
            continue
        plan_id = rates.get("_plan_id")
        for r_region, r_rate in rates.items():
            if r_region.startswith("_"):
                continue
            if (itype, r_region) in cached:
                continue
            row = InstanceTypeRate(
                instance_type=itype,
                region=r_region,
                public_hourly_rate=r_rate,
                plan_id=plan_id,
                last_fetched=datetime.utcnow(),
            )
            db.add(row)
            cached[(itype, r_region)] = row

    if missing_types:
        try:
            await db.commit()
        except Exception as e:
            logger.warning(f"Failed to persist catalog rates: {e}")
            await db.rollback()

    return {k: v.public_hourly_rate for k, v in cached.items()}


async def refresh_stale_rates(db: AsyncSession) -> int:
    """Re-fetch rates older than STALE_DAYS. Returns count of updated rows."""
    cutoff = datetime.utcnow() - timedelta(days=STALE_DAYS)
    result = await db.execute(
        select(InstanceTypeRate).where(InstanceTypeRate.last_fetched < cutoff)
    )
    stale = result.scalars().all()
    if not stale:
        return 0

    types_to_refresh = {r.instance_type for r in stale}
    updated = 0
    for itype in types_to_refresh:
        rates = await _fetch_from_catalog(itype)
        if not rates:
            continue
        for row in stale:
            if row.instance_type != itype:
                continue
            new_rate = rates.get(row.region)
            if new_rate is None:
                continue
            if abs(new_rate - row.public_hourly_rate) > 0.001:
                logger.warning(
                    f"Rate changed for {itype}/{row.region}: "
                    f"${row.public_hourly_rate:.4f} -> ${new_rate:.4f}/hr"
                )
                row.public_hourly_rate = new_rate
                updated += 1
            row.last_fetched = datetime.utcnow()

    try:
        await db.commit()
    except Exception as e:
        logger.warning(f"Failed to persist refreshed rates: {e}")
        await db.rollback()

    logger.info(
        f"Refreshed {len(stale)} stale rates, {updated} changed"
    )
    return updated


async def refresh_all_rates(db: AsyncSession) -> int:
    """Force re-fetch all cached rates regardless of age."""
    result = await db.execute(select(InstanceTypeRate))
    all_rates = result.scalars().all()
    if not all_rates:
        return 0

    types_to_refresh = {r.instance_type for r in all_rates}
    updated = 0
    for itype in types_to_refresh:
        rates = await _fetch_from_catalog(itype)
        if not rates:
            continue
        for row in all_rates:
            if row.instance_type != itype:
                continue
            new_rate = rates.get(row.region)
            if new_rate is None:
                continue
            if abs(new_rate - row.public_hourly_rate) > 0.001:
                logger.warning(
                    f"Rate changed for {itype}/{row.region}: "
                    f"${row.public_hourly_rate:.4f} -> ${new_rate:.4f}/hr"
                )
                row.public_hourly_rate = new_rate
                updated += 1
            row.last_fetched = datetime.utcnow()

    try:
        await db.commit()
    except Exception as e:
        logger.warning(f"Failed to persist refreshed rates: {e}")
        await db.rollback()

    logger.info(
        f"Force-refreshed {len(all_rates)} rates, {updated} changed"
    )
    return updated


async def derive_rates_from_billing(db: AsyncSession) -> int:
    """For instance types without public rates, derive an estimated hourly
    rate from billing data. Computes per-cluster average hourly cost and
    assigns it proportionally to unpriced nodes."""
    from app.models.cluster_cost import ClusterCost
    from app.models.node_history import NodeHistory

    result = await db.execute(select(InstanceTypeRate))
    existing = {
        (r.instance_type, r.region) for r in result.scalars().all()
    }

    nh_result = await db.execute(select(NodeHistory))
    all_nodes = nh_result.scalars().all()
    nodes_by_cluster: dict = {}
    for n in all_nodes:
        nodes_by_cluster.setdefault(n.cluster_id, []).append(n)

    cost_result = await db.execute(
        select(ClusterCost).where(ClusterCost.total_cost.isnot(None))
    )
    billing: dict = {}
    for cc in cost_result.scalars().all():
        if cc.total_cost and cc.total_cost > 0:
            billing.setdefault(cc.cluster_id, []).append(cc)

    created = 0
    for cluster_id, cost_rows in billing.items():
        nodes = nodes_by_cluster.get(cluster_id, [])
        if not nodes:
            continue

        total_billing = sum(c.total_cost for c in cost_rows)
        total_node_months = len(cost_rows) * len(nodes)
        if total_node_months <= 0:
            continue

        avg_monthly_per_node = total_billing / total_node_months
        avg_hourly = avg_monthly_per_node / 730

        for n in nodes:
            key = (n.instance_type, n.region)
            if key in existing:
                continue
            if not n.instance_type or n.instance_type == "unknown":
                continue
            if not n.region or n.region == "unknown":
                continue

            db.add(InstanceTypeRate(
                instance_type=n.instance_type,
                region=n.region,
                public_hourly_rate=round(avg_hourly, 4),
                plan_id=None,
                is_estimated=True,
                last_fetched=datetime.utcnow(),
            ))
            existing.add(key)
            created += 1
            logger.info(
                f"Derived billing rate for {n.instance_type}"
                f"/{n.region}: ${avg_hourly:.4f}/hr"
            )

    if created:
        try:
            await db.commit()
        except Exception as e:
            logger.warning(f"Failed to persist derived rates: {e}")
            await db.rollback()
            return 0

    return created


async def _fetch_from_catalog(
    instance_type: str,
) -> Optional[Dict[str, object]]:
    """Query the IBM Cloud Global Catalog API for public hourly rates.
    Returns {region: hourly_rate, ..., '_plan_id': plan_id} or None."""
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{CATALOG_BASE}",
                params={"q": instance_type, "kind": "plan", "limit": 5},
            )
            resp.raise_for_status()
            data = resp.json()

            resource = None
            for r in data.get("resources", []):
                r_id = r.get("id")
                r_name = r.get("name")
                if r_id == instance_type or r_name == instance_type:
                    resource = r
                    break

            if not resource:
                logger.debug(f"No catalog entry found for {instance_type}")
                return None

            bss_info = (
                resource.get("metadata", {})
                .get("other", {})
                .get("profile", {})
                .get("default_config", {})
                .get("bss_info", [])
            )
            plan_id = None
            for comp in bss_info:
                if comp.get("component") == "instance":
                    for dep in comp.get("deployments", []):
                        if dep.get("type") == "multi-tenant":
                            plan_id = dep.get("plan")
                            break
                if plan_id:
                    break

            if not plan_id:
                logger.debug(
                    f"No plan_id found for {instance_type}"
                )
                return None

            pricing_resp = await client.get(
                f"{CATALOG_BASE}/{plan_id}/pricing/deployment"
            )
            pricing_resp.raise_for_status()
            pricing_data = pricing_resp.json()

            rates: Dict[str, object] = {"_plan_id": plan_id}
            for deployment in pricing_data.get("resources", []):
                region = deployment.get("deployment_location", "")
                if not region:
                    continue
                metrics = deployment.get("metrics") or []
                for metric in metrics:
                    unit = metric.get("charge_unit_name")
                    if unit != "INSTANCE_HOURS_MULTI_TENANT":
                        continue
                    for amount in metric.get("amounts", []):
                        is_usd = (
                            amount.get("country") == "USA"
                            and amount.get("currency") == "USD"
                        )
                        if is_usd:
                            prices = amount.get("prices", [])
                            if prices:
                                rates[region] = prices[0].get(
                                    "price", 0
                                )
                            break

            if len(rates) <= 1:
                logger.debug(
                    f"No regional pricing found for {instance_type}"
                )
                return None

            logger.info(
                f"Fetched {len(rates) - 1} regional rates "
                f"for {instance_type}"
            )
            return rates

    except httpx.HTTPError as e:
        logger.error(
            f"IBM Catalog API error for {instance_type}: {e}"
        )
        return None
    except Exception as e:
        logger.error(
            f"Error fetching rates for {instance_type}: {e}"
        )
        return None
