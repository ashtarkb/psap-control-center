from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

from app.core.database import Base


class ReservationStatus(str, enum.Enum):
    PENDING = "pending"
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DENIED = "denied"


class ReservationType(str, enum.Enum):
    CLUSTER = "cluster"
    GPU = "gpu"


class Reservation(Base):
    __tablename__ = "reservations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cluster_id = Column(String(36), ForeignKey("clusters.id", ondelete="SET NULL"), nullable=True, index=True)
    cluster_name = Column(String(255), nullable=True)

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    user_name = Column(String(255), nullable=False, index=True)
    user_email = Column(String(255), nullable=True)
    team = Column(String(255), nullable=True)

    start_time = Column(DateTime, nullable=False, index=True)
    end_time = Column(DateTime, nullable=False, index=True)

    status = Column(
        String(9),
        default=ReservationStatus.PENDING.value,
        nullable=False
    )
    priority = Column(String(20), default="normal", nullable=False)

    reservation_type = Column(String(20), default="cluster", nullable=False)
    gpu_count = Column(Integer, nullable=True)
    enforce_isolation = Column(Boolean, default=False, nullable=False)

    enforcement_namespace = Column(String(255), nullable=True)
    enforcement_status = Column(String(50), nullable=True)

    purpose = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    color = Column(String(7), default="#0891b2")

    pending_modification = Column(Text, nullable=True)
    modification_requested_by = Column(String(255), nullable=True)
    modification_requested_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    cluster = relationship("Cluster", back_populates="reservations")

    @property
    def is_gpu_reservation(self) -> bool:
        return (self.reservation_type or "cluster") == "gpu"

    def __repr__(self):
        return f"<Reservation(title={self.title}, user={self.user_name}, type={self.reservation_type}, cluster_id={self.cluster_id})>"
