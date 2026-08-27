"""Generic Forge project UI-schema service.

Fetches a project's declarative ``ui/submit.yaml`` from the Forge GitHub repo
(if the project publishes one) and resolves it against that same project's
``presets.d``/``config.d`` files:

- A mode's ``presets_ref`` (usually ``presets.d``) is a shared pool of named
  Forge presets. Each preset is partitioned to whichever declared field's
  ``maps_to`` key it sets. Presets that set two or more fields at once (e.g.
  RHAIIS's compound "quick" presets) are promoted to ``mode.quick_presets``
  instead of becoming a single field's option.
- A field's own ``options_ref`` either builds fresh options from a YAML
  file/directory (when the field has no `presets_ref`-derived options yet),
  or *enriches* existing options with extra display metadata (when it does).

This single, project-agnostic algorithm (including the `matrix`-mode
pipeline expansion below) works identically for every project — RHAIIS
included. Any Forge project opts in the same way: by publishing a
``projects/<name>/ui/submit.yaml`` with the right field ``maps_to``
declarations, no per-project backend code required.
"""

from __future__ import annotations

import asyncio
import logging
import os
import urllib.error
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import yaml

from app.schemas.ui_schema import (
    ProjectUiSchema,
    UiField,
    UiMode,
    UiOption,
    UiOptionsRef,
    UiPipeline,
    UiPipelineModel,
    UiQuickPreset,
)
from app.services.github_content import fetch_yaml, list_yamls

logger = logging.getLogger(__name__)

_cache: Dict[str, Optional[ProjectUiSchema]] = {}


def _schema_path(project: str) -> str:
    return "projects/{}/ui/submit.yaml".format(project)


def _orchestration_path(project: str, relative: str) -> str:
    return "projects/{}/orchestration/{}".format(project, relative.lstrip("/"))


def _titleize(key: str) -> str:
    return key.replace("-", " ").replace("_", " ").strip().title()


def _as_preset_map(path: str, data: object) -> Dict[str, dict]:
    """Interpret one ``presets.d`` YAML file per Forge's own convention
    (``core.library.config.Project.load_presets``): a file with
    ``__multiple: true`` holds several named presets (its other top-level
    keys); otherwise the *whole file* is a single preset, named after its
    filename stem.
    """
    if not isinstance(data, dict):
        return {}
    if data.get("__multiple"):
        return {
            k: v
            for k, v in data.items()
            if isinstance(k, str) and not k.startswith("__") and isinstance(v, dict)
        }
    stem = path.rsplit("/", 1)[-1]
    if stem.endswith(".yaml"):
        stem = stem[: -len(".yaml")]
    return {stem: data}


def _iter_ref_entries(
    project: str, ref: UiOptionsRef, *, as_preset_pool: bool = False
) -> Iterable[Tuple[str, object]]:
    """Yield (key, value) pairs from the file(s) an options ref points at.

    Plain catalog files (the default) are iterated top-level-key-by-key,
    skipping ``__``-prefixed meta keys. Genuine Forge preset pools
    (``ref.preset_pool`` or the caller forcing ``as_preset_pool``, as
    `presets_ref` always does) are parsed with `_as_preset_map` instead.
    """
    pool = as_preset_pool or ref.preset_pool

    if ref.path:
        full_path = _orchestration_path(project, ref.path)
        data = fetch_yaml(full_path)
        if pool:
            yield from _as_preset_map(full_path, data).items()
        elif isinstance(data, dict):
            for key, val in data.items():
                if isinstance(key, str) and not key.startswith("__"):
                    yield key, val
    elif ref.dir:
        for file_path in list_yamls(_orchestration_path(project, ref.dir)):
            data = fetch_yaml(file_path)
            if pool:
                yield from _as_preset_map(file_path, data).items()
            elif isinstance(data, dict):
                for key, val in data.items():
                    if isinstance(key, str) and not key.startswith("__"):
                        yield key, val


# ---------------------------------------------------------------------------
# Mode-level preset partitioning (RHAIIS-style categorization, generalized)
# ---------------------------------------------------------------------------

