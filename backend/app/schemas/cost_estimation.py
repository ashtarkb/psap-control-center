from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class InstanceTypeRateResponse(BaseModel):
    instance_type: str
    region: str
    public_hourly_rate: float
    plan_id: Optional[str] = None
    is_estimated: bool = False
    last_fetched: datetime


class NodeEstimate(BaseModel):
    node_name: str
    instance_type: Optional[str] = None
    region: Optional[str] = None
    is_gpu: bool = False
    hours_active: float = 0
    public_rate: Optional[float] = None
    public_cost: float = 0
    estimated_cost: float = 0
    actual_cost: Optional[float] = None
    rate_available: bool = False


class ClusterEstimate(BaseModel):
    cluster_id: str
    billing_month: str
    total_public_cost: float
    total_estimated_cost: float
    total_actual_cost: Optional[float] = None
    discount_pct: float
    node_count: int
    nodes: List[NodeEstimate]


class WorkloadAttribution(BaseModel):
    namespace: str
    gpu_hours: float
    percentage: float
    estimated_cost: float


class ClusterMonthlyCost(BaseModel):
    cluster_id: str
    cluster_name: str
    cluster_color: str
    actual_cost: Optional[float] = None
    public_cost: float = 0
    estimated_cost: Optional[float] = None


class MonthlyCostSummary(BaseModel):
    month: str
    actual_total: Optional[float] = None
    public_total: float = 0
    estimated_total: Optional[float] = None
    savings: Optional[float] = None
    discount_pct: Optional[float] = None
    aggregate_discount_pct: Optional[float] = None
    is_estimate: bool = False
    clusters: List[ClusterMonthlyCost]


class YearSummary(BaseModel):
    year: int
    months: List[MonthlyCostSummary]
    ytd_actual: float = 0
    ytd_public: float = 0
    ytd_estimated: float = 0
    ytd_savings: Optional[float] = None
    ytd_discount_pct: Optional[float] = None
    aggregate_discount_pct: Optional[float] = None
    cluster_count: int = 0


class RateRefreshResponse(BaseModel):
    updated: int
    total: int
