import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from app.models.reservation import Reservation, ReservationStatus
from app.models.cluster import Cluster
from app.schemas.reservation import (
    ReservationCreate,
    ReservationUpdate,
    CalendarEvent
)
from app.services.kubernetes_service import KubernetesService
from app.utils.logger import create_logger

logger = create_logger("ReservationService")


class ReservationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_reservation(
        self,
        reservation_data: ReservationCreate
    ) -> Reservation:
        cluster_result = await self.db.execute(
            select(Cluster)
            .where(Cluster.id == reservation_data.cluster_id)
        )
        cluster = cluster_result.scalar_one_or_none()
        if not cluster:
            raise ValueError("Cluster not found")

        cluster_color = getattr(cluster, 'color', '#0891b2')

        start = reservation_data.start_time.replace(tzinfo=None)
        end = reservation_data.end_time.replace(tzinfo=None)

        reservation = Reservation(
            cluster_id=reservation_data.cluster_id,
            cluster_name=cluster.name,
            title=reservation_data.title,
            description=reservation_data.description,
            user_name=reservation_data.user_name,
            user_email=reservation_data.user_email,
            team=reservation_data.team,
            start_time=start,
            end_time=end,
            reservation_type=reservation_data.reservation_type,
            gpu_count=reservation_data.gpu_count,
            enforce_isolation=reservation_data.enforce_isolation,
            priority=reservation_data.priority,
            purpose=reservation_data.purpose,
            notes=reservation_data.notes,
            color=cluster_color,
            status=ReservationStatus.PENDING.value,
        )

        self.db.add(reservation)
        await self.db.commit()
        await self.db.refresh(reservation)

        return reservation

    async def approve_reservation(
        self, reservation_id: str, approved_by: str
    ) -> Optional[Reservation]:
        reservation = await self.get_reservation(reservation_id)
        if not reservation:
            return None
        if reservation.status != ReservationStatus.PENDING.value:
            raise ValueError(
                f"Only pending reservations can be approved "
                f"(current status: {reservation.status})"
            )

        cluster = None
        if reservation.cluster_id:
            cluster_result = await self.db.execute(
                select(Cluster)
                .where(Cluster.id == reservation.cluster_id)
                .with_for_update()
            )
            cluster = cluster_result.scalar_one_or_none()

        await self.check_conflicts(
            cluster_id=reservation.cluster_id,
            start_time=reservation.start_time,
            end_time=reservation.end_time,
            reservation_type=reservation.reservation_type or "cluster",
            gpu_count=reservation.gpu_count,
            cluster=cluster,
            exclude_id=reservation_id,
        )

        now = datetime.now(timezone.utc)
        start = reservation.start_time
        end = reservation.end_time
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        starts_immediately = start <= now and end > now

        reservation.status = (
            ReservationStatus.ACTIVE.value if starts_immediately
            else ReservationStatus.SCHEDULED.value
        )
        reservation.updated_at = datetime.utcnow()

        approve_time = now.strftime("%b %d, %Y at %I:%M %p")
        note = f"[Approved by {approved_by} on {approve_time}]"
        reservation.notes = (
            (reservation.notes + "\n" if reservation.notes else "") + note
        )

        await self.db.commit()
        await self.db.refresh(reservation)

        if (
            starts_immediately
            and reservation.reservation_type == "gpu"
            and reservation.enforce_isolation
        ):
            try:
                from app.services.enforcement_service import (
                    ReservationEnforcementService,
                )
                enforcement = ReservationEnforcementService(self.db)
                await enforcement.provision_enforcement(reservation)
            except Exception as e:
                logger.warning(
                    f"Inline enforcement provision failed: {e}"
                )

        return reservation

    async def deny_reservation(
        self,
        reservation_id: str,
        denied_by: str,
        reason: Optional[str] = None,
    ) -> Optional[Reservation]:
        reservation = await self.get_reservation(reservation_id)
        if not reservation:
            return None
        if reservation.status != ReservationStatus.PENDING.value:
            raise ValueError(
                f"Only pending reservations can be denied "
                f"(current status: {reservation.status})"
            )

        reservation.status = ReservationStatus.DENIED.value
        reservation.updated_at = datetime.now(timezone.utc)

        deny_time = datetime.now(timezone.utc).strftime(
            "%b %d, %Y at %I:%M %p"
        )
        note = f"[Denied by {denied_by} on {deny_time}]"
        if reason:
            note += f" Reason: {reason}"
        reservation.notes = (
            (reservation.notes + "\n" if reservation.notes else "") + note
        )

        await self.db.commit()
        await self.db.refresh(reservation)
        return reservation

    async def get_reservation(self, reservation_id: str) -> Optional[Reservation]:
        result = await self.db.execute(
            select(Reservation)
            .options(selectinload(Reservation.cluster))
            .where(Reservation.id == reservation_id)
        )
        return result.scalar_one_or_none()

    async def get_reservations(
        self,
        skip: int = 0,
        limit: int = 100,
        cluster_id: Optional[str] = None,
        user_name: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        status: Optional[ReservationStatus] = None
    ) -> tuple[List[Reservation], int]:
        query = select(Reservation).options(selectinload(Reservation.cluster))

        conditions = []
        if cluster_id:
            conditions.append(Reservation.cluster_id == cluster_id)
        if user_name:
            conditions.append(Reservation.user_name == user_name)
        if start_date:
            conditions.append(Reservation.end_time >= start_date)
        if end_date:
            conditions.append(Reservation.start_time <= end_date)
        if status:
            conditions.append(Reservation.status == status)

        if conditions:
            query = query.where(and_(*conditions))

        query = query.order_by(Reservation.start_time).offset(skip).limit(limit)

        result = await self.db.execute(query)
        reservations = result.scalars().all()

        count_query = select(Reservation)
        if conditions:
            count_query = count_query.where(and_(*conditions))
        count_result = await self.db.execute(count_query)
        total = len(count_result.scalars().all())

        return list(reservations), total

    async def update_reservation(
        self,
        reservation_id: str,
        reservation_data: ReservationUpdate
    ) -> Optional[Reservation]:
        reservation = await self.get_reservation(reservation_id)
        if not reservation:
            return None

        update_data = reservation_data.model_dump(exclude_unset=True)

        # Strip timezone info to match TIMESTAMP WITHOUT TIME ZONE columns
        if 'start_time' in update_data and update_data['start_time'] is not None:
            update_data['start_time'] = update_data['start_time'].replace(tzinfo=None)
        if 'end_time' in update_data and update_data['end_time'] is not None:
            update_data['end_time'] = update_data['end_time'].replace(tzinfo=None)

        is_approved = reservation.status in (
            ReservationStatus.SCHEDULED.value,
            ReservationStatus.ACTIVE.value,
        )
        needs_conflict_check = is_approved and any(
            k in update_data
            for k in ('start_time', 'end_time', 'reservation_type', 'gpu_count')
        )
        if needs_conflict_check:
            new_start = update_data.get('start_time', reservation.start_time)
            new_end = update_data.get('end_time', reservation.end_time)
            new_type = update_data.get('reservation_type', reservation.reservation_type)
            new_gpu = update_data.get('gpu_count', reservation.gpu_count)

            cluster = None
            if reservation.cluster_id:
                cluster_result = await self.db.execute(
                    select(Cluster).where(Cluster.id == reservation.cluster_id)
                )
                cluster = cluster_result.scalar_one_or_none()

            await self.check_conflicts(
                cluster_id=reservation.cluster_id,
                start_time=new_start,
                end_time=new_end,
                reservation_type=new_type,
                gpu_count=new_gpu,
                cluster=cluster,
                exclude_id=reservation_id,
            )

        old_type = reservation.reservation_type
        for key, value in update_data.items():
            setattr(reservation, key, value)

        if (
            old_type == "gpu"
            and reservation.reservation_type == "cluster"
            and reservation.enforcement_namespace
            and reservation.enforcement_status not in ("cleaned", "orphaned")
        ):
            try:
                from app.services.enforcement_service import (
                    ReservationEnforcementService,
                )
                enforcement = ReservationEnforcementService(self.db)
                await enforcement.cleanup_enforcement(reservation)
            except Exception as e:
                logger.warning(f"Enforcement cleanup on type change failed: {e}")

        reservation.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(reservation)

        return reservation

    async def delete_reservation(self, reservation_id: str) -> bool:
        reservation = await self.get_reservation(reservation_id)
        if not reservation:
            return False

        if reservation.enforcement_namespace and reservation.enforcement_status != "cleaned":
            try:
                from app.services.enforcement_service import ReservationEnforcementService
                enforcement = ReservationEnforcementService(self.db)
                await enforcement.cleanup_enforcement(reservation)
            except Exception as e:
                logger.warning(f"Enforcement cleanup on delete failed: {e}")

        await self.db.delete(reservation)
        await self.db.commit()

        return True

    async def cancel_reservation(self, reservation_id: str, cancelled_by: Optional[str] = None) -> Optional[Reservation]:
        reservation = await self.get_reservation(reservation_id)
        if not reservation:
            return None

        if reservation.enforcement_namespace and reservation.enforcement_status != "cleaned":
            try:
                from app.services.enforcement_service import (
                    ReservationEnforcementService,
                )
                enforcement = ReservationEnforcementService(self.db)
                await enforcement.cleanup_enforcement(reservation)
            except Exception as e:
                logger.warning(f"Enforcement cleanup on cancel failed: {e}")

        reservation.status = ReservationStatus.CANCELLED
        reservation.updated_at = datetime.now(timezone.utc)

        cancel_time = datetime.now(timezone.utc).strftime("%b %d, %Y at %I:%M %p")
        cancel_note = f"[Manually cancelled on {cancel_time}]"
        if cancelled_by:
            cancel_note = f"[Cancelled by {cancelled_by} on {cancel_time}]"
        reservation.notes = (reservation.notes + "\n" if reservation.notes else "") + cancel_note

        await self.db.commit()
        await self.db.refresh(reservation)

        return reservation

    async def _get_overlapping_reservations(
        self,
        cluster_id: str,
        start_time: datetime,
        end_time: datetime,
        exclude_id: Optional[str] = None,
    ) -> List[Reservation]:
        """Get all active/scheduled reservations that overlap the given time window."""
        query = select(Reservation).where(
            and_(
                Reservation.cluster_id == cluster_id,
                Reservation.status.in_([ReservationStatus.SCHEDULED.value, ReservationStatus.ACTIVE.value]),
                Reservation.start_time < end_time,
                Reservation.end_time > start_time,
            )
        )
        if exclude_id:
            query = query.where(Reservation.id != exclude_id)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def check_conflicts(
        self,
        cluster_id: str,
        start_time: datetime,
        end_time: datetime,
        reservation_type: str = "cluster",
        gpu_count: Optional[int] = None,
        cluster: Optional[Cluster] = None,
        exclude_id: Optional[str] = None,
    ) -> None:
        """
        Type-aware conflict detection.

        Rules:
        - A full-cluster reservation conflicts with ANY overlapping reservation.
        - GPU reservations can coexist if total requested GPUs don't exceed capacity.
        - A GPU reservation conflicts with any overlapping full-cluster reservation.

        Raises ValueError on conflict.
        """
        overlaps = await self._get_overlapping_reservations(
            cluster_id, start_time, end_time, exclude_id
        )

        if not overlaps:
            return

        if reservation_type == "cluster":
            c = overlaps[0]
            conflict_start = c.start_time.strftime("%b %d, %Y %I:%M %p")
            conflict_end = c.end_time.strftime("%b %d, %Y %I:%M %p")
            raise ValueError(
                f"Full-cluster reservation conflicts with '{c.title}' by {c.user_name} "
                f"({conflict_start} to {conflict_end})"
            )

        # GPU reservation — check for full-cluster conflicts first
        for c in overlaps:
            if (c.reservation_type or "cluster") == "cluster":
                conflict_start = c.start_time.strftime("%b %d, %Y %I:%M %p")
                conflict_end = c.end_time.strftime("%b %d, %Y %I:%M %p")
                raise ValueError(
                    f"Conflicts with full-cluster reservation '{c.title}' by {c.user_name} "
                    f"({conflict_start} to {conflict_end})"
                )

        # Sum GPU counts of overlapping GPU reservations + the new request
        total_gpu_demand = sum(
            (r.gpu_count or 0) for r in overlaps
            if (r.reservation_type or "cluster") == "gpu"
        ) + (gpu_count or 0)

        # Get cluster GPU capacity — try live count, fall back to stored
        total_gpus = 0
        if cluster and cluster.kubeconfig_path:
            try:
                k8s = KubernetesService(cluster.kubeconfig_path)
                alloc = k8s.get_gpu_allocation()
                total_gpus = alloc.total_gpus
            except Exception as e:
                logger.warning(f"Live GPU probe failed, using stored count: {e}")
                total_gpus = int(cluster.gpu_count or 0)
        elif cluster:
            total_gpus = int(cluster.gpu_count or 0)

        if reservation_type == "gpu":
            if total_gpus == 0:
                raise ValueError(
                    "GPU capacity is unknown or zero for this cluster. "
                    "Ensure the cluster has a valid kubeconfig and GPU nodes."
                )
            if total_gpu_demand > total_gpus:
                raise ValueError(
                    f"Not enough GPUs: requesting {gpu_count}, "
                    f"{total_gpu_demand - (gpu_count or 0)} already reserved, "
                    f"cluster has {total_gpus} total"
                )

    async def get_calendar_events(
        self,
        start_date: datetime,
        end_date: datetime,
        cluster_id: Optional[str] = None
    ) -> List[CalendarEvent]:
        query = select(Reservation).options(
            selectinload(Reservation.cluster)
        ).where(
            and_(
                Reservation.start_time <= end_date,
                Reservation.end_time >= start_date,
                Reservation.status.in_([
                    ReservationStatus.SCHEDULED.value,
                    ReservationStatus.ACTIVE.value
                ])
            )
        )

        if cluster_id:
            query = query.where(Reservation.cluster_id == cluster_id)

        query = query.order_by(Reservation.start_time)

        result = await self.db.execute(query)
        reservations = result.scalars().all()

        events = []
        for r in reservations:
            cluster_name = r.cluster_name or (r.cluster.name if r.cluster else "[Cluster Removed]")
            gpu_label = ""
            if (r.reservation_type or "cluster") == "gpu" and r.gpu_count:
                gpu_label = f" [{r.gpu_count} GPU]"

            events.append(CalendarEvent(
                id=r.id,
                title=r.title + gpu_label,
                start=r.start_time,
                end=r.end_time,
                cluster_id=r.cluster_id,
                cluster_name=cluster_name,
                user_name=r.user_name,
                team=r.team,
                status=r.status,
                color=r.color,
                description=r.description,
                reservation_type=r.reservation_type or "cluster",
                gpu_count=r.gpu_count,
                priority=r.priority or "normal",
            ))

        return events

    async def get_current_reservations(self, cluster_id: str) -> List[Reservation]:
        """Get all currently active reservations for a cluster (supports multi-occupant GPU reservations)."""
        now = datetime.utcnow()
        result = await self.db.execute(
            select(Reservation).where(
                and_(
                    Reservation.cluster_id == cluster_id,
                    Reservation.start_time <= now,
                    Reservation.end_time > now,
                    Reservation.status.in_([
                        ReservationStatus.SCHEDULED.value,
                        ReservationStatus.ACTIVE.value
                    ])
                )
            ).order_by(Reservation.start_time)
        )
        return list(result.scalars().all())

    async def request_modification(
        self,
        reservation_id: str,
        changes: Dict[str, Any],
        requested_by: str,
    ) -> Optional[Reservation]:
        reservation = await self.get_reservation(reservation_id)
        if not reservation:
            return None
        if reservation.status not in (
            ReservationStatus.SCHEDULED.value,
            ReservationStatus.ACTIVE.value,
        ):
            raise ValueError(
                f"Only scheduled or active reservations can be modified "
                f"(current status: {reservation.status})"
            )
        if reservation.pending_modification:
            raise ValueError("A modification request is already pending for this reservation")

        # Serialize datetimes for JSON storage
        serializable = {}
        for k, v in changes.items():
            if isinstance(v, datetime):
                serializable[k] = v.replace(tzinfo=None).isoformat()
            else:
                serializable[k] = v

        reservation.pending_modification = json.dumps(serializable)
        reservation.modification_requested_by = requested_by
        reservation.modification_requested_at = datetime.utcnow()
        reservation.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(reservation)
        return reservation

    async def approve_modification(
        self, reservation_id: str, approved_by: str
    ) -> Optional[Reservation]:
        reservation = await self.get_reservation(reservation_id)
        if not reservation:
            return None
        if not reservation.pending_modification:
            raise ValueError("No pending modification to approve")

        changes = json.loads(reservation.pending_modification)

        # Convert datetime strings back
        for key in ("start_time", "end_time"):
            if key in changes and isinstance(changes[key], str):
                changes[key] = datetime.fromisoformat(changes[key])

        # Run conflict check with the new values if time/type changed
        needs_conflict_check = any(
            k in changes for k in ("start_time", "end_time", "reservation_type", "gpu_count")
        )
        if needs_conflict_check and reservation.status in (
            ReservationStatus.SCHEDULED.value,
            ReservationStatus.ACTIVE.value,
        ):
            new_start = changes.get("start_time", reservation.start_time)
            new_end = changes.get("end_time", reservation.end_time)
            new_type = changes.get("reservation_type", reservation.reservation_type)
            new_gpu = changes.get("gpu_count", reservation.gpu_count)

            cluster = None
            if reservation.cluster_id:
                r = await self.db.execute(
                    select(Cluster).where(Cluster.id == reservation.cluster_id)
                )
                cluster = r.scalar_one_or_none()

            await self.check_conflicts(
                cluster_id=reservation.cluster_id,
                start_time=new_start,
                end_time=new_end,
                reservation_type=new_type,
                gpu_count=new_gpu,
                cluster=cluster,
                exclude_id=reservation_id,
            )

        for key, value in changes.items():
            setattr(reservation, key, value)

        reservation.pending_modification = None
        reservation.modification_requested_by = None
        reservation.modification_requested_at = None
        reservation.updated_at = datetime.utcnow()

        note = f"[Modification approved by {approved_by} on {datetime.now(timezone.utc).strftime('%b %d, %Y at %I:%M %p')}]"
        reservation.notes = (
            (reservation.notes + "\n" if reservation.notes else "") + note
        )

        await self.db.commit()
        await self.db.refresh(reservation)
        return reservation

    async def deny_modification(
        self,
        reservation_id: str,
        denied_by: str,
        reason: Optional[str] = None,
    ) -> Optional[Reservation]:
        reservation = await self.get_reservation(reservation_id)
        if not reservation:
            return None
        if not reservation.pending_modification:
            raise ValueError("No pending modification to deny")

        reservation.pending_modification = None
        reservation.modification_requested_by = None
        reservation.modification_requested_at = None
        reservation.updated_at = datetime.utcnow()

        note = f"[Modification denied by {denied_by} on {datetime.now(timezone.utc).strftime('%b %d, %Y at %I:%M %p')}]"
        if reason:
            note += f" Reason: {reason}"
        reservation.notes = (
            (reservation.notes + "\n" if reservation.notes else "") + note
        )

        await self.db.commit()
        await self.db.refresh(reservation)
        return reservation

    async def update_reservation_statuses(self) -> dict:
        """Update reservation statuses based on current time."""
        now = datetime.utcnow()
        activated = 0
        completed = 0

        scheduled_to_active = await self.db.execute(
            select(Reservation).where(
                and_(
                    Reservation.status == ReservationStatus.SCHEDULED.value,
                    Reservation.start_time <= now,
                    Reservation.end_time > now
                )
            )
        )
        for reservation in scheduled_to_active.scalars():
            reservation.status = ReservationStatus.ACTIVE.value
            reservation.updated_at = now
            activated += 1

        active_to_complete = await self.db.execute(
            select(Reservation).where(
                and_(
                    Reservation.status.in_([
                        ReservationStatus.SCHEDULED.value,
                        ReservationStatus.ACTIVE.value
                    ]),
                    Reservation.end_time <= now
                )
            )
        )
        for reservation in active_to_complete.scalars():
            reservation.status = ReservationStatus.COMPLETED.value
            reservation.updated_at = now
            completed += 1

        if activated > 0 or completed > 0:
            await self.db.commit()
            logger.info(f"Updated reservation statuses: {activated} activated, {completed} completed")

        return {"activated": activated, "completed": completed}
