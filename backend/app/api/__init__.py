from fastapi import APIRouter

from app.api import clusters, reservations, health, auth, hearth, settings

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(clusters.router, prefix="/clusters", tags=["clusters"])
api_router.include_router(reservations.router, prefix="/reservations", tags=["reservations"])
api_router.include_router(hearth.router, prefix="/hearth", tags=["hearth"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
