from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Any, Dict, Optional, List, Literal
from datetime import datetime

from app.models.reservation import (
    ReservationStatus as ReservationStatusEnum
)

VALID_PRIORITIES = ("undefined", "minor", "normal", "critical", "blocker")
PriorityType = Literal[
    "undefined", "minor", "normal", "critical", "blocker"
]


class ReservationBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    cluster_id: str
    user_name: str = Field(..., min_length=1, max_length=255)
    user_email: Optional[str] = None
    team: Optional[str] = None
    start_time: datetime
    end_time: datetime
    reservation_type: str = "cluster"
    gpu_count: Optional[int] = None
    enforce_isolation: bool = False
    priority: PriorityType = "normal"
    purpose: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = Field(default="#0891b2", pattern="^#[0-9A-Fa-f]{6}$")

    @field_validator('end_time')
    @classmethod
    def end_time_must_be_after_start(cls, v, info):
        if 'start_time' in info.data and v <= info.data['start_time']:
            raise ValueError('end_time must be after start_time')
        return v

    @field_validator('reservation_type')
    @classmethod
    def validate_reservation_type(cls, v):
        if v not in ("cluster", "gpu"):
            raise ValueError('reservation_type must be "cluster" or "gpu"')
        return v

    @model_validator(mode='after')
    def validate_gpu_fields(self):
        if self.reservation_type == "gpu":
            if self.gpu_count is None or self.gpu_count < 1:
                raise ValueError('gpu_count must be >= 1 when reservation_type is "gpu"')
        elif self.reservation_type == "cluster" and self.gpu_count is not None:
            raise ValueError('gpu_count must be null when reservation_type is "cluster"')
        return self


class ReservationCreate(ReservationBase):
    pass


class ReservationUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    team: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None
    reservation_type: Optional[str] = None
    gpu_count: Optional[int] = None
    enforce_isolation: Optional[bool] = None
    priority: Optional[PriorityType] = None
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")

    @field_validator('reservation_type')
    @classmethod
    def validate_reservation_type(cls, v):
        if v is not None and v not in ("cluster", "gpu"):
            raise ValueError('reservation_type must be "cluster" or "gpu"')
        return v

    @model_validator(mode='after')
    def validate_gpu_fields(self):
        if self.reservation_type == "gpu":
            if self.gpu_count is not None and self.gpu_count < 1:
                raise ValueError('gpu_count must be >= 1 when reservation_type is "gpu"')
        if self.reservation_type == "cluster" and self.gpu_count is not None:
            raise ValueError('gpu_count must be null when reservation_type is "cluster"')
        if self.gpu_count is not None and self.reservation_type is None:
            raise ValueError(
                'reservation_type is required when gpu_count is set'
            )
        return self

    @model_validator(mode='after')
    def validate_partial_times(self):
        if self.start_time is not None and self.end_time is not None:
            if self.end_time <= self.start_time:
                raise ValueError('end_time must be after start_time')
        return self


class ReservationResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    cluster_id: Optional[str] = None
    cluster_name: Optional[str] = None
    user_name: str
    user_email: Optional[str] = None
    team: Optional[str] = None
    start_time: datetime
    end_time: datetime
    reservation_type: str = "cluster"
    gpu_count: Optional[int] = None
    enforce_isolation: bool = False
    priority: str = "normal"
    enforcement_namespace: Optional[str] = None
    enforcement_status: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None
    status: ReservationStatusEnum
    pending_modification: Optional[Dict[str, Any]] = None
    modification_requested_by: Optional[str] = None
    modification_requested_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReservationListResponse(BaseModel):
    reservations: List[ReservationResponse]
    total: int


class CalendarEvent(BaseModel):
    id: str
    title: str
    start: datetime
    end: datetime
    cluster_id: Optional[str] = None
    cluster_name: str
    user_name: str
    team: Optional[str] = None
    status: ReservationStatusEnum
    color: str
    description: Optional[str] = None
    reservation_type: str = "cluster"
    gpu_count: Optional[int] = None
    priority: str = "normal"


class OccupancyReservation(BaseModel):
    user_name: str
    team: Optional[str] = None
    title: str
    start_time: datetime
    end_time: datetime
    reservation_type: str = "cluster"
    gpu_count: Optional[int] = None
    enforcement_namespace: Optional[str] = None
    enforcement_status: Optional[str] = None


class GpuSummary(BaseModel):
    total_reserved_gpus: int = 0
    has_cluster_reservation: bool = False
    reservation_count: int = 0


class ClusterOccupancyResponse(BaseModel):
    occupied: bool
    reservations: List[OccupancyReservation] = []
    gpu_summary: Optional[GpuSummary] = None


class ModificationRequestCreate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    purpose: Optional[str] = None
    reservation_type: Optional[str] = None
    gpu_count: Optional[int] = None
    enforce_isolation: Optional[bool] = None
    priority: Optional[PriorityType] = None


class DenyAction(BaseModel):
    reason: Optional[str] = None
