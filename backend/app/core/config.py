from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    PROJECT_NAME: str = "PSAP Control Center"
    VERSION: str = "1.0.0"
    API_V1_PREFIX: str = "/api/v1"
    
    DATABASE_URL: str = "sqlite+aiosqlite:///./psap_control_center.db"
    
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours
    
    KUBECONFIG_STORAGE_PATH: str = "./kubeconfigs"
    
    MLFLOW_BASE_URL: Optional[str] = None
    
    ADMIN_USERNAME: str = ""
    ADMIN_PASSWORD: str = ""

    USER_USERNAME: str = ""
    USER_PASSWORD: str = ""

    HEARTH_ENABLED: bool = True
    HEARTH_NAMESPACE: str = "hearth"
    HEARTH_KUBECONFIG_PATH: Optional[str] = None
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

_missing = []
if not settings.ADMIN_USERNAME or not settings.ADMIN_PASSWORD:
    _missing.append("ADMIN_USERNAME / ADMIN_PASSWORD")
if not settings.USER_USERNAME or not settings.USER_PASSWORD:
    _missing.append("USER_USERNAME / USER_PASSWORD")
if _missing:
    raise RuntimeError(
        f"Required credentials not set via environment variables: {', '.join(_missing)}. "
        "Set them in your .env file or environment."
    )

os.makedirs(settings.KUBECONFIG_STORAGE_PATH, exist_ok=True)
