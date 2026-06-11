from sqlalchemy import Column, String, DateTime, Boolean, Text, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from app.core.database import Base

# Color palette for clusters
CLUSTER_COLORS = [
    "#3B82F6",  # Blue
    "#10B981",  # Green
    "#8B5CF6",  # Purple
    "#F97316",  # Orange
    "#EC4899",  # Pink
    "#14B8A6",  # Teal
    "#EF4444",  # Red
    "#F59E0B",  # Amber
    "#6366F1",  # Indigo
    "#84CC16",  # Lime
]


class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    api_server_url = Column(String(512), nullable=True)
    kubeconfig_path = Column(String(512), nullable=False)
    color = Column(String(7), nullable=False, default="#3B82F6")  # Hex color
    
    status = Column(String(50), default="unknown")
    last_health_check = Column(DateTime, nullable=True)
    
    node_count = Column(String(20), nullable=True)
    gpu_count = Column(String(20), nullable=True)
    gpu_type = Column(String(255), nullable=True)
    gpu_allocation_mode = Column(String(20), nullable=True)
    cluster_version = Column(String(50), nullable=True)
    
    metadata_info = Column(JSON, nullable=True)
    tags = Column(JSON, nullable=True)
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    reservations = relationship("Reservation", back_populates="cluster")

    def __repr__(self):
        return f"<Cluster(name={self.name}, status={self.status})>"
