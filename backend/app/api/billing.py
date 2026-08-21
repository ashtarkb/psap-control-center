from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from app.core.auth import require_admin
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.services import billing_csv_service
from app.schemas.cluster import BillingReportInfo, BillingReportListResponse
from app.utils.logger import create_logger
import os

logger = create_logger("BillingAPI")

router = APIRouter()

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


async def _refresh_all_cluster_costs():
    from app.main import cost_refresh_state
    from app.services.cluster_service import ClusterService

    if cost_refresh_state["in_progress"]:
        logger.info("Batch cost refresh already in progress, skipping")
        return

    cost_refresh_state["in_progress"] = True
    cost_refresh_state["completed"] = 0
    cost_refresh_state["last_cluster"] = None

    try:
        async with AsyncSessionLocal() as session:
            svc = ClusterService(session)
            clusters, _ = await svc.get_clusters(0, 200, active_only=False)
            eligible = [c for c in clusters if c.infra_id]
            cost_refresh_state["total"] = len(eligible)

            reports = billing_csv_service.get_available_reports()
            if not reports:
                logger.warning("No billing CSVs available for batch refresh")
                return

            parsed_csvs = []
            for report in reports:
                csv_path = report["file_path"]
                rows = billing_csv_service.parse_billing_csv(csv_path)
                tag_ids = billing_csv_service._read_cluster_ids_from_header(csv_path)
                parsed_csvs.append((csv_path, rows, tag_ids))

            for cluster in eligible:
                for csv_path, rows, tag_ids in parsed_csvs:
                    try:
                        await svc.refresh_cluster_cost(
                            cluster.id,
                            csv_path=csv_path,
                            rows=rows,
                            tag_ids=tag_ids,
                        )
                    except Exception as e:
                        logger.warning(f"Cost refresh failed for {cluster.name}: {e}")
                cost_refresh_state["completed"] += 1
                cost_refresh_state["last_cluster"] = cluster.name

        logger.info(f"Batch cost refresh completed: {cost_refresh_state['completed']}/{cost_refresh_state['total']}")

        from app.services import cost_snapshot_service
        await cost_snapshot_service.recompute_all(session)
        logger.info("Snapshots recomputed after billing refresh")
    except Exception as e:
        logger.error(f"Batch cost refresh error: {e}")
    finally:
        cost_refresh_state["in_progress"] = False


@router.post("/upload", response_model=BillingReportInfo)
async def upload_billing_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    auto_refresh: bool = Query(True),
    _user: dict = Depends(require_admin),
):
    """Upload an IBM Cloud billing CSV export."""
    try:
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be a valid UTF-8 CSV")

    billing_month = billing_csv_service._extract_billing_month_from_content(text)
    if not billing_month:
        raise HTTPException(
            status_code=400,
            detail="Could not extract billing month from CSV header. "
            "Expected IBM Cloud billing export format.",
        )

    file_name = f"{billing_month}.csv"
    file_path = os.path.join(settings.BILLING_CSV_STORAGE_PATH, file_name)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(text)

    infra_ids = billing_csv_service._read_cluster_ids_from_header(file_path)
    stat = os.stat(file_path)

    logger.info(
        f"Billing CSV uploaded: {billing_month}, "
        f"{stat.st_size} bytes, {len(infra_ids)} clusters detected"
    )

    if auto_refresh:
        background_tasks.add_task(_refresh_all_cluster_costs)

    from datetime import datetime
    return BillingReportInfo(
        billing_month=billing_month,
        file_name=file_name,
        file_size=stat.st_size,
        uploaded_at=datetime.fromtimestamp(stat.st_mtime),
        cluster_count=len(infra_ids),
    )


@router.get("/cost-refresh-status")
async def get_cost_refresh_status(
    _user: dict = Depends(require_admin),
):
    """Return the current state of the batch cost refresh."""
    from app.main import cost_refresh_state
    return cost_refresh_state


@router.get("/reports", response_model=BillingReportListResponse)
async def list_billing_reports(
    _user: dict = Depends(require_admin),
):
    """List all uploaded billing CSV reports."""
    reports = billing_csv_service.get_available_reports()
    infos = []
    for r in reports:
        infos.append(BillingReportInfo(
            billing_month=r["billing_month"],
            file_name=r["file_name"],
            file_size=r["file_size"],
            uploaded_at=r["uploaded_at"],
            cluster_count=r.get("cluster_count", 0),
        ))
    return BillingReportListResponse(reports=infos)


@router.delete("/{billing_month}", status_code=204)
async def delete_billing_report(
    billing_month: str,
    _user: dict = Depends(require_admin),
):
    """Delete a billing CSV report by month."""
    file_path = billing_csv_service.find_csv_for_month(billing_month)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"No billing report for {billing_month}")

    os.remove(file_path)
    logger.info(f"Billing CSV deleted: {billing_month}")
