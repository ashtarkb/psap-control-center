"""Discover Forge projects, presets, and config schemas."""

from __future__ import annotations

import logging
import urllib.error
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

from app.core.config import settings
from app.services.github_content import fetch_yaml, list_dirs, list_yamls, path_exists

logger = logging.getLogger(__name__)


class ProjectInfo:
    def __init__(
        self,
        name: str,
        cluster: str = "",
        presets: Optional[List[str]] = None,
        config_keys: Optional[List[str]] = None,
        has_cli: bool = False,
    ):
        self.name = name
        self.cluster = cluster
        self.presets = presets or []
        self.config_keys = config_keys or []
        self.has_cli = has_cli


_cache: Optional[Dict[str, ProjectInfo]] = None

# Forge projects that exist but shouldn't show up as selectable in the
# Control Center's Testing UI (internal tooling, deprecated, etc). This is
# an explicit blocklist, not a whitelist — anything new added to Forge
# still shows up automatically unless it's named here.
EXCLUDED_PROJECTS = {
    "caliper",
    "foreign_testing",
    "fournos_launcher",
    "jump_ci",
    "llm_d_legacy",
}


def _forge_projects_dir() -> Optional[Path]:
    if settings.FORGE_REPO_PATH:
        p = Path(settings.FORGE_REPO_PATH) / "projects"
        if p.is_dir():
            return p
    return None


def discover_projects(
    force_refresh: bool = False, strict: bool = False
) -> List[ProjectInfo]:
    global _cache
    if _cache is not None and not force_refresh:
        return list(_cache.values())

    result: Dict[str, ProjectInfo] = {}

    # Local Forge checkout (dev convenience, e.g. FORGE_REPO_PATH pointing
    # at a cloned repo mounted into the container) takes priority if set.
    projects_dir = _forge_projects_dir()
    if projects_dir is not None:
        result = _discover_from_repo(projects_dir)

    # Production default: list `projects/` straight from the Forge GitHub
    # repo, so nothing needs to be manually kept in sync — same mechanism
    # already used to fetch each project's ui/submit.yaml.
    if not result:
        result = _discover_from_github(strict=strict)

    # Last-resort manual override (e.g. GitHub is unreachable from this
    # cluster's network) via a mounted ConfigMap.
    if not result:
        result = _discover_from_configmap()

    for name in EXCLUDED_PROJECTS:
        result.pop(name, None)

    if result:
        _cache = result
    elif _cache is None:
        # Every discovery path failed (e.g. GitHub rate-limited) and there's
        # nothing previously cached to fall back to. Deliberately leave
        # _cache as None rather than caching this empty result, so the next
        # call retries instead of permanently returning an empty list.
        logger.warning("Forge project discovery failed; will retry next call")
    else:
        # Keep serving the last known-good list rather than clobbering it
        # with a transient empty result.
        logger.warning(
            "Forge project discovery failed; serving %d previously cached projects",
            len(_cache),
        )

    logger.info("Discovered %d Forge projects", len(result))
    return list(_cache.values()) if _cache else []


def _discover_from_repo(projects_dir: Path) -> Dict[str, ProjectInfo]:
    result: Dict[str, ProjectInfo] = {}
    skip = {"core", "__pycache__"}

    for proj_dir in sorted(projects_dir.iterdir()):
        if (
            not proj_dir.is_dir()
            or proj_dir.name.startswith(".")
            or proj_dir.name in skip
        ):
            continue

        orchestration = proj_dir / "orchestration"
        if not orchestration.is_dir():
            continue

        presets = _load_presets(orchestration)
        config_keys = _load_config_keys(orchestration)
        has_cli = (orchestration / "cli.py").exists()

        result[proj_dir.name] = ProjectInfo(
            name=proj_dir.name,
            presets=presets,
            config_keys=config_keys,
            has_cli=has_cli,
        )

    return result


def _discover_from_github(strict: bool = False) -> Dict[str, ProjectInfo]:
    skip = {"core", "__pycache__"}
    try:
        names = list_dirs("projects")
    except Exception as exc:
        if strict:
            raise
        logger.warning("Failed to list Forge projects from GitHub: %s", exc)
        return {}

    result: Dict[str, ProjectInfo] = {}
    for name in names:
        # Check EXCLUDED_PROJECTS *before* making any per-project GitHub
        # calls below — these are thrown away regardless, so fetching
        # their metadata first only wastes GitHub's unauthenticated rate
        # limit (shared across the whole deployment) on nothing.
        if name.startswith(".") or name in skip or name in EXCLUDED_PROJECTS:
            continue
        if not _has_orchestration_dir(name, strict=strict):
            continue
        presets, config_keys, has_cli = _load_project_metadata_from_github(
            name, strict=strict
        )
        result[name] = ProjectInfo(
            name=name,
            presets=presets,
            config_keys=config_keys,
            has_cli=has_cli,
        )

    return result


