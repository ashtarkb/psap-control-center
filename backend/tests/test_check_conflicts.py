"""
Tests for the type-aware reservation conflict detection logic.

Covers all combinations:
- cluster vs cluster (always conflicts)
- cluster vs gpu (always conflicts)
- gpu vs cluster (always conflicts)
- gpu vs gpu (conflicts only when total exceeds capacity)
- no overlaps (no conflict)
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.reservation_service import ReservationService
from app.models.reservation import Reservation, ReservationStatus
from app.models.cluster import Cluster


def _make_reservation(
    reservation_type="cluster",
    gpu_count=None,
    start_offset_hours=0,
    duration_hours=2,
    status=ReservationStatus.ACTIVE,
) -> Reservation:
    now = datetime.utcnow()
    r = Reservation()
    r.id = "test-id"
    r.cluster_id = "cluster-1"
    r.title = "Existing reservation"
    r.user_name = "existing_user"
    r.reservation_type = reservation_type
    r.gpu_count = gpu_count
    r.start_time = now + timedelta(hours=start_offset_hours)
    r.end_time = now + timedelta(hours=start_offset_hours + duration_hours)
    r.status = status
    return r


def _make_cluster(gpu_count=8) -> Cluster:
    c = Cluster()
    c.id = "cluster-1"
    c.name = "test-cluster"
    c.gpu_count = str(gpu_count)
    c.kubeconfig_path = None
    return c


@pytest.fixture
def db():
    return AsyncMock(spec=AsyncSession)


@pytest.fixture
def service(db):
    return ReservationService(db)


class TestNoOverlaps:
    @pytest.mark.asyncio
    async def test_no_overlapping_reservations(self, service):
        service._get_overlapping_reservations = AsyncMock(return_value=[])
        # Should not raise
        await service.check_conflicts(
            cluster_id="cluster-1",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow() + timedelta(hours=2),
            reservation_type="cluster",
        )


class TestClusterVsCluster:
    @pytest.mark.asyncio
    async def test_cluster_conflicts_with_existing_cluster(self, service):
        existing = _make_reservation(reservation_type="cluster")
        service._get_overlapping_reservations = AsyncMock(return_value=[existing])

        with pytest.raises(ValueError, match="Full-cluster reservation conflicts"):
            await service.check_conflicts(
                cluster_id="cluster-1",
                start_time=datetime.utcnow(),
                end_time=datetime.utcnow() + timedelta(hours=2),
                reservation_type="cluster",
            )


class TestClusterVsGpu:
    @pytest.mark.asyncio
    async def test_cluster_conflicts_with_existing_gpu(self, service):
        existing = _make_reservation(reservation_type="gpu", gpu_count=2)
        service._get_overlapping_reservations = AsyncMock(return_value=[existing])

        with pytest.raises(ValueError, match="Full-cluster reservation conflicts"):
            await service.check_conflicts(
                cluster_id="cluster-1",
                start_time=datetime.utcnow(),
                end_time=datetime.utcnow() + timedelta(hours=2),
                reservation_type="cluster",
            )


class TestGpuVsCluster:
    @pytest.mark.asyncio
    async def test_gpu_conflicts_with_existing_cluster(self, service):
        existing = _make_reservation(reservation_type="cluster")
        service._get_overlapping_reservations = AsyncMock(return_value=[existing])

        with pytest.raises(ValueError, match="full-cluster reservation"):
            await service.check_conflicts(
                cluster_id="cluster-1",
                start_time=datetime.utcnow(),
                end_time=datetime.utcnow() + timedelta(hours=2),
                reservation_type="gpu",
                gpu_count=2,
            )


class TestGpuVsGpu:
    @pytest.mark.asyncio
    async def test_gpu_within_capacity_no_conflict(self, service):
        """2 existing + 2 new = 4, under 8 total — no conflict."""
        existing = _make_reservation(reservation_type="gpu", gpu_count=2)
        service._get_overlapping_reservations = AsyncMock(return_value=[existing])
        cluster = _make_cluster(gpu_count=8)

        await service.check_conflicts(
            cluster_id="cluster-1",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow() + timedelta(hours=2),
            reservation_type="gpu",
            gpu_count=2,
            cluster=cluster,
        )

    @pytest.mark.asyncio
    async def test_gpu_exceeds_capacity_conflict(self, service):
        """6 existing + 4 new = 10, over 8 total — conflict."""
        existing = _make_reservation(reservation_type="gpu", gpu_count=6)
        service._get_overlapping_reservations = AsyncMock(return_value=[existing])
        cluster = _make_cluster(gpu_count=8)

        with pytest.raises(ValueError, match="Not enough GPUs"):
            await service.check_conflicts(
                cluster_id="cluster-1",
                start_time=datetime.utcnow(),
                end_time=datetime.utcnow() + timedelta(hours=2),
                reservation_type="gpu",
                gpu_count=4,
                cluster=cluster,
            )

    @pytest.mark.asyncio
    async def test_gpu_exactly_at_capacity(self, service):
        """4 existing + 4 new = 8, exactly at 8 — no conflict."""
        existing = _make_reservation(reservation_type="gpu", gpu_count=4)
        service._get_overlapping_reservations = AsyncMock(return_value=[existing])
        cluster = _make_cluster(gpu_count=8)

        await service.check_conflicts(
            cluster_id="cluster-1",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow() + timedelta(hours=2),
            reservation_type="gpu",
            gpu_count=4,
            cluster=cluster,
        )

    @pytest.mark.asyncio
    async def test_multiple_gpu_reservations_summed(self, service):
        """Multiple existing GPU reservations sum correctly."""
        existing1 = _make_reservation(reservation_type="gpu", gpu_count=3)
        existing2 = _make_reservation(reservation_type="gpu", gpu_count=3)
        service._get_overlapping_reservations = AsyncMock(return_value=[existing1, existing2])
        cluster = _make_cluster(gpu_count=8)

        with pytest.raises(ValueError, match="Not enough GPUs"):
            await service.check_conflicts(
                cluster_id="cluster-1",
                start_time=datetime.utcnow(),
                end_time=datetime.utcnow() + timedelta(hours=2),
                reservation_type="gpu",
                gpu_count=3,
                cluster=cluster,
            )