def _resolve_mode_presets(project: str, mode: UiMode) -> None:
    """Partition a shared pool of named presets (`mode.presets_ref`, usually
    ``presets.d``) across this mode's fields.

    Each preset entry is assigned to whichever single declared field's
    `maps_to` key it contains (becoming one of that field's options, keyed
    by the preset's own name — the value later sent as a CLI arg). An entry
    that sets two or more fields' keys at once is instead promoted to a
    `UiQuickPreset`, generalizing what used to be RHAIIS-only "compound
    preset" detection into a project-agnostic algorithm driven purely by
    each field's declared `maps_to`.
    """
    if mode.presets_ref is None:
        return

    all_fields: List[UiField] = [f for s in mode.sections for f in s.fields]
    maps_to_field: Dict[str, UiField] = {f.maps_to: f for f in all_fields if f.maps_to}
    if not maps_to_field:
        return

    try:
        entries = list(_iter_ref_entries(project, mode.presets_ref, as_preset_pool=True))
    except Exception as exc:
        logger.warning(
            "Failed to resolve presets_ref for %s mode %r: %s", project, mode.id, exc
        )
        return

    # Pass 1: single-dimension presets become options; remember, per field,
    # which preset key produced each raw override value (needed to translate
    # a compound preset's raw value back into a selectable option key below).
    value_to_key: Dict[str, Dict[str, str]] = {}
    compound_candidates: List[Tuple[str, dict, List[UiField]]] = []

    for key, overrides in entries:
        if not isinstance(overrides, dict):
            continue

        matched = [f for mt, f in maps_to_field.items() if mt in overrides]

        if len(matched) >= 2:
            compound_candidates.append((key, overrides, matched))
        elif len(matched) == 1:
            field = matched[0]
            field.options.append(
                UiOption(value=key, label=_titleize(key), overrides=dict(overrides))
            )
            value_to_key.setdefault(field.key, {})[str(overrides[field.maps_to])] = key
        # entries touching none of this mode's declared fields aren't
        # relevant to this UI and are silently skipped.

    # Pass 2: resolve compound presets into quick_presets now that every
    # field's raw-value -> preset-key lookup is complete.
    for key, overrides, matched in compound_candidates:
        fills: Dict[str, object] = {}
        for field in matched:
            raw_val = overrides[field.maps_to]
            fills[field.key] = value_to_key.get(field.key, {}).get(str(raw_val), raw_val)
        leftover = {k: v for k, v in overrides.items() if k not in maps_to_field}
        mode.quick_presets.append(
            UiQuickPreset(key=key, label=_titleize(key), fills=fills, overrides=leftover)
        )


# ---------------------------------------------------------------------------
# Matrix mode: generic pipeline (CPT-style) resolution
# ---------------------------------------------------------------------------

def _parse_matrix_models(raw: object, tp_key: str) -> List[UiPipelineModel]:
    """Normalize a pipeline's model list into [{key, overrides, tp}, ...].

    Accepts either a dict (``{model_key: {overrides..., <tp_key>: N}}``) or a
    plain list of model keys — matching the same shapes RHAIIS's own
    ``__models`` convention already uses.
    """
    models: List[UiPipelineModel] = []
    if isinstance(raw, dict):
        for key, val in raw.items():
            overrides: Dict[str, object] = {}
            tp = None
            if isinstance(val, dict):
                overrides = {k: v for k, v in val.items() if k != tp_key}
                tp = val.get(tp_key)
                if tp is not None:
                    try:
                        tp = int(tp)
                    except (TypeError, ValueError):
                        tp = None
            models.append(
                UiPipelineModel(key=str(key), label=_titleize(str(key)), overrides=overrides, tp=tp)
            )
    elif isinstance(raw, list):
        for key in raw:
            models.append(UiPipelineModel(key=str(key), label=_titleize(str(key))))
    return models


def _resolve_matrix_pipelines(project: str, mode: UiMode) -> None:
    """Scan `mode.presets_ref` for entries tagged with `mode.matrix.marker_key`
    and expand each into a `UiPipeline` — a fully generic stand-in for what
    used to be RHAIIS-only `__cpt` parsing, driven entirely by the marker/
    sub-key names the project itself declares in its `ui/submit.yaml`.
    """
    if mode.matrix is None or mode.presets_ref is None:
        return
    cfg = mode.matrix

    try:
        entries = list(_iter_ref_entries(project, mode.presets_ref, as_preset_pool=True))
    except Exception as exc:
        logger.warning(
            "Failed to resolve matrix pipelines for %s mode %r: %s", project, mode.id, exc
        )
        return

    skip_keys = {cfg.marker_key, cfg.models_key, cfg.workloads_key, cfg.label_key}

    for key, entry in entries:
        if not isinstance(entry, dict) or not entry.get(cfg.marker_key):
            continue
        models = _parse_matrix_models(entry.get(cfg.models_key, []), cfg.tp_key)
        workloads = [str(w) for w in entry.get(cfg.workloads_key, []) or []]
        overrides = {k: v for k, v in entry.items() if k not in skip_keys}
        mode.pipelines.append(
            UiPipeline(
                key=key,
                label=str(entry.get(cfg.label_key) or _titleize(key)),
                models=models,
                workloads=workloads,
                overrides=overrides,
            )
        )


