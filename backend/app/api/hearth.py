from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from app.core.auth import require_admin
from app.core.config import settings
from app.schemas.hearth import (
    HearthClusterListResponse,
    HearthClusterResponse,
    HearthConnectResponse,
    HearthStatusResponse,
)
from app.services.hearth_service import get_hearth_service
from app.utils.logger import create_logger

router = APIRouter()
logger = create_logger("HearthAPI")


@router.get("/status", response_model=HearthStatusResponse)
async def get_hearth_status():
    if not settings.HEARTH_ENABLED:
        return HearthStatusResponse(
            available=False,
            configured=False,
            error="Hearth integration is disabled",
        )

    service = get_hearth_service()
    return service.get_status()


@router.post(
    "/connect",
    response_model=HearthConnectResponse,
)
async def connect_hearth(
    file: UploadFile = File(...),
    _user: dict = Depends(require_admin),
):
    """Upload a kubeconfig for the management cluster to enable Hearth."""
    if not settings.HEARTH_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Hearth integration is disabled",
        )

    content = await file.read()
    try:
        kubeconfig_content = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Invalid file encoding",
        )

    service = get_hearth_service()
    service.save_kubeconfig(kubeconfig_content)

    status = service.get_status()
    if status.available:
        return HearthConnectResponse(
            success=True,
            message=(
                f"Connected to Hearth — "
                f"{status.cluster_count} cluster(s) discovered"
            ),
        )
    else:
        service.remove_kubeconfig()
        raise HTTPException(
            status_code=400,
            detail=(
                f"Kubeconfig saved but connection failed: "
                f"{status.error}"
            ),
        )


@router.post(
    "/disconnect",
    response_model=HearthConnectResponse,
)
async def disconnect_hearth(
    _user: dict = Depends(require_admin),
):
    """Remove the saved Hearth kubeconfig and disconnect."""
    service = get_hearth_service()
    service.remove_kubeconfig()
    return HearthConnectResponse(
        success=True,
        message="Disconnected from Hearth",
    )


@router.get(
    "/clusters",
    response_model=HearthClusterListResponse,
)
async def list_hearth_clusters():
    if not settings.HEARTH_ENABLED:
        return HearthClusterListResponse(
            clusters=[], total=0, available=False
        )

    try:
        service = get_hearth_service()
        clusters = service.list_clusters()
        return HearthClusterListResponse(
            clusters=clusters,
            total=len(clusters),
            available=True,
        )
    except Exception as exc:
        logger.error("Failed to list Hearth clusters:", exc)
        return HearthClusterListResponse(
            clusters=[], total=0, available=False
        )


@router.get(
    "/clusters/{cluster_name}",
    response_model=HearthClusterResponse,
)
async def get_hearth_cluster(cluster_name: str):
    if not settings.HEARTH_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Hearth integration is disabled",
        )

    try:
        service = get_hearth_service()
        cluster = service.get_cluster(cluster_name)
        if not cluster:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Hearth cluster '{cluster_name}' not found"
                ),
            )
        return cluster
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to get Hearth cluster:", exc)
        raise HTTPException(
            status_code=503,
            detail="Hearth is unavailable",
        ) from exc
