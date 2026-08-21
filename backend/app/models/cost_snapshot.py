from sqlalchemy import (
    Column, String, Float, Integer, Boolean, Date, DateTime,
    ForeignKey, UniqueConstraint,
)
from datetime import datetime
import uuid

from app.core.database import Base


class CostSnapshot(Base):
    __tablename__ = "cost_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "cluster_id", "period_start",
            name="uq_cluster_period",
        ),
    )

    id = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    cluster_id = Column(
        String(36),
        ForeignKey("clusters.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    period_start = Column(Date, nullable=False, index=True)
    public_cost = Column(Float, nullable=False, default=0)
    estimated_cost = Column(Float, nullable=False, default=0)
    actual_cost = Column(Float, nullable=True)
    discount_pct = Column(Float, nullable=False, default=0)
    node_count = Column(Integer, nullable=False, default=0)
    is_finalized = Column(Boolean, nullable=False, default=False)
    computed_at = Column(
        DateTime, nullable=False, default=datetime.utcnow,
    )

    def __repr__(self):
        return (
            f"<CostSnapshot({self.cluster_id} "
            f"{self.period_start} pub=${self.public_cost:.0f})>"
        )
