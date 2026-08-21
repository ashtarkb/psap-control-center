from datetime import date, datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.core.database import get_db
from app.core.auth import require_admin
from app.models.instance_type_rate import InstanceTypeRate
from app.models.node_history import NodeHistory
from app.schemas.cost_estimation import (
    ClusterEstimate,
    InstanceTypeRateResponse,
    RateRefreshResponse,
    WorkloadAttribution,
    YearSummary,
)
from app.services import (
    cost_estimation_service,
    cost_snapshot_service,
    ibm_catalog_service,
)
from app.utils.logger import create_logger

logger = create_logger("CostExplorerAPI")

router = APIRouter()


@router.get("/snapshots")
async def get_snapshots(
    start: str = Query(
        ..., description="Start date (YYYY-MM-DD)"
    ),
    end: str = Query(
        ..., description="End date (YYYY-MM-DD)"
    ),
    granularity: str = Query(
        "monthly", description="daily, weekly, or monthly"
    ),
    cluster_id: Optional[str] = Query(None),
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Query pre-computed cost snapshots with flexible time range."""
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)
    if granularity not in ("daily", "weekly", "monthly"):
        granularity = "monthly"
    return await cost_snapshot_service.get_snapshots(
        db, start_date, end_date, granularity, cluster_id
    )


@router.post("/snapshots/recompute")
async def recompute_snapshots(
    start: Optional[str] = Query(
        None, description="Start date (YYYY-MM-DD)"
    ),
    end: Optional[str] = Query(
        None, description="End date (YYYY-MM-DD)"
    ),
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Force recompute all snapshots."""
    s = date.fromisoformat(start) if start else None
    e = date.fromisoformat(end) if end else None
    total = await cost_snapshot_service.recompute_all(db, s, e)
    return {"recomputed": total}


@router.get("/year/{year}", response_model=YearSummary)
async def get_year_summary(
    year: int,
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await cost_estimation_service.get_year_summary(year, db)


@router.get(
    "/clusters/{cluster_id}/estimate",
    response_model=ClusterEstimate,
)
async def get_cluster_estimate(
    cluster_id: str,
    month: Optional[str] = Query(
        None,
        description="Billing month (YYYY-MM). Defaults to current.",
    ),
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await cost_estimation_service.estimate_month(
        cluster_id, db, month
    )


@router.get(
    "/clusters/{cluster_id}/workloads",
    response_model=List[WorkloadAttribution],
)
async def get_workload_attribution(
    cluster_id: str,
    month: Optional[str] = Query(
        None,
        description="Billing month (YYYY-MM). Defaults to current month.",
    ),
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not month:
        month = datetime.utcnow().strftime("%Y-%m")
    return await cost_estimation_service.attribute_workloads(
        cluster_id, month, db
    )


@router.get("/rates", response_model=List[InstanceTypeRateResponse])
async def get_rates(
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List cached rates."""
    nh_result = await db.execute(select(NodeHistory))
    all_nodes = nh_result.scalars().all()

    type_region_pairs = list({
        (n.instance_type, n.region)
        for n in all_nodes
        if n.instance_type and n.instance_type != "unknown"
        and n.region and n.region != "unknown"
    })
    if type_region_pairs:
        await ibm_catalog_service.ensure_rates_for_types(
            type_region_pairs, db
        )

    await ibm_catalog_service.refresh_stale_rates(db)

    result = await db.execute(
        select(InstanceTypeRate).order_by(InstanceTypeRate.instance_type)
    )
    rates = result.scalars().all()
    return [
        InstanceTypeRateResponse(
            instance_type=r.instance_type,
            region=r.region,
            public_hourly_rate=r.public_hourly_rate,
            plan_id=r.plan_id,
            is_estimated=getattr(r, 'is_estimated', False) or False,
            last_fetched=r.last_fetched,
        )
        for r in rates
    ]


@router.post("/rates/refresh", response_model=RateRefreshResponse)
async def refresh_rates(
    _user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Force re-fetch all rates then recompute snapshots."""
    result = await db.execute(select(InstanceTypeRate))
    total = len(result.scalars().all())
    updated = await ibm_catalog_service.refresh_all_rates(db)
    cost_estimation_service.invalidate_year_cache()
    await cost_snapshot_service.recompute_all(db)
    return RateRefreshResponse(updated=updated, total=total)