def _has_orchestration_dir(name: str, strict: bool = False) -> bool:
    """Whether `projects/<name>/orchestration` exists in the Forge repo.

    Fails *open* (assumes it exists) on anything other than a confirmed
    404 — a transient GitHub API error (rate limit, timeout, ...) should
    not silently drop a real project from the list. A clean 404 is the
    only case that actually excludes it.
    """
    try:
        return path_exists("projects/{}/orchestration".format(name))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        if strict:
            raise
        logger.warning("Could not check projects/%s/orchestration: %s", name, exc)
        return True
    except Exception as exc:
        if strict:
            raise
        logger.warning("Could not check projects/%s/orchestration: %s", name, exc)
        return True


def _load_project_metadata_from_github(
    name: str, strict: bool = False
) -> Tuple[List[str], List[str], bool]:
    """Best-effort enrichment for the legacy generic preset form (used as
    a fallback for projects that haven't published a ui/submit.yaml yet).
    Each lookup is independently swallowed on failure — a project should
    still show up in the dropdown even if, say, it has no presets.d.
    """
    base = "projects/{}/orchestration".format(name)

    presets: List[str] = []
    try:
        preset_files = list_yamls("{}/presets.d".format(base))
    except urllib.error.HTTPError as exc:
        if exc.code != 404 and strict:
            raise
        preset_files = []
    except Exception:
        if strict:
            raise
        preset_files = []
    for preset_file in preset_files:
        try:
            data = fetch_yaml(preset_file)
            if isinstance(data, dict):
                presets.extend(data.keys())
        except Exception:
            if strict:
                raise

    config_keys: List[str] = []
    try:
        config_files = list_yamls("{}/config.d".format(base))
    except urllib.error.HTTPError as exc:
        if exc.code != 404 and strict:
            raise
        config_files = []
    except Exception:
        if strict:
            raise
        config_files = []
    config_keys = [Path(cfg_file).stem for cfg_file in config_files]

    try:
        has_cli = path_exists("{}/cli.py".format(base))
    except Exception:
        if strict:
            raise
        has_cli = False

    return presets, config_keys, has_cli


def _discover_from_configmap() -> Dict[str, ProjectInfo]:
    config_path = Path(settings.FORGE_PROJECTS_CONFIG_PATH)
    if not config_path.exists():
        logger.debug("No projects config at %s", config_path)
        return {}

    try:
        with open(config_path) as f:
            data = yaml.safe_load(f)
    except Exception as exc:
        logger.error("Failed to parse projects config: %s", exc)
        return {}

    if not isinstance(data, dict) or "projects" not in data:
        logger.warning("Projects config missing 'projects' key")
        return {}

    result: Dict[str, ProjectInfo] = {}
    for proj in data["projects"]:
        if not isinstance(proj, dict):
            continue
        name = proj.get("name", "")
        if not name:
            continue
        result[name] = ProjectInfo(
            name=name,
            cluster=proj.get("cluster", ""),
            presets=proj.get("presets", []),
            config_keys=proj.get("config_keys", []),
            has_cli=proj.get("has_cli", False),
        )

    logger.info("Loaded %d projects from ConfigMap", len(result))
    return result


def get_project(name: str) -> Optional[ProjectInfo]:
    projects = discover_projects()
    return next((p for p in projects if p.name == name), None)


def _load_presets(orchestration_dir: Path) -> List[str]:
    presets_dir = orchestration_dir / "presets.d"
    if not presets_dir.is_dir():
        return []

    preset_names: List[str] = []
    for yaml_file in sorted(presets_dir.glob("*.yaml")):
        try:
            with open(yaml_file) as f:
                data = yaml.safe_load(f)
            if isinstance(data, dict):
                preset_names.extend(data.keys())
        except Exception:
            pass
    return preset_names


def _load_config_keys(orchestration_dir: Path) -> List[str]:
    keys: List[str] = []

    config_file = orchestration_dir / "config.yaml"
    if config_file.exists():
        try:
            with open(config_file) as f:
                data = yaml.safe_load(f)
            if isinstance(data, dict):
                keys.extend(data.keys())
        except Exception:
            pass

    config_d = orchestration_dir / "config.d"
    if config_d.is_dir():
        for yaml_file in sorted(config_d.glob("*.yaml")):
            keys.append(yaml_file.stem)

    return keys
