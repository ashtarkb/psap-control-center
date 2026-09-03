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

    BILLING_CSV_STORAGE_PATH: str = "./billing_csvs"

    # Fournos Testing Tab
    FOURNOS_NAMESPACE: str = "psap-automation"
    FOURNOS_API_GROUP: str = "fournos.dev"
    FOURNOS_API_VERSION: str = "v1"
    FOURNOS_JOB_PLURAL: str = "fournosjobs"
    FOURNOS_K8S_TIMEOUT: int = 30

    # Tekton CRD settings
    TEKTON_API_GROUP: str = "tekton.dev"
    TEKTON_API_VERSION: str = "v1"

    # Forge project discovery
    FORGE_REPO_PATH: Optional[str] = None
    FORGE_PROJECTS_CONFIG_PATH: str = "/etc/fournos-dashboard/projects.yaml"
    FORGE_GITHUB_REPO: str = "openshift-psap/forge"
    # A full unauthenticated refresh consumes several dozen GitHub API calls.
    # Keep this configurable, but default to no more than one cycle per hour.
    GITHUB_SYNC_INTERVAL_SECONDS: int = 60 * 60

    FOURNOS_DEFAULT_PIPELINES: str = "forge-full,forge-prepare-test,forge-test-only,forge-prepare-only,forge-replot,nightly"

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # e.g. LOG_LEVEL, which logger.py reads directly from os.environ


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
os.makedirs(settings.BILLING_CSV_STORAGE_PATH, exist_ok=True)
