"""GitHub content API helpers for reading config files out of the Forge repo.

If `settings.FORGE_REPO_PATH` points at a local Forge checkout (the same
setting `forge_discovery.py` already uses for project discovery), files are
read straight off disk — faster, and avoids the public GitHub contents
API's unauthenticated 60/hour rate limit entirely. Otherwise falls back to
that public, unauthenticated API — no token required. Shared by any project
plugin that needs to pull its preset definitions from the Forge repository
at runtime.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Optional

import yaml

from app.core.config import settings


def _local_repo_path(relative: str) -> Optional[Path]:
    if not settings.FORGE_REPO_PATH:
        return None
    path = Path(settings.FORGE_REPO_PATH) / relative
    return path if path.exists() else None


def fetch_yaml(path: str) -> dict:
    """Fetch a single YAML file from the Forge repo and parse it."""
    local = _local_repo_path(path)
    if local is not None:
        with open(local) as f:
            return yaml.safe_load(f) or {}

    url = "https://api.github.com/repos/{}/contents/{}".format(
        settings.FORGE_GITHUB_REPO, path
    )
    req = urllib.request.Request(
        url, headers={"Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        meta = json.loads(resp.read())

    download_url = meta.get("download_url", "")
    if not download_url:
        return {}

    raw_req = urllib.request.Request(download_url)
    with urllib.request.urlopen(raw_req, timeout=15) as resp:
        return yaml.safe_load(resp.read()) or {}


def list_yamls(directory: str) -> list:
    """List .yaml file paths in a Forge repo directory."""
    local = _local_repo_path(directory)
    if local is not None:
        return sorted(str(p) for p in local.glob("*.yaml"))

    url = "https://api.github.com/repos/{}/contents/{}".format(
        settings.FORGE_GITHUB_REPO, directory
    )
    req = urllib.request.Request(
        url, headers={"Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        items = json.loads(resp.read())

    return sorted(
        item["path"]
        for item in items
        if isinstance(item, dict) and item.get("name", "").endswith(".yaml")
    )
