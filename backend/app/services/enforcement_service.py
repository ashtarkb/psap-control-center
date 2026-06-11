"""
Manages Kubernetes namespace lifecycle for GPU reservations.

On activation:  create namespace -> apply ResourceQuota -> optionally create DRA ResourceClaimTemplate
On completion/cancellation: delete namespace (which cascades all resources inside it)
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.reservation import Reservation, ReservationStatus
from app.models.cluster import Cluster
from app.services.kubernetes_service import KubernetesService
from app.utils.logger import create_logger

logger = create_logger("EnforcementService")

NAMESPACE_PREFIX = "psap-res"


def _namespace_for_reservation(reservation_id: str) -> str:
    short_id = reservation_id[:8]
    return f"{NAMESPACE_PREFIX}-{short_id}"


class ReservationEnforcementService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def provision_enforcement(self, reservation: Reservation) -> None:
        """Create enforcement resources for a GPU reservation that just became active."""
        if (reservation.reservation_type or "cluster") != "gpu":
            return
        if not getattr(reservation, "enforce_isolation", False):
            return
        if reservation.enforcement_status == "provisioned":
            return
        if not reservation.cluster_id:
            return

        cluster_result = await self.db.execute(
            select(Cluster).where(Cluster.id == reservation.cluster_id)
        )
        cluster = cluster_result.scalar_one_or_none()
        if not cluster or not cluster.kubeconfig_path:
            logger.warning(f"Cannot provision enforcement — cluster {reservation.cluster_id} not found or no kubeconfig")
            return

        k8s = KubernetesService(cluster.kubeconfig_path)
        ns_name = _namespace_for_reservation(reservation.id)

        try:
            labels = {
                "psap.openshift.io/managed-by": "control-center",
                "psap.openshift.io/reservation-id": reservation.id[:63],
                "psap.openshift.io/user": reservation.user_name[:63],
            }
            k8s.create_namespace(ns_name, labels=labels)

            gpu_count = reservation.gpu_count or 0
            if gpu_count > 0:
                gpu_config = k8s._load_gpu_config_from_configmap()
                gpu_resource = gpu_config.get("gpu_resource_name", "nvidia.com/gpu")
                k8s.create_resource_quota(ns_name, gpu_count, gpu_resource=gpu_resource)

                device_classes = k8s.discover_device_classes()
                if device_classes:
                    k8s.create_resource_claim_template(
                        namespace=ns_name,
                        gpu_count=gpu_count,
                        device_class=device_classes[0],
                    )

            reservation.enforcement_namespace = ns_name
            reservation.enforcement_status = "provisioned"
            await self.db.commit()
            logger.info(f"Provisioned enforcement for reservation {reservation.id}: namespace={ns_name}")

        except Exception as e:
            logger.error(f"Failed to provision enforcement for {reservation.id}: {e}")
            reservation.enforcement_status = "error"
            reservation.enforcement_namespace = ns_name
            await self.db.commit()

    async def cleanup_enforcement(self, reservation: Reservation) -> None:
        """Delete the enforcement namespace when a reservation completes or is cancelled."""
        if not reservation.enforcement_namespace:
            return
        if not reservation.cluster_id:
            logger.warning(
                f"Cluster unlinked for reservation {reservation.id} — "
                f"namespace {reservation.enforcement_namespace} may be orphaned"
            )
            reservation.enforcement_status = "orphaned"
            await self.db.commit()
            return

        cluster_result = await self.db.execute(
            select(Cluster).where(Cluster.id == reservation.cluster_id)
        )
        cluster = cluster_result.scalar_one_or_none()
        if not cluster or not cluster.kubeconfig_path:
            logger.warning(
                f"Cannot clean enforcement — cluster gone for reservation {reservation.id}; "
                f"namespace {reservation.enforcement_namespace} may be orphaned"
            )
            reservation.enforcement_status = "orphaned"
            await self.db.commit()
            return

        try:
            k8s = KubernetesService(cluster.kubeconfig_path)
            k8s.delete_namespace(reservation.enforcement_namespace)
            reservation.enforcement_status = "cleaned"
            await self.db.commit()
            logger.info(f"Cleaned enforcement for reservation {reservation.id}")
        except Exception as e:
            logger.error(f"Failed to clean enforcement for {reservation.id}: {e}")

    async def reconcile(self) -> dict:
        """
        Called by the background task.
        - Provision enforcement for active GPU reservations without it.
        - Cleanup enforcement for completed/cancelled reservations.
        """
        provisioned = 0
        cleaned = 0

        # Provision for active GPU reservations with isolation enabled that haven't been provisioned
        result = await self.db.execute(
            select(Reservation).where(
                and_(
                    Reservation.status == ReservationStatus.ACTIVE,
                    Reservation.reservation_type == "gpu",
                    Reservation.enforce_isolation == True,
                    Reservation.enforcement_status.is_(None),
                )
            )
        )
        for reservation in result.scalars():
            await self.provision_enforcement(reservation)
            provisioned += 1

        # Retry errored provisions
        result = await self.db.execute(
            select(Reservation).where(
                and_(
                    Reservation.status == ReservationStatus.ACTIVE,
                    Reservation.reservation_type == "gpu",
                    Reservation.enforce_isolation == True,
                    Reservation.enforcement_status == "error",
                )
            )
        )
        for reservation in result.scalars():
            reservation.enforcement_status = None
            await self.provision_enforcement(reservation)
            provisioned += 1

        # Cleanup for completed/cancelled reservations that still have enforcement
        result = await self.db.execute(
            select(Reservation).where(
                and_(
                    Reservation.status.in_([ReservationStatus.COMPLETED, ReservationStatus.CANCELLED]),
                    Reservation.enforcement_namespace.isnot(None),
                    Reservation.enforcement_status.notin_(["cleaned", "orphaned"]),
                )
            )
        )
        for reservation in result.scalars():
            await self.cleanup_enforcement(reservation)
            cleaned += 1

        return {"provisioned": provisioned, "cleaned": cleaned}

    async def cleanup_cluster_enforcement(self, cluster_id: str) -> int:
        """Clean up all enforcement namespaces for a cluster (called before cluster deletion)."""
        result = await self.db.execute(
            select(Reservation).where(
                and_(
                    Reservation.cluster_id == cluster_id,
                    Reservation.enforcement_namespace.isnot(None),
                    Reservation.enforcement_status.notin_(["cleaned", "orphaned"]),
                )
            )
        )
        cleaned = 0
        for reservation in result.scalars():
            await self.cleanup_enforcement(reservation)
            cleaned += 1
        return cleaned
