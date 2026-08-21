from sqlalchemy import Column, String, Float, Boolean, DateTime, UniqueConstraint
from datetime import datetime
import uuid

from app.core.database import Base


class InstanceTypeRate(Base):
    __tablename__ = "instance_type_rates"
    __table_args__ = (
        UniqueConstraint("instance_type", "region", name="uq_instance_region"),
    )

    id = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    instance_type = Column(String(255), nullable=False, index=True)
    region = Column(String(100), nullable=False)
    public_hourly_rate = Column(Float, nullable=False)
    plan_id = Column(String(255), nullable=True)
    is_estimated = Column(Boolean, nullable=False, default=False)
    last_fetched = Column(DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self):
        return (
            f"<InstanceTypeRate({self.instance_type} "
            f"{self.region} ${self.public_hourly_rate}/hr)>"
        )