# ---------------------------------------------------------------------------
# Per-field options_ref: build fresh options, or enrich existing ones
# ---------------------------------------------------------------------------

def _build_options_from_ref(project: str, ref: UiOptionsRef) -> List[UiOption]:
    """Build a field's options directly from one file/directory — used for
    fields with no `presets_ref` partitioning, e.g. a project whose
    presets.d files are already scoped one-dimension-per-file (no shared,
    self-tagged pool to partition), or a plain flat preset list.
    """
    options: List[UiOption] = []
    seen = set()
    for key, val in _iter_ref_entries(project, ref):
        if key in seen:
            continue
        seen.add(key)
        value: object = key
        label = key
        overrides: Dict[str, object] = {}
        if isinstance(val, dict):
            if ref.value_field and ref.value_field in val:
                value = val[ref.value_field]
            if ref.label_field and ref.label_field in val:
                label = val[ref.label_field]
            overrides = {k: v for k, v in val.items() if k != "extends"}
        options.append(UiOption(value=str(value), label=str(label), overrides=overrides))
    return options


def _enrich_options_with_ref(project: str, field: UiField, ref: UiOptionsRef) -> None:
    lookup: Dict[str, dict] = {}
    for key, val in _iter_ref_entries(project, ref):
        if isinstance(val, dict):
            lookup[key] = val

    for option in field.options:
        join_val = option.value
        if ref.join_key:
            join_val = str(option.overrides.get(ref.join_key, option.value))
        data = lookup.get(join_val)
        if not data:
            continue
        if ref.label_field and ref.label_field in data:
            option.label = str(data[ref.label_field])
        option.extra = dict(data)


def _resolve_field_options_ref(project: str, field: UiField) -> None:
    ref = field.options_ref
    if ref is None:
        return
    try:
        if field.options:
            _enrich_options_with_ref(project, field, ref)
        else:
            field.options = _build_options_from_ref(project, ref)
    except Exception as exc:
        logger.warning(
            "Failed to resolve options_ref for %s field %r: %s", project, field.key, exc
        )


def _resolve_schema(project: str, schema: ProjectUiSchema) -> ProjectUiSchema:
    for mode in schema.modes:
        _resolve_mode_presets(project, mode)
        if mode.kind == "matrix":
            _resolve_matrix_pipelines(project, mode)
        for section in mode.sections:
            for field in section.fields:
                _resolve_field_options_ref(project, field)
    return schema


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _load_local_override(project: str) -> Optional[dict]:
    """Dev-only escape hatch: if UI_SCHEMA_LOCAL_DIR is set, load
    ``<dir>/<project>.yaml`` from disk instead of fetching from GitHub — for
    trying out a draft ``ui/submit.yaml`` locally before it's published to
    the Forge repo. Unset by default; has no effect in normal operation.
    """
    local_dir = os.environ.get("UI_SCHEMA_LOCAL_DIR", "")
    if not local_dir:
        return None
    path = Path(local_dir) / "{}.yaml".format(project)
    if not path.is_file():
        return None
    try:
        with open(path) as f:
            return yaml.safe_load(f)
    except Exception as exc:
        logger.warning("Failed to load local ui/submit.yaml override for %s: %s", project, exc)
        return None


def fetch_schema(project: str) -> Optional[ProjectUiSchema]:
    """Fetch + resolve a project's ui/submit.yaml. Returns None if the
    project hasn't published one (or it's invalid).
    """
    raw = _load_local_override(project)

    if raw is None:
        try:
            raw = fetch_yaml(_schema_path(project))
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                logger.error("Failed to fetch ui/submit.yaml for %s: %s", project, exc)
            return None
        except Exception as exc:
            logger.error("Failed to fetch ui/submit.yaml for %s: %s", project, exc)
            return None

    if not raw:
        return None

    try:
        schema = ProjectUiSchema.model_validate(raw)
    except Exception as exc:
        logger.error("Invalid ui/submit.yaml for %s: %s", project, exc)
        return None

    return _resolve_schema(project, schema)


async def get_schema(project: str) -> Optional[ProjectUiSchema]:
    """Return the cached schema for a project, fetching it on first use."""
    if project not in _cache:
        _cache[project] = await asyncio.to_thread(fetch_schema, project)
    return _cache[project]


async def refresh_schema(project: str) -> Optional[ProjectUiSchema]:
    """Force-refresh the cached ui/submit.yaml for a project from GitHub."""
    _cache.pop(project, None)
    return await get_schema(project)
