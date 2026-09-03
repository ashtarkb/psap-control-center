"""GitHub content helpers backed by one shared Forge repository snapshot.

Directory traversal through GitHub's Contents API costs one REST request for
every directory and file. A complete Control Center refresh used to consume
almost the entire 60-request anonymous hourly allowance before it resolved a
single ``ui/submit.yaml`` reference. Instead, this module resolves the target
commit and downloads its recursive Git tree once. Directory lookups are then
served locally and YAML blobs are read from ``raw.githubusercontent.com`` at
that immutable commit.

The snapshot is replaced atomically only after both API responses validate,
so a failed refresh leaves the last-known-good tree available to readers.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from threading import Lock
from typing import Dict, Optional

import yaml

from app.core.config import settings


@dataclass(frozen=True)
class RepositorySnapshot:
    commit_sha: str
    entries: Dict[str, str]


_snapshot: Optional[RepositorySnapshot] = None
_snapshot_lock = Lock()


def _api_headers() -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "psap-control-center",
    }
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = "Bearer {}".format(settings.GITHUB_TOKEN)
    return headers


def _api_json(endpoint: str) -> object:
    url = "https://api.github.com/repos/{}/{}".format(
        settings.FORGE_GITHUB_REPO, endpoint
    )
    req = urllib.request.Request(url, headers=_api_headers())
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _load_snapshot() -> RepositorySnapshot:
    encoded_ref = urllib.parse.quote(settings.FORGE_GITHUB_REF, safe="")
    commit = _api_json("commits/{}".format(encoded_ref))
    if not isinstance(commit, dict) or not commit.get("sha"):
        raise RuntimeError("GitHub returned no commit for Forge ref")
    commit_sha = str(commit["sha"])

    tree = _api_json("git/trees/{}?recursive=1".format(commit_sha))
    if not isinstance(tree, dict) or not isinstance(tree.get("tree"), list):
        raise RuntimeError("GitHub returned an invalid Forge repository tree")
    if tree.get("truncated"):
        raise RuntimeError("GitHub truncated the Forge repository tree")

    entries = {
        str(item["path"]).strip("/"): str(item.get("type", ""))
        for item in tree["tree"]
        if isinstance(item, dict) and item.get("path")
    }
    if not entries:
        raise RuntimeError("GitHub returned an empty Forge repository tree")
    return RepositorySnapshot(commit_sha=commit_sha, entries=entries)


def refresh_snapshot() -> RepositorySnapshot:
    """Fetch and atomically publish a new repository snapshot."""
    global _snapshot
    with _snapshot_lock:
        refreshed = _load_snapshot()
        _snapshot = refreshed
        return refreshed


def ensure_snapshot() -> RepositorySnapshot:
    """Return the current snapshot, lazily loading it on a cold process."""
    global _snapshot
    if _snapshot is not None:
        return _snapshot
    with _snapshot_lock:
        if _snapshot is None:
            _snapshot = _load_snapshot()
        return _snapshot


def _raw_url(snapshot: RepositorySnapshot, path: str) -> str:
    return "https://raw.githubusercontent.com/{}/{}/{}".format(
        settings.FORGE_GITHUB_REPO,
        snapshot.commit_sha,
        urllib.parse.quote(path.strip("/"), safe="/"),
    )


def _raise_not_found(snapshot: RepositorySnapshot, path: str) -> None:
    raise urllib.error.HTTPError(
        _raw_url(snapshot, path), 404, "Not Found", hdrs=None, fp=None
    )


def fetch_yaml(path: str) -> dict:
    """Fetch a YAML blob from the immutable commit in the current snapshot."""
    snapshot = ensure_snapshot()
    normalized = path.strip("/")
    if snapshot.entries.get(normalized) != "blob":
        _raise_not_found(snapshot, normalized)

    raw_req = urllib.request.Request(
        _raw_url(snapshot, normalized), headers={"User-Agent": "psap-control-center"}
    )
    with urllib.request.urlopen(raw_req, timeout=15) as resp:
        return yaml.safe_load(resp.read()) or {}


def list_yamls(directory: str) -> list:
    """List direct ``.yaml`` children of a Forge repo directory."""
    snapshot = ensure_snapshot()
    normalized = directory.strip("/")
    if snapshot.entries.get(normalized) != "tree":
        _raise_not_found(snapshot, normalized)
    prefix = normalized + "/"
    return sorted(
        path
        for path, entry_type in snapshot.entries.items()
        if entry_type == "blob"
        and path.startswith(prefix)
        and "/" not in path[len(prefix):]
        and path.endswith(".yaml")
    )


def list_dirs(directory: str) -> list:
    """List subdirectory names (not full paths) directly under a Forge
    repo directory. Used for project discovery — every top-level entry
    under ``projects/`` is a Forge project.
    """
    snapshot = ensure_snapshot()
    normalized = directory.strip("/")
    if snapshot.entries.get(normalized) != "tree":
        _raise_not_found(snapshot, normalized)
    prefix = normalized + "/"
    return sorted(
        path[len(prefix):]
        for path, entry_type in snapshot.entries.items()
        if entry_type == "tree"
        and path.startswith(prefix)
        and "/" not in path[len(prefix):]
    )


def path_exists(path: str) -> bool:
    """Check whether a file or directory exists in the Forge repo."""
    return path.strip("/") in ensure_snapshot().entries
