"""Kubernetes client for FournosJob, PipelineRun, and Pod operations.

Ported from fournos-ui k8s_client.py — adapted for PSAP Control Center's
async FastAPI backend. Reuses the Hearth kubeconfig when available.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from collections.abc import Generator
from datetime import datetime, timezone
from typing import Optional

from kubernetes import client, config, watch
from kubernetes.client.rest import ApiException

from app.core.config import settings

logger = logging.getLogger(__name__)

_api_client: Optional[client.ApiClient] = None
_custom_api: Optional[client.CustomObjectsApi] = None
_core_api: Optional[client.CoreV1Api] = None
_lock = threading.Lock()

# Native Fournos recurring-job / trigger-now constants — mirrors
# fournos/fournos/core/constants.py exactly, so the Control Center speaks
# the operator's own vocabulary instead of a bespoke scheduling mechanism.
LABEL_RECURRING_PARENT = "fournos.dev/recurring-parent"
ANNOTATION_TRIGGER_NOW = "fournos.dev/trigger-now"

HEARTH_KUBECONFIG_FILENAME = "hearth-management.kubeconfig"


def _saved_hearth_kubeconfig() -> Optional[str]:
    """Return the on-disk Hearth kubeconfig uploaded via the UI, if it exists."""
    path = os.path.join(settings.KUBECONFIG_STORAGE_PATH, HEARTH_KUBECONFIG_FILENAME)
    return path if os.path.isfile(path) else None


def _ensure_loaded() -> None:
    """Load kubeconfig once (thread-safe)."""
    global _api_client, _custom_api, _core_api
    if _custom_api is not None:
        return
    with _lock:
        if _custom_api is not None:
            return
        kube_path = settings.HEARTH_KUBECONFIG_PATH or _saved_hearth_kubeconfig()
        try:
            if kube_path:
                config.load_kube_config(config_file=kube_path)
            else:
                try:
                    config.load_incluster_config()
                except config.ConfigException:
                    config.load_kube_config()
        except Exception:
            logger.warning("K8s config not available — fournos running in offline mode")
            return

        configuration = client.Configuration.get_default_copy()
        timeout = settings.FOURNOS_K8S_TIMEOUT
        configuration.verify_ssl = False
        configuration.connect_timeout = timeout
        configuration.read_timeout = timeout
        _api_client = client.ApiClient(configuration=configuration)
        _custom_api = client.CustomObjectsApi(_api_client)
        _core_api = client.CoreV1Api(_api_client)
        logger.info("Fournos K8s client initialised (timeout=%ds)", timeout)


def reset() -> None:
    """Drop cached K8s clients so the next call re-reads the kubeconfig."""
    global _api_client, _custom_api, _core_api
    with _lock:
        _api_client = _custom_api = _core_api = None


def is_connected() -> bool:
    _ensure_loaded()
    return _custom_api is not None


# -- FournosJob CRUD --

def list_fournos_jobs(namespace: Optional[str] = None) -> list:
    _ensure_loaded()
    if _custom_api is None:
        return []
    ns = namespace or settings.FOURNOS_NAMESPACE
    try:
        result = _custom_api.list_namespaced_custom_object(
            group=settings.FOURNOS_API_GROUP,
            version=settings.FOURNOS_API_VERSION,
            namespace=ns,
            plural=settings.FOURNOS_JOB_PLURAL,
        )
        return result.get("items", [])
    except ApiException as exc:
        logger.error("Failed to list FournosJobs: %s", exc.reason)
        return []


def get_fournos_job(name: str, namespace: Optional[str] = None) -> Optional[dict]:
    _ensure_loaded()
    if _custom_api is None:
        return None
    ns = namespace or settings.FOURNOS_NAMESPACE
    try:
        return _custom_api.get_namespaced_custom_object(
            group=settings.FOURNOS_API_GROUP,
            version=settings.FOURNOS_API_VERSION,
            namespace=ns,
            plural=settings.FOURNOS_JOB_PLURAL,
            name=name,
        )
    except ApiException as exc:
        if exc.status == 404:
            return None
        logger.error("Failed to get FournosJob %s: %s", name, exc.reason)
        return None


def create_fournos_job(body: dict, namespace: Optional[str] = None) -> dict:
    _ensure_loaded()
    if _custom_api is None:
        raise RuntimeError("Kubernetes client not available")
    ns = namespace or settings.FOURNOS_NAMESPACE
    return _custom_api.create_namespaced_custom_object(
        group=settings.FOURNOS_API_GROUP,
        version=settings.FOURNOS_API_VERSION,
        namespace=ns,
        plural=settings.FOURNOS_JOB_PLURAL,
        body=body,
    )


def patch_fournos_job(
    name: str, patch: dict, namespace: Optional[str] = None
) -> dict:
    _ensure_loaded()
    if _custom_api is None:
        raise RuntimeError("Kubernetes client not available")
    ns = namespace or settings.FOURNOS_NAMESPACE
    return _custom_api.patch_namespaced_custom_object(
        group=settings.FOURNOS_API_GROUP,
        version=settings.FOURNOS_API_VERSION,
        namespace=ns,
        plural=settings.FOURNOS_JOB_PLURAL,
        name=name,
        body=patch,
    )


def shutdown_fournos_job(
    name: str, value: str = "Stop", namespace: Optional[str] = None
) -> dict:
    return patch_fournos_job(name, {"spec": {"shutdown": value}}, namespace)


def delete_fournos_job(name: str, namespace: Optional[str] = None) -> None:
    _ensure_loaded()
    if _custom_api is None:
        raise RuntimeError("Kubernetes client not available")
    ns = namespace or settings.FOURNOS_NAMESPACE
    _custom_api.delete_namespaced_custom_object(
        group=settings.FOURNOS_API_GROUP,
        version=settings.FOURNOS_API_VERSION,
        namespace=ns,
        plural=settings.FOURNOS_JOB_PLURAL,
        name=name,
    )


def trigger_recurring_now(name: str, namespace: Optional[str] = None) -> dict:
    """Force an immediate off-cycle child run of a recurring FournosJob.

    Mirrors the operator's own trigger-now mechanism exactly (see
    fournos/fournos/handlers/lifecycle.py): annotate the parent job and the
    operator creates a child on its next reconcile tick (~5s), then resets
    the annotation to "false" itself.
    """
    return patch_fournos_job(
        name,
        {"metadata": {"annotations": {ANNOTATION_TRIGGER_NOW: "true"}}},
        namespace,
    )


def list_recurring_jobs(namespace: Optional[str] = None) -> list:
    """FournosJobs that are recurring templates (``spec.schedule`` set) —
    i.e. the parent, not the children it spawns on each tick.
    """
    return [
        j for j in list_fournos_jobs(namespace)
        if j.get("spec", {}).get("schedule")
    ]


def is_lock_only(spec: dict) -> bool:
    """Mirrors fournos/fournos/handlers/lifecycle.py::is_lock_only — a bare
    ``lockUntil`` is enough to imply a timed lock job without also setting
    ``lockOnly`` explicitly.
    """
    explicit = spec.get("lockOnly")
    if explicit is not None:
        return bool(explicit)
    return bool(spec.get("lockUntil"))


def list_cluster_locks(
    namespace: Optional[str] = None, cluster: Optional[str] = None
) -> list:
    """FournosJobs that are sentinel cluster locks (``spec.lockOnly``, or a
    bare ``spec.lockUntil``) — active now or scheduled to start later via
    ``spec.scheduledStartTime``.
    """
    locks = [
        j for j in list_fournos_jobs(namespace)
        if is_lock_only(j.get("spec", {}))
    ]
    if cluster:
        locks = [j for j in locks if j.get("spec", {}).get("cluster") == cluster]
    return locks


def watch_fournos_jobs(
    namespace: Optional[str] = None,
    resource_version: str = "",
    timeout: int = 0,
) -> Generator:
    _ensure_loaded()
    if _custom_api is None:
        return
    ns = namespace or settings.FOURNOS_NAMESPACE
    w = watch.Watch()
    kwargs: dict = {
        "group": settings.FOURNOS_API_GROUP,
        "version": settings.FOURNOS_API_VERSION,
        "namespace": ns,
        "plural": settings.FOURNOS_JOB_PLURAL,
    }
    if resource_version:
        kwargs["resource_version"] = resource_version
    if timeout:
        kwargs["timeout_seconds"] = timeout
    try:
        yield from w.stream(
            _custom_api.list_namespaced_custom_object, **kwargs
        )
    except ApiException as exc:
        logger.warning("Watch stream ended: %s", exc.reason)


# -- Tekton PipelineRun / TaskRun --

def get_pipelinerun(name: str, namespace: Optional[str] = None) -> Optional[dict]:
    _ensure_loaded()
    if _custom_api is None:
        return None
    ns = namespace or settings.FOURNOS_NAMESPACE
    try:
        return _custom_api.get_namespaced_custom_object(
            group=settings.TEKTON_API_GROUP,
            version=settings.TEKTON_API_VERSION,
            namespace=ns,
            plural="pipelineruns",
            name=name,
        )
    except ApiException as exc:
        if exc.status == 404:
            return None
        logger.error("Failed to get PipelineRun %s: %s", name, exc.reason)
        return None


def list_pipelineruns_for_job(
    job_name: str, namespace: Optional[str] = None
) -> list:
    _ensure_loaded()
    if _custom_api is None:
        return []
    ns = namespace or settings.FOURNOS_NAMESPACE
    try:
        result = _custom_api.list_namespaced_custom_object(
            group=settings.TEKTON_API_GROUP,
            version=settings.TEKTON_API_VERSION,
            namespace=ns,
            plural="pipelineruns",
            label_selector=f"fournos.dev/job-name={job_name}",
        )
        return result.get("items", [])
    except ApiException as exc:
        logger.error(
            "Failed to list PipelineRuns for %s: %s", job_name, exc.reason
        )
        return []


def get_taskrun(name: str, namespace: Optional[str] = None) -> Optional[dict]:
    _ensure_loaded()
    if _custom_api is None:
        return None
    ns = namespace or settings.FOURNOS_NAMESPACE
    try:
        return _custom_api.get_namespaced_custom_object(
            group=settings.TEKTON_API_GROUP,
            version=settings.TEKTON_API_VERSION,
            namespace=ns,
            plural="taskruns",
            name=name,
        )
    except ApiException as exc:
        if exc.status == 404:
            return None
        logger.error("Failed to get TaskRun %s: %s", name, exc.reason)
        return None


def _phase_from_conditions(conditions: list) -> str:
    if not conditions:
        return "Pending"
    cond = conditions[0]
    reason = cond.get("reason", "")
    cond_status = cond.get("status", "")
    if reason == "Succeeded" and cond_status == "True":
        return "Succeeded"
    if reason == "Failed" or cond_status == "False":
        return "Failed"
    if reason in ("Running", "Started"):
        return "Running"
    if reason == "TaskRunCancelled":
        return "Cancelled"
    if reason == "SkippingNoMatch":
        return "Skipped"
    return "Pending"


def get_current_step_for_job(
    job_name: str, namespace: Optional[str] = None
) -> Optional[dict]:
    prs = list_pipelineruns_for_job(job_name, namespace)
    if not prs:
        return None
    child_refs = prs[0].get("status", {}).get("childReferences", [])
    for ref in child_refs:
        task_run_name = ref.get("name", "")
        tr = get_taskrun(task_run_name)
        if not tr:
            continue
        tr_status = tr.get("status", {})
        phase = _phase_from_conditions(tr_status.get("conditions", []))
        if phase == "Running":
            task_name = ref.get("pipelineTaskName", task_run_name)
            return {
                "name": task_name,
                "displayName": task_name.replace("-", " ").title(),
                "startTime": tr_status.get("startTime"),
            }
    return None


def extract_pipeline_stages(pipelinerun: dict) -> list:
    status = pipelinerun.get("status", {})
    child_refs = status.get("childReferences", [])
    pipeline_spec = status.get("pipelineSpec", {})

    finally_task_names = set()
    for task in pipeline_spec.get("finally", []):
        finally_task_names.add(task.get("name", ""))

    stages = []
    for ref in child_refs:
        task_name = ref.get(
            "pipelineTaskName", ref.get("name", "unknown")
        )
        task_run_name = ref.get("name", "")
        start_time = None
        completion_time = None
        task_phase = "Pending"

        tr = get_taskrun(task_run_name)
        if tr:
            tr_status = tr.get("status", {})
            start_time = tr_status.get("startTime")
            completion_time = tr_status.get("completionTime")
            task_phase = _phase_from_conditions(
                tr_status.get("conditions", [])
            )

        stages.append({
            "name": task_name,
            "displayName": task_name.replace("-", " ").title(),
            "status": task_phase,
            "startTime": start_time,
            "completionTime": completion_time,
            "finally": task_name in finally_task_names,
        })

    stages.sort(
        key=lambda s: (s["finally"], s.get("startTime") or "9999")
    )
    return stages


# -- Pod operations --

def list_pods_for_job(
    job_name: str, namespace: Optional[str] = None
) -> list:
    _ensure_loaded()
    if _core_api is None:
        return []
    ns = namespace or settings.FOURNOS_NAMESPACE
    try:
        result = _core_api.list_namespaced_pod(
            namespace=ns,
            label_selector=f"fournos.dev/job-name={job_name}",
        )
        pods = []
        for pod in result.items:
            created = pod.metadata.creation_timestamp
            age_minutes = 0
            if created:
                delta = datetime.now(timezone.utc) - created.replace(
                    tzinfo=timezone.utc
                )
                age_minutes = int(delta.total_seconds() / 60)

            container_ready = False
            restarts = 0
            exit_code = None
            term_reason = ""
            term_message = ""
            if pod.status.container_statuses:
                for cs in pod.status.container_statuses:
                    if cs.ready:
                        container_ready = True
                    restarts += cs.restart_count
                    terminated = (
                        cs.state.terminated
                        if cs.state and cs.state.terminated
                        else (
                            cs.last_state.terminated
                            if cs.last_state and cs.last_state.terminated
                            else None
                        )
                    )
                    if terminated:
                        exit_code = terminated.exit_code
                        term_reason = terminated.reason or ""
                        term_message = terminated.message or ""

            if pod.metadata.name.startswith("affinity-assistant"):
                continue

            pods.append({
                "name": pod.metadata.name,
                "phase": pod.status.phase or "Unknown",
                "container": (
                    pod.spec.containers[0].name
                    if pod.spec.containers
                    else "unknown"
                ),
                "ready": container_ready,
                "restarts": restarts,
                "age_minutes": age_minutes,
                "exit_code": exit_code,
                "term_reason": term_reason,
                "term_message": term_message,
                "_created": created,
            })
        pods.sort(
            key=lambda p: p["_created"]
            or datetime.min.replace(tzinfo=timezone.utc)
        )
        return pods
    except ApiException as exc:
        logger.error("Failed to list pods for %s: %s", job_name, exc.reason)
        return []


def read_pod_log(
    pod_name: str,
    namespace: Optional[str] = None,
    container: Optional[str] = None,
    follow: bool = False,
    tail_lines: Optional[int] = None,
) -> Generator:
    _ensure_loaded()
    if _core_api is None:
        yield "Kubernetes client not available"
        return
    ns = namespace or settings.FOURNOS_NAMESPACE
    kwargs: dict = {"name": pod_name, "namespace": ns, "follow": follow}
    if container:
        kwargs["container"] = container
    if tail_lines:
        kwargs["tail_lines"] = tail_lines
    try:
        if follow:
            for line in _core_api.read_namespaced_pod_log(
                **kwargs, _preload_content=False
            ).stream():
                decoded = line.decode("utf-8", errors="replace").rstrip("\n")
                yield decoded
        else:
            log_text = _core_api.read_namespaced_pod_log(**kwargs)
            for line in log_text.splitlines():
                yield line
    except ApiException as exc:
        yield "Error reading logs: {}".format(exc.reason)



def sanitize_job_name(prefix: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = "{}-{}".format(prefix, ts).lower()
    name = re.sub(r"[^a-z0-9-]", "-", name)
    name = re.sub(r"-+", "-", name).strip("-")
    return name[:63]
