"""Pydantic models for the Forge project UI schema contract.

Any Forge project can publish a declarative ``projects/<name>/ui/submit.yaml``
file in the Forge repo describing what fields the Control Center should render
on its submit form, and which submission key each field's value maps to. This
lets the Control Center render a fully dynamic form for *any* project from one
shared fetch/render pipeline, instead of hand-rolling a bespoke form per
project (as was previously done for RHAIIS alone).

See docs/ui-schema-spec.md for the full authoring guide.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

# Field types understood by the generic frontend renderer.
FIELD_TYPES = {
    "text",
    "textarea",
    "number",
    "boolean",
    "select",
    "multiselect",
    "radio",
    "hidden",
}


class UiOption(BaseModel):
    """One selectable choice for a select/radio/multiselect field.

    `value` is the underlying Forge preset's own key (e.g. ``h200`` or
    ``llama3-70b``) — for a field with no `maps_to`, this is exactly what
    gets sent to Forge as a CLI arg on submit (Forge resolves the preset
    itself; the Control Center never re-implements preset resolution).
    `overrides` is the preset's raw contents purely for UI display (e.g. a
    hover tooltip) — it is not merged into the submission.
    """

    value: str
    label: str = ""
    overrides: Dict[str, Any] = Field(default_factory=dict)
    # Sidecar metadata copied in from an enrichment `options_ref` lookup
    # (e.g. a model's GPU count, a cluster's GPU type) for the frontend to
    # use for display or derived defaults — never sent back on submit.
    extra: Dict[str, Any] = Field(default_factory=dict)


class UiOptionsRef(BaseModel):
    """Dynamically source select/multiselect options from another YAML file
    that already exists in this project's Forge orchestration directory,
    instead of duplicating data by hand in submit.yaml.

    Paths are relative to ``projects/<project>/orchestration/``, e.g.
    ``config.d/models.yaml`` or ``presets.d`` (a whole directory).

    When a field's options were already populated by the mode's
    `presets_ref` partitioning, an `options_ref` instead *enriches* those
    existing options (matching on `join_key`, or the option's own value if
    unset) rather than replacing them.
    """

    path: Optional[str] = None
    dir: Optional[str] = None
    label_field: Optional[str] = None
    value_field: Optional[str] = None
    join_key: Optional[str] = None
    # Set this when `path`/`dir` point at genuine Forge `presets.d` files, so
    # they're parsed with Forge's own preset convention (see
    # `core.library.config.Project.load_presets`): a file with
    # `__multiple: true` holds several named presets; otherwise the whole
    # file is a single preset named after its filename. Leave unset (False)
    # for plain catalog files like `config.d/models.yaml`, where every
    # top-level key is simply its own entry.
    preset_pool: bool = False


class UiVisibleIf(BaseModel):
    """Show this field only when another field currently has a matching value."""

    field: str
    equals: Optional[Any] = None
    one_of: Optional[List[Any]] = None


class UiField(BaseModel):
    """One form field. Only declare fields that are specific to this
    project — cluster, pipeline, owner, priority, exclusive, and the PR
    picker are always rendered by the surrounding form and don't need (or
    want) to be redeclared here.

    Two distinct submission behaviors, inferred structurally (no separate
    "kind" flag to author):

    - No `maps_to`, type is select/radio/multiselect: an *arg field*. Its
      options are named Forge presets; the selected option's `value` is
      appended to the job's `args` list on submit, same as the existing
      generic "Preset" dropdown already does today.
    - `maps_to` set: an *override field* (any type). Its value is written
      to `config_overrides[maps_to]` on submit — used for plain settings
      like a version string or a boolean toggle that isn't itself a preset.
    """

    key: str
    label: str = ""
    type: str = "text"
    required: bool = False
    default: Optional[Any] = None
    help: str = ""
    placeholder: str = ""
    maps_to: Optional[str] = None
    options: List[UiOption] = Field(default_factory=list)
    options_ref: Optional[UiOptionsRef] = None
    visible_if: Optional[UiVisibleIf] = None
    min: Optional[float] = None
    max: Optional[float] = None


class UiSection(BaseModel):
    id: str
    label: str = ""
    fields: List[UiField] = Field(default_factory=list)


class UiQuickPreset(BaseModel):
    """A named preset (from `presets_ref`) whose keys touch two or more
    declared arg-fields at once — e.g. a compound preset that sets
    accelerator + engine + model together. On selection, the frontend should
    push this preset's own `key` as a single arg (Forge resolves it), and
    additionally set each field named in `fills` to the given value so the
    UI reflects the choice (mirroring how a compound preset already
    "fills in" the model/workload/settings fields today). `overrides` holds
    any remaining raw keys (e.g. a pinned version) not owned by a field,
    for informational display and/or direct config_overrides use.
    Populated automatically by the backend; never authored by hand.
    """

    key: str
    label: str = ""
    fills: Dict[str, Any] = Field(default_factory=dict)  # field key -> value to select
    overrides: Dict[str, Any] = Field(default_factory=dict)  # leftover keys not owned by any field


class UiMatrixConfig(BaseModel):
    """Declares how to recognize and parse pipeline-style presets within a
    matrix mode's `presets_ref` pool — e.g. RHAIIS's own convention of
    tagging a preset entry with `__cpt: true` and listing `__models` /
    `__workloads` to matrix over. The marker/sub-key *names* are
    project-configurable so this stays a fully generic mechanism; a
    different project could reuse this exact convention, or its own.
    """

    marker_key: str = "__cpt"
    models_key: str = "__models"
    workloads_key: str = "__workloads"
    label_key: str = "__description"
    tp_key: str = "__tp"


class UiPipelineModel(BaseModel):
    key: str
    label: str = ""
    overrides: Dict[str, Any] = Field(default_factory=dict)
    tp: Optional[int] = None


class UiPipeline(BaseModel):
    """One resolved matrix pipeline: a named preset (tagged with
    `UiMatrixConfig.marker_key`) that expands into one job per model ×
    the selected workloads. Populated automatically by the backend from
    `mode.presets_ref`; never authored by hand.
    """

    key: str
    label: str = ""
    models: List[UiPipelineModel] = Field(default_factory=list)
    workloads: List[str] = Field(default_factory=list)
    overrides: Dict[str, Any] = Field(default_factory=dict)


class UiMode(BaseModel):
    """A distinct submission flow for a project, e.g. 'Single Job' vs
    'CPT Pipeline'. Most projects will only need one, default mode.
    """

    id: str
    label: str = ""
    default: bool = False
    kind: str = "form"  # "form" (flat field sections) | "matrix" (pipeline/CPT-style)
    # A shared pool of named Forge presets (usually `presets.d`). Each entry
    # is partitioned to whichever declared field's `maps_to` it sets; entries
    # that set 2+ fields at once are promoted to `quick_presets` instead.
    # In a matrix mode, the same pool is also scanned for pipeline entries
    # (see `matrix` below) — the two mechanisms compose, so a matrix mode can
    # still have ordinary shared fields (e.g. accelerator/engine) alongside
    # its resolved `pipelines`.
    presets_ref: Optional[UiOptionsRef] = None
    sections: List[UiSection] = Field(default_factory=list)
    quick_presets: List[UiQuickPreset] = Field(default_factory=list)
    # matrix-mode only (kind == "matrix")
    matrix: Optional[UiMatrixConfig] = None
    pipelines: List[UiPipeline] = Field(default_factory=list)
    dimensions: List[str] = Field(default_factory=list)


class ProjectUiSchema(BaseModel):
    schema_version: int = 1
    project: str = ""
    title: str = ""
    description: str = ""
    defaults: Dict[str, Any] = Field(default_factory=dict)
    modes: List[UiMode] = Field(default_factory=list)


class ProjectUiSchemaResponse(BaseModel):
    found: bool
    project: str
    ui_schema: Optional[ProjectUiSchema] = None
