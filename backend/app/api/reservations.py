from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime

from app.core.database import get_db
from app.core.auth import require_auth
from app.services.reservation_service import ReservationService
from app.models.reservation import ReservationStatus
from app.schemas.reservation import (
    ReservationCreate,
    ReservationUpdate,
    ReservationResponse,
    ReservationListResponse,
    CalendarEvent,
    ClusterOccupancyResponse,
)
from app.utils.logger import create_logger

router = APIRouter()
logger = create_logger("ReservationsAPI")


def _to_response(r, cluster_name_override: Optional[str] = None) -> ReservationResponse:
    """Build a ReservationResponse from an ORM Reservation instance."""
    cluster_name = cluster_name_override or r.cluster_name or (
        r.cluster.name if r.cluster else None
    )
    return ReservationResponse(
        id=r.id,
        title=r.title,
        description=r.description,
        cluster_id=r.cluster_id,
        cluster_name=cluster_name,
        user_name=r.user_name,
        user_email=r.user_email,
        team=r.team,
        start_time=r.start_time,
        end_time=r.end_time,
        reservation_type=r.reservation_type or "cluster",
        gpu_count=r.gpu_count,
        enforcement_namespace=r.enforcement_namespace,
        enforcement_status=r.enforcement_status,
        purpose=r.purpose,
        notes=r.notes,
        color=r.color,
        status=r.status,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


@router.get("", response_model=ReservationListResponse)
async def list_reservations(
    skip: int = 0,
    limit: int = 100,
    cluster_id: Optional[str] = None,
    user_name: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    service = ReservationService(db)

    status_enum = None
    if status:
        try:
            status_enum = ReservationStatus(status)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}") from e

    reservations, total = await service.get_reservations(
        skip=skip,
        limit=limit,
        cluster_id=cluster_id,
        user_name=user_name,
        start_date=start_date,
        end_date=end_date,
        status=status_enum
    )

    return ReservationListResponse(
        reservations=[_to_response(r) for r in reservations],
        total=total,
    )


@router.post("", response_model=ReservationResponse, status_code=201)
async def create_reservation(
    reservation_data: ReservationCreate,
    _user: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    service = ReservationService(db)

    try:
        reservation = await service.create_reservation(reservation_data)
        return _to_response(reservation)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/calendar", response_model=List[CalendarEvent])
async def get_calendar_events(
    start_date: datetime,
    end_date: datetime,
    cluster_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    service = ReservationService(db)
    events = await service.get_calendar_events(start_date, end_date, cluster_id)
    return events


@router.get("/cluster/{cluster_id}/current", response_model=ClusterOccupancyResponse)
async def get_current_cluster_reservations(
    cluster_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all current reservations for a cluster (supports multi-occupant GPU reservations)."""
    service = ReservationService(db)
    reservations = await service.get_current_reservations(cluster_id)

    if not reservations:
        return {"occupied": False, "reservations": [], "gpu_summary": None}

    total_reserved_gpus = sum(
        (r.gpu_count or 0) for r in reservations
        if (r.reservation_type or "cluster") == "gpu"
    )
    has_cluster_reservation = any(
        (r.reservation_type or "cluster") == "cluster" for r in reservations
    )

    return {
        "occupied": True,
        "reservations": [
            {
                "user_name": r.user_name,
                "team": r.team,
                "title": r.title,
                "start_time": r.start_time,
                "end_time": r.end_time,
                "reservation_type": r.reservation_type or "cluster",
                "gpu_count": r.gpu_count,
                "enforcement_namespace": r.enforcement_namespace,
                "enforcement_status": r.enforcement_status,
            }
            for r in reservations
        ],
        "gpu_summary": {
            "total_reserved_gpus": total_reserved_gpus,
            "has_cluster_reservation": has_cluster_reservation,
            "reservation_count": len(reservations),
        },
    }


@router.get("/{reservation_id}", response_model=ReservationResponse)
async def get_reservation(
    reservation_id: str,
    db: AsyncSession = Depends(get_db)
):
    service = ReservationService(db)
    reservation = await service.get_reservation(reservation_id)

    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    return _to_response(reservation)


@router.put("/{reservation_id}", response_model=ReservationResponse)
async def update_reservation(
    reservation_id: str,
    reservation_data: ReservationUpdate,
    _user: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    service = ReservationService(db)

    try:
        reservation = await service.update_reservation(reservation_id, reservation_data)
        if not reservation:
            raise HTTPException(status_code=404, detail="Reservation not found")

        return _to_response(reservation)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{reservation_id}", status_code=204)
async def delete_reservation(
    reservation_id: str,
    _user: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    service = ReservationService(db)
    deleted = await service.delete_reservation(reservation_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="Reservation not found")


@router.post("/{reservation_id}/cancel", response_model=ReservationResponse)
async def cancel_reservation(
    reservation_id: str,
    _user: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    service = ReservationService(db)
    reservation = await service.cancel_reservation(reservation_id, cancelled_by=_user)

    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    return _to_response(reservation)
