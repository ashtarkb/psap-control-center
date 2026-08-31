"""GitHub content API helpers for reading config files out of the Forge repo.

Forge (`openshift-psap/forge`) is a public open-source repository, so this
always reads through the public, unauthenticated GitHub contents API — no
local checkout fallback and no token. Shared by any project plugin that
needs to pull its preset definitions from the Forge repository at runtime.
"""

from __future__ import annotations

import json
import urllib.request

import yaml

from app.core.config import settings


def fetch_yaml(path: str) -> dict:
    """Fetch a single YAML file from the Forge repo and parse it."""
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
