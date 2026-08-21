import asyncio
import time
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime
import os

from app.models.cluster import Cluster, CLUSTER_COLORS
from app.models.cluster_cost import ClusterCost
from app.models.node_history import NodeHistory
from app.schemas.cluster import ClusterCreate, ClusterUpdate, ClusterStatus
from app.services.kubernetes_service import KubernetesService
from app.services import billing_csv_service
from app.core.config import settings
from app.utils.logger import create_logger

logger = create_logger("ClusterService")


def get_next_color(existing_count: int) -> str:
    """Get the next color from the palette based on existing cluster count."""
    return CLUSTER_COLORS[existing_count % len(CLUSTER_COLORS)]


class ClusterService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_cluster(self, cluster_data: ClusterCreate) -> Cluster:
        kubeconfig_path = None
        api_server_url = None
        
        if cluster_data.kubeconfig_content:
            # Method 1: Kubeconfig file provided
            parsed = KubernetesService.parse_kubeconfig(cluster_data.kubeconfig_content)
            if not parsed.get("valid"):
                raise ValueError(f"Invalid kubeconfig: {parsed.get('error')}")
            
            kubeconfig_path = KubernetesService.save_kubeconfig(
                cluster_data.kubeconfig_content,
                settings.KUBECONFIG_STORAGE_PATH,
                cluster_data.name
            )
            api_server_url = parsed.get("api_server")
        
        elif cluster_data.api_server_url and cluster_data.username and cluster_data.password:
            # Method 2: Login with credentials (kubeadmin)
            login_result = await KubernetesService.login_with_credentials(
                api_server=cluster_data.api_server_url,
                username=cluster_data.username,
                password=cluster_data.password,
                storage_path=settings.KUBECONFIG_STORAGE_PATH,
                cluster_name=cluster_data.name
            )
            
            if not login_result.get("success"):
                raise ValueError(f"Login failed: {login_result.get('error')}")
            
            kubeconfig_path = login_result.get("kubeconfig_path")
            api_server_url = login_result.get("api_server")
        
        # Auto-assign color based on existing cluster count
        count_result = await self.db.execute(select(Cluster))
        existing_count = len(count_result.scalars().all())
        cluster_color = get_next_color(existing_count)
        
        cluster = Cluster(
            name=cluster_data.name,
            description=cluster_data.description,
            kubeconfig_path=kubeconfig_path or "",
            api_server_url=api_server_url,
            tags=cluster_data.tags,
            color=cluster_color,
            status="pending"
        )
        
        self.db.add(cluster)
        await self.db.commit()
        await self.db.refresh(cluster)
        
        if kubeconfig_path:
            await self.refresh_cluster_status(cluster.id)
            await self.db.refresh(cluster)
            if cluster.infra_id:
                await self.refresh_cluster_cost(cluster.id)

        return cluster

    async def get_cluster(self, cluster_id: str) -> Optional[Cluster]:
        result = await self.db.execute(
            select(Cluster).where(Cluster.id == cluster_id)
        )
        return result.scalar_one_or_none()

    async def get_cluster_by_name(self, name: str) -> Optional[Cluster]:
        result = await self.db.execute(
            select(Cluster).where(Cluster.name == name)
        )
        return result.scalar_one_or_none()

    async def get_clusters(
        self,
        skip: int = 0,
        limit: int = 100,
        active_only: bool = False
    ) -> tuple[List[Cluster], int]:
        query = select(Cluster)
        
        if active_only:
            query = query.where(Cluster.is_active == True)
        
        query = query.order_by(Cluster.name).offset(skip).limit(limit)
        
        result = await self.db.execute(query)
        clusters = result.scalars().all()
        
        count_query = select(Cluster)
        if active_only:
            count_query = count_query.where(Cluster.is_active == True)
        count_result = await self.db.execute(count_query)
        total = len(count_result.scalars().all())
        
        return list(clusters), total

    async def update_cluster(
        self,
        cluster_id: str,
        cluster_data: ClusterUpdate
    ) -> Optional[Cluster]:
        cluster = await self.get_cluster(cluster_id)
        if not cluster:
            return None
        
        update_data = cluster_data.model_dump(exclude_unset=True)
        
        for key, value in update_data.items():
            setattr(cluster, key, value)
        
        cluster.updated_at = datetime.utcnow()
        
        await self.db.commit()
        await self.db.refresh(cluster)
        
        return cluster

    async def delete_cluster(self, cluster_id: str) -> bool:
        from app.models.reservation import Reservation, ReservationStatus
        from app.services.enforcement_service import ReservationEnforcementService

        cluster = await self.get_cluster(cluster_id)
        if not cluster:
            return False

        kubeconfig_path = cluster.kubeconfig_path

        # Clean up enforcement namespaces before losing the cluster
        try:
            enforcement = ReservationEnforcementService(self.db)
            cleaned = await enforcement.cleanup_cluster_enforcement(cluster_id)
            if cleaned:
                logger.info(
                    f"Cleaned {cleaned} enforcement namespaces "
                    f"for cluster {cluster.name}"
                )
        except Exception as e:
            logger.error(
                f"Enforcement cleanup failed during "
                f"cluster deletion: {e}"
            )
            await self.db.rollback()
            raise RuntimeError(
                "Failed to clean enforcement namespaces; "
                "aborting cluster deletion"
            ) from e

        result = await self.db.execute(
            select(Reservation).where(Reservation.cluster_id == cluster_id)
        )
        reservations = result.scalars().all()

        for reservation in reservations:
            reservation.cluster_name = cluster.name
            reservation.cluster_id = None

            if reservation.status in [ReservationStatus.SCHEDULED, ReservationStatus.ACTIVE]:
                reservation.status = ReservationStatus.CANCELLED
                reservation.notes = (reservation.notes or "") + f"\n[Auto-cancelled: Cluster '{cluster.name}' was removed from Control Center]"

        await self.db.delete(cluster)
        await self.db.commit()

        if kubeconfig_path and os.path.exists(kubeconfig_path):
            try:
                os.remove(kubeconfig_path)
                logger.info(f"Deleted kubeconfig file: {kubeconfig_path}")
            except OSError as e:
                logger.warning(f"Failed to delete kubeconfig file: {kubeconfig_path}: {e}")

        return True

    async def _run_in_thread(self, fn, executor=None):
        """Run a sync function in the given executor (or the default pool)."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(executor, fn)

    async def refresh_cluster_status(self, cluster_id: str, executor=None, on_progress=None) -> Optional[ClusterStatus]:
        cluster = await self.get_cluster(cluster_id)
        if not cluster or not cluster.kubeconfig_path:
            return None

        refresh_start = time.monotonic()

        try:
            k8s_service = KubernetesService(cluster.kubeconfig_path)

            timings = {}

            async def _track(name, coro):
                """Await a K8s call; record timing and signal progress on success."""
                t0 = time.monotonic()
                try:
                    result = await coro
                    timings[name] = ("ok", time.monotonic() - t0)
                    if on_progress:
                        on_progress()
                    return result
                except Exception as e:
                    timings[name] = ("FAIL", time.monotonic() - t0)
                    raise

            tasks = {
                "info": _track("info", self._run_in_thread(k8s_service.get_cluster_info, executor)),
                "gpu": _track("gpu", self._run_in_thread(k8s_service.get_gpu_allocation, executor)),
                "ns": _track("ns", self._run_in_thread(k8s_service.get_namespaces, executor)),
                "usage": _track("usage", self._run_in_thread(k8s_service.get_resource_usage, executor)),
            }
            if not cluster.infra_id:
                tasks["infra"] = _track("infra", self._run_in_thread(k8s_service.get_infra_id, executor))

            results = await asyncio.gather(
                *tasks.values(), return_exceptions=True
            )

            wall = time.monotonic() - refresh_start
            parts = " | ".join(
                f"{k}={v:.1f}s({s})" for k, (s, v) in sorted(timings.items())
            )
            logger.info(f"Refresh [{cluster.name}] wall={wall:.1f}s  {parts}")
            by_name = dict(zip(tasks.keys(), results))

            cluster_info = by_name["info"] if not isinstance(by_name["info"], Exception) else {}
            if isinstance(by_name["info"], Exception):
                logger.warning(f"get_cluster_info failed: {by_name['info']}")

            cluster.status = cluster_info.get("status", "unknown")
            cluster.node_count = cluster_info.get("node_count")
            cluster.cluster_version = cluster_info.get("cluster_version")
            cluster.api_server_url = cluster_info.get("api_server") or cluster.api_server_url
            cluster.last_health_check = datetime.utcnow()

            gpu_alloc = by_name["gpu"]
            if isinstance(gpu_alloc, Exception):
                logger.warning(f"GPU allocation probe failed: {gpu_alloc}")
                cluster.gpu_count = cluster_info.get("gpu_count")
                cluster.gpu_type = cluster_info.get("gpu_type")
            else:
                cluster.gpu_allocation_mode = gpu_alloc.gpu_allocation_mode
                cluster.gpu_count = str(gpu_alloc.total_gpus)
                cluster.gpu_type = (
                    gpu_alloc.gpu_types[0].product
                    if gpu_alloc.gpu_types else None
                )

            if "infra" in by_name:
                infra_id = by_name["infra"]
                if isinstance(infra_id, Exception):
                    logger.debug(f"Could not detect infra_id for {cluster.name}: {infra_id}")
                elif infra_id:
                    cluster.infra_id = infra_id
                    logger.info(f"Auto-detected infra_id for {cluster.name}: {infra_id}")

            await self.db.commit()
            await self.db.refresh(cluster)

            await self._upsert_node_history(
                cluster_id, cluster_info.get("nodes", [])
            )

            try:
                from app.services import cost_snapshot_service
                await cost_snapshot_service.update_current_day(
                    cluster_id, self.db
                )
            except Exception as e:
                logger.warning(f"Snapshot update failed: {e}")

            namespaces = by_name["ns"] if not isinstance(by_name["ns"], Exception) else []
            resource_usage = by_name["usage"] if not isinstance(by_name["usage"], Exception) else {}

            return ClusterStatus(
                status=cluster.status,
                api_server_url=cluster.api_server_url,
                node_count=cluster.node_count,
                gpu_count=cluster.gpu_count,
                gpu_type=cluster.gpu_type,
                gpu_allocation_mode=cluster.gpu_allocation_mode,
                cluster_version=cluster.cluster_version,
                last_health_check=cluster.last_health_check,
                nodes=cluster_info.get("nodes"),
                namespaces=namespaces,
                resource_usage=resource_usage
            )
        except Exception as e:
            logger.error("Error refreshing cluster status:", e)
            cluster.status = "error"
            cluster.last_health_check = datetime.utcnow()
            await self.db.commit()

            return ClusterStatus(
                status="error",
                last_health_check=cluster.last_health_check
            )

    async def _upsert_node_history(
        self, cluster_id: str, nodes: list
    ) -> None:
        """Track node uptime: create on first sight, update last_seen on every refresh."""
        if not nodes:
            return
        now = datetime.utcnow()
        result = await self.db.execute(
            select(NodeHistory).where(NodeHistory.cluster_id == cluster_id)
        )
        existing = {nh.node_name: nh for nh in result.scalars().all()}

        for node in nodes:
            name = node.get("name", "")
            if not name:
                continue
            instance_type = node.get("instance_type", "unknown")
            region = node.get("region", "unknown")
            gpu_count = node.get("gpu", 0)
            try:
                gpu_count = int(gpu_count)
            except (TypeError, ValueError):
                gpu_count = 0

            if name in existing:
                nh = existing[name]
                nh.last_seen = now
                nh.instance_type = instance_type
                nh.region = region
                nh.is_gpu_node = gpu_count > 0
            else:
                nh = NodeHistory(
                    cluster_id=cluster_id,
                    node_name=name,
                    instance_type=instance_type,
                    region=region,
                    is_gpu_node=gpu_count > 0,
                    first_seen=now,
                    last_seen=now,
                )
                self.db.add(nh)

        try:
            await self.db.commit()
        except Exception as e:
            logger.warning(f"NodeHistory upsert failed: {e}")
            await self.db.rollback()

    async def get_cluster_status(self, cluster_id: str) -> Optional[ClusterStatus]:
        cluster = await self.get_cluster(cluster_id)
        if not cluster:
            return None

        return ClusterStatus(
            status=cluster.status,
            api_server_url=cluster.api_server_url,
            node_count=cluster.node_count,
            gpu_count=cluster.gpu_count,
            gpu_type=cluster.gpu_type,
            gpu_allocation_mode=cluster.gpu_allocation_mode,
            cluster_version=cluster.cluster_version,
            last_health_check=cluster.last_health_check
        )

    async def upload_kubeconfig(
        self,
        cluster_id: str,
        kubeconfig_content: str
    ) -> Optional[Cluster]:
        cluster = await self.get_cluster(cluster_id)
        if not cluster:
            return None
        
        parsed = KubernetesService.parse_kubeconfig(kubeconfig_content)
        if not parsed.get("valid"):
            raise ValueError(f"Invalid kubeconfig: {parsed.get('error')}")
        
        kubeconfig_path = KubernetesService.save_kubeconfig(
            kubeconfig_content,
            settings.KUBECONFIG_STORAGE_PATH,
            cluster.name
        )
        
        cluster.kubeconfig_path = kubeconfig_path
        cluster.api_server_url = parsed.get("api_server")
        cluster.status = "pending"
        
        await self.db.commit()
        await self.db.refresh(cluster)
        
        await self.refresh_cluster_status(cluster_id)
        await self.db.refresh(cluster)

        return cluster

    async def _get_or_create_cost_row(self, cluster_id: str, billing_month: str) -> ClusterCost:
        result = await self.db.execute(
            select(ClusterCost).where(
                ClusterCost.cluster_id == cluster_id,
                ClusterCost.billing_month == billing_month,
            )
        )
        cost_row = result.scalar_one_or_none()
        if not cost_row:
            cost_row = ClusterCost(cluster_id=cluster_id, billing_month=billing_month)
            self.db.add(cost_row)
        return cost_row

    async def refresh_cluster_cost(
        self,
        cluster_id: str,
        csv_path: Optional[str] = None,
        rows: Optional[list] = None,
        tag_ids: Optional[list] = None,
    ) -> List[ClusterCost]:
        """Refresh cost data for a cluster from all available CSVs (or a specific one)."""
        cluster = await self.get_cluster(cluster_id)
        if not cluster:
            return []

        if not cluster.infra_id:
            return []

        if csv_path:
            report_files = [(csv_path, rows, tag_ids)]
        else:
            reports = billing_csv_service.get_available_reports()
            if not reports:
                return []
            report_files = [(r["file_path"], None, None) for r in reports]

        updated = []
        for rpath, rrows, rtags in report_files:
            try:
                parsed_rows = rrows if rrows is not None else billing_csv_service.parse_billing_csv(rpath)
                parsed_tags = rtags if rtags is not None else billing_csv_service._read_cluster_ids_from_header(rpath)
                match_id = billing_csv_service.resolve_billing_id(
                    cluster.infra_id, parsed_rows, parsed_tags, cluster.name
                )
                result = billing_csv_service.get_cluster_cost(match_id, rpath, rows=parsed_rows)

                no_match = (
                    result.total_cost == 0
                    and not result.node_breakdown
                    and not result.unmatched_line_items
                )

                cost_row = await self._get_or_create_cost_row(cluster_id, result.billing_month)
                cost_row.currency = result.currency
                cost_row.total_cost = None if no_match else result.total_cost
                cost_row.node_breakdown = result.node_breakdown
                cost_row.unmatched_line_items = result.unmatched_line_items
                cost_row.fetched_at = datetime.utcnow()
                cost_row.error = (
                    "No matching billing data found for this cluster's infrastructure ID"
                    if no_match else None
                )
                updated.append(cost_row)
            except Exception as e:
                logger.error(f"Cost extraction failed for cluster {cluster_id} from {rpath}: {e}")

        await self.db.commit()
        return updated

    async def get_cluster_costs(self, cluster_id: str) -> List[ClusterCost]:
        result = await self.db.execute(
            select(ClusterCost)
            .where(ClusterCost.cluster_id == cluster_id)
            .order_by(ClusterCost.billing_month.desc())
        )
        return list(result.scalars().all())
