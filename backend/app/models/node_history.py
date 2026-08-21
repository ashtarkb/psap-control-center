from sqlalchemy import (
    Column, String, Boolean, DateTime,
    ForeignKey, UniqueConstraint,
)
from datetime import datetime
import uuid

from app.core.database import Base


class NodeHistory(Base):
    __tablename__ = "node_history"
    __table_args__ = (
        UniqueConstraint("cluster_id", "node_name", name="uq_cluster_node"),
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
    node_name = Column(String(255), nullable=False)
    instance_type = Column(String(255), nullable=True)
    region = Column(String(100), nullable=True)
    is_gpu_node = Column(Boolean, nullable=False, default=False)
    first_seen = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_seen = Column(DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self):
        return (
            f"<NodeHistory({self.node_name} "
            f"type={self.instance_type} gpu={self.is_gpu_node})>"
        )
