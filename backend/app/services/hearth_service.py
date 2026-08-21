import os
from typing import List, Optional

from kubernetes import client, config
from kubernetes.client.rest import ApiException

from app.core.config import settings
from app.schemas.hearth import (
    HearthClusterResponse,
    HearthCondition,
    HearthGPU,
    HearthHardware,
    HearthStatusResponse,
)
from app.utils.logger import create_logger

logger = create_logger("HearthService")

CRD_GROUP = "fournos.dev"
CRD_VERSION = "v1"
FOURNOS_CLUSTER_PLURAL = "fournosclusters"

HEARTH_KUBECONFIG_FILENAME = "hearth-management.kubeconfig"


def _hearth_kubeconfig_disk_path() -> str:
    return os.path.join(
        settings.KUBECONFIG_STORAGE_PATH,
        HEARTH_KUBECONFIG_FILENAME,
    )


class HearthService:
    def __init__(self):
        self._custom_api: Optional[client.CustomObjectsApi] = None

    def _get_api(self) -> client.CustomObjectsApi:
        if self._custom_api is not None:
            return self._custom_api

        kubeconfig_path = (
            settings.HEARTH_KUBECONFIG_PATH
            or self._saved_kubeconfig_path()
        )

        try:
            if kubeconfig_path:
                cfg = client.Configuration()
                config.load_kube_config(
                    config_file=kubeconfig_path,
                    client_configuration=cfg,
                )
                api_client = client.ApiClient(configuration=cfg)
                self._custom_api = client.CustomObjectsApi(
                    api_client
                )
            else:
                try:
                    config.load_incluster_config()
                except config.ConfigException:
                    config.load_kube_config()
                self._custom_api = client.CustomObjectsApi()
        except Exception as exc:
            logger.error(
                "Failed to initialize K8s client for Hearth:", exc
            )
            raise

        return self._custom_api

    @staticmethod
    def _saved_kubeconfig_path() -> Optional[str]:
        path = _hearth_kubeconfig_disk_path()
        return path if os.path.isfile(path) else None

    def reset(self) -> None:
        """Drop the cached K8s client so the next call rebuilds it.
        Also resets the Fournos K8s client since it shares the same kubeconfig.
        """
        self._custom_api = None
        try:
            from app.services.fournos_k8s_client import reset as reset_fournos
            reset_fournos()
        except Exception:
            pass

    def save_kubeconfig(self, content: str) -> str:
        """Save a management-cluster kubeconfig and reconnect."""
        path = _hearth_kubeconfig_disk_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(content)
        os.chmod(path, 0o600)
        self.reset()
        logger.info("Hearth kubeconfig saved to:", path)
        return path

    def remove_kubeconfig(self) -> None:
        """Remove the saved kubeconfig and disconnect."""
        path = _hearth_kubeconfig_disk_path()
        if os.path.isfile(path):
            os.remove(path)
            logger.info("Hearth kubeconfig removed:", path)
        self.reset()

    def is_configured(self) -> bool:
        return bool(
            settings.HEARTH_KUBECONFIG_PATH
            or self._saved_kubeconfig_path()
        )

    def _parse_cluster(self, item: dict) -> HearthClusterResponse:
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})
        status = item.get("status", {})
        hw = spec.get("hardware") or {}

        gpus = [
            HearthGPU(
                vendor=g.get("vendor", ""),
                model=g.get("model", ""),
                short_name=g.get("shortName", ""),
                count=g.get("count", 0),
                node_count=g.get("nodeCount"),
            )
            for g in hw.get("gpus", [])
        ]

        hardware = HearthHardware(
            gpus=gpus,
            total_gpus=hw.get("totalGPUs", 0),
            last_discovery=hw.get("lastDiscovery"),
            consecutive_failures=hw.get("consecutiveFailures", 0),
            last_error=hw.get("lastError"),
        ) if hw else None

        conditions = [
            HearthCondition(
                type=c.get("type", ""),
                status=c.get("status", ""),
                last_transition_time=c.get("lastTransitionTime"),
                reason=c.get("reason"),
                message=c.get("message"),
            )
            for c in status.get("conditions", [])
        ]

        return HearthClusterResponse(
            name=metadata.get("name", ""),
            kubeconfig_secret=spec.get("kubeconfigSecret", ""),
            owner=spec.get("owner") or None,
            ttl=spec.get("ttl"),
            gpu_discovery_interval=spec.get("gpuDiscoveryInterval"),
            hardware=hardware,
            kubeconfig_status=status.get("kubeconfigStatus"),
            locked=status.get("locked", False),
            lock_expires_at=status.get("lockExpiresAt"),
            owner_set_at=status.get("ownerSetAt"),
            lock_job_name=status.get("lockJobName"),
            gpu_summary=status.get("gpuSummary"),
            conditions=conditions,
            created_at=metadata.get("creationTimestamp"),
        )

    def list_clusters(self) -> List[HearthClusterResponse]:
        api = self._get_api()
        result = api.list_namespaced_custom_object(
            group=CRD_GROUP,
            version=CRD_VERSION,
            namespace=settings.HEARTH_NAMESPACE,
            plural=FOURNOS_CLUSTER_PLURAL,
        )
        return [
            self._parse_cluster(item)
            for item in result.get("items", [])
        ]

    def get_cluster(
        self, name: str
    ) -> Optional[HearthClusterResponse]:
        api = self._get_api()
        try:
            item = api.get_namespaced_custom_object(
                group=CRD_GROUP,
                version=CRD_VERSION,
                namespace=settings.HEARTH_NAMESPACE,
                plural=FOURNOS_CLUSTER_PLURAL,
                name=name,
            )
            return self._parse_cluster(item)
        except ApiException as exc:
            if exc.status == 404:
                return None
            raise

    def get_status(self) -> HearthStatusResponse:
        configured = self.is_configured()

        if not configured:
            return HearthStatusResponse(
                available=False,
                configured=False,
                error="No kubeconfig configured for Hearth",
            )

        try:
            clusters = self.list_clusters()
            total_gpus = sum(
                (c.hardware.total_gpus if c.hardware else 0)
                for c in clusters
            )
            locked = sum(1 for c in clusters if c.locked)
            return HearthStatusResponse(
                available=True,
                configured=True,
                cluster_count=len(clusters),
                total_gpus=total_gpus,
                locked_clusters=locked,
            )
        except Exception as exc:
            logger.warn("Hearth unavailable:", exc)
            return HearthStatusResponse(
                available=False,
                configured=True,
                error=str(exc),
            )


_hearth_service: Optional[HearthService] = None


def get_hearth_service() -> HearthService:
    global _hearth_service
    if _hearth_service is None:
        _hearth_service = HearthService()
    return _hearth_service
