from sqlalchemy.ext.asyncio import (
    create_async_engine, AsyncSession, async_sessionmaker
)
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import declarative_base
from sqlalchemy import event, text

from app.core.config import settings
from app.utils.logger import create_logger

logger = create_logger("Database")

# Create engine with SQLite-specific settings
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False
    connect_args["timeout"] = 30

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=connect_args,
    pool_pre_ping=True,
)



# Enable SQLite WAL mode, busy timeout, and foreign keys
@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ARG001
    if settings.DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session



_MIGRATIONS = [
    ("clusters", "gpu_type", "VARCHAR(255)"),
    ("clusters", "gpu_allocation_mode", "VARCHAR(20)"),
    ("reservations", "reservation_type", "VARCHAR(20) NOT NULL DEFAULT 'cluster'"),
    ("reservations", "gpu_count", "INTEGER"),
    ("reservations", "enforcement_namespace", "VARCHAR(255)"),
    ("reservations", "enforcement_status", "VARCHAR(50)"),
    ("reservations", "enforce_isolation", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("reservations", "priority", "VARCHAR(20) NOT NULL DEFAULT 'normal'"),
    ("reservations", "pending_modification", "TEXT"),
    ("reservations", "modification_requested_by", "VARCHAR(255)"),
    ("reservations", "modification_requested_at", "TIMESTAMP"),
]


async def _run_migrations(conn):
    """Add new columns to existing tables. Idempotent — silently skips columns that already exist."""
    is_pg = settings.DATABASE_URL.startswith("postgresql")
    for table, column, col_type in _MIGRATIONS:
        try:
            if is_pg:
                await conn.execute(text("SAVEPOINT migration_sp"))
            await conn.execute(text(
                f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
            ))
            if is_pg:
                await conn.execute(text("RELEASE SAVEPOINT migration_sp"))
            logger.info(f"Migration: added {table}.{column}")
        except (OperationalError, ProgrammingError) as e:
            err_msg = str(e).lower()
            if "duplicate column" in err_msg or "already exists" in err_msg:
                if is_pg:
                    await conn.execute(
                        text("ROLLBACK TO SAVEPOINT migration_sp")
                    )
            else:
                logger.error(
                    f"Migration failed for {table}.{column}: {e}"
                )
                raise


async def _normalize_status_values(conn):
    """Fix legacy UPPERCASE status values to lowercase."""
    for old, new in [
        ("PENDING", "pending"), ("SCHEDULED", "scheduled"),
        ("ACTIVE", "active"), ("COMPLETED", "completed"),
        ("CANCELLED", "cancelled"), ("DENIED", "denied"),
    ]:
        result = await conn.execute(
            text("UPDATE reservations SET status = :new WHERE status = :old"),
            {"new": new, "old": old},
        )
        if result.rowcount:
            logger.info(f"Normalized {result.rowcount} reservations from {old} -> {new}")


async def init_db():
    from app.models.cluster import Cluster  # noqa: F401
    from app.models.reservation import Reservation  # noqa: F401
    from app.models.user import User  # noqa: F401
    from app.models.gpu_pod_history import GpuPodHistory  # noqa: F401
    from app.models.setting import Setting  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _run_migrations(conn)
        await _normalize_status_values(conn)
