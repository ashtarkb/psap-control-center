from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class ClusterBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    tags: Optional[List[str]] = None


class ClusterCreate(ClusterBase):
    kubeconfig_content: Optional[str] = None
    # Alternative: Login with credentials (kubeadmin)
    api_server_url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class ClusterUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    is_active: Optional[bool] = None


class GpuTypeInfo(BaseModel):
    product: str
    count: int
    allocated: int
    free: int
    node_count: int


class GpuPodInfo(BaseModel):
    name: str
    namespace: str
    gpu_count: int
    node: Optional[str] = None


class GpuAllocationStatus(BaseModel):
    gpu_allocation_mode: str = "legacy"
    dra_available: bool = False
    dra_api_version: Optional[str] = None
    total_gpus: int = 0
    allocated_gpus: int = 0
    free_gpus: int = 0
    gpu_types: List[GpuTypeInfo] = []
    gpu_pods: List[GpuPodInfo] = []


class ClusterStatus(BaseModel):
    status: str
    api_server_url: Optional[str] = None
    node_count: Optional[str] = None
    gpu_count: Optional[str] = None
    gpu_type: Optional[str] = None
    gpu_allocation_mode: Optional[str] = None
    cluster_version: Optional[str] = None
    last_health_check: Optional[datetime] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    namespaces: Optional[List[str]] = None
    resource_usage: Optional[Dict[str, Any]] = None


class ClusterResponse(ClusterBase):
    id: str
    api_server_url: Optional[str] = None
    status: str
    color: str = "#3B82F6"
    last_health_check: Optional[datetime] = None
    node_count: Optional[str] = None
    gpu_count: Optional[str] = None
    gpu_type: Optional[str] = None
    gpu_allocation_mode: Optional[str] = None
    cluster_version: Optional[str] = None
    metadata_info: Optional[Dict[str, Any]] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ClusterListResponse(BaseModel):
    clusters: List[ClusterResponse]
    total: int
