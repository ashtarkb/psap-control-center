# Forge project UI schema (`ui/submit.yaml`)

This document specifies a convention that lets any Forge project declare its
own Control Center submit form, instead of the Control Center hand-rolling a
bespoke form per project (as was previously done for RHAIIS alone).

## Where it lives

Each Forge project may publish:

```
projects/<name>/ui/submit.yaml
```

in the `openshift-psap/forge` repo. The Control Center fetches it over the
public GitHub contents API (same mechanism already used for RHAIIS's config,
see `backend/app/services/github_content.py`) via:

```
GET /fournos/projects/{project_name}/ui-schema
POST /fournos/projects/{project_name}/ui-schema/refresh   (force-refresh cache)
```

A project with no `ui/submit.yaml` simply gets `{"found": false, ...}` back —
the Control Center falls back to today's generic preset-dropdown form for
that project. This is an additive, opt-in convention.

## Design principle: the Control Center never resolves presets itself

Forge's own orchestration layer is the only thing that knows how to resolve
a named preset (including composition features like `extends`). The Control
Center's job is only to **render fields and collect a preset key / raw
value per field** — exactly like the existing generic "Preset" dropdown
already does today (it just passes the selected preset name through as a
CLI arg). `ui/submit.yaml` generalizes that same idea to multiple fields.

Concretely, every field is one of two kinds, inferred structurally (no
separate `kind` flag to author):

- **Arg field** — no `maps_to`, type `select` / `radio` / `multiselect`.
  Options are named Forge presets (their own dict key in `presets.d` or a
  `config.d` file). On submit, the selected option's `value` is appended to
  the job's `args` list, in field declaration order — the same list the
  existing `SubmitJobRequest.preset` already becomes today.
- **Override field** — `maps_to` is set (any type: text/number/boolean/
  hidden, or even select without preset semantics). On submit, its value is
  written directly to `config_overrides[maps_to]`. Use this for plain
  settings that aren't themselves a named preset (a version string, a
  warmup/profiler toggle, a free-form JSON overrides blob).

## Top-level shape

```yaml
schema_version: 1
project: rhaiis          # informational; should match the directory name
title: RHAIIS
description: "..."       # optional

modes:
  - id: single
    label: Single Job
    default: true
    ...
  - id: cpt
    label: CPT Pipeline
    kind: matrix
    ...
```

Most projects only need one `mode`. A `mode` with `kind: matrix` signals an
advanced, multi-job pipeline flow (RHAIIS's CPT pipeline) that the generic
renderer treats specially — see "Matrix / CPT mode" below.

## Fields and sections

```yaml
sections:
  - id: infra
    label: Infrastructure
    fields:
      - key: accelerator
        label: Accelerator
        type: radio
        required: true
      - key: version
        label: RHAIIS Version
        type: text
        maps_to: tests.rhaiis.version
        placeholder: main
```

Field properties:

| Property      | Meaning                                                                 |
|---------------|--------------------------------------------------------------------------|
| `key`         | Unique within the mode. Also the name used in `UiQuickPreset.fills`.    |
| `label`       | Display label.                                                          |
| `type`        | `text \| textarea \| number \| boolean \| select \| multiselect \| radio \| hidden` |
| `required`    | Client-side validation hint.                                            |
| `default`     | Default value.                                                          |
| `help`        | Optional helper text under the field.                                   |
| `placeholder` | Optional input placeholder.                                             |
| `maps_to`     | If set, makes this an *override field* (see above).                    |
| `options`     | Static inline options (mutually exclusive with `options_ref`, or additive to whatever `presets_ref` partitioning already produced). |
| `options_ref` | Dynamically source options from another file in this project — see below. |
| `visible_if`  | `{field, equals}` or `{field, one_of}` — conditional visibility.        |
| `restrict_if` | List of `{when: {field, equals\|one_of}, exclude_values: [...]}` — drop some of *this* field's own options when another field currently matches. |
| `min` / `max` | For `type: number`.                                                     |

Only declare fields that are specific to this project. Cluster, pipeline,
owner, priority, exclusive, and the PR picker are always rendered by the
surrounding form (exactly like the existing generic form and RHAIIS's own
form both already do) — don't redeclare them here. Watch for a project
preset that merely *tags* something for its own reporting/dashboard
purposes (e.g. RHAIIS's `cluster_tag`, which only labels results and has no
effect on where the job runs) — those add confusing noise next to the real
cluster-name field and are usually best left out of the form entirely
rather than relabeled.

## Sourcing options dynamically: `options_ref`

Instead of duplicating preset names by hand, a field can point at a real
Forge config file, relative to `projects/<name>/orchestration/`:

```yaml
options_ref:
  dir: presets.d          # every *.yaml file in a directory — OR
  path: config.d/models.yaml   # a single file
  label_field: name        # optional: use entry[name] as the option label
  value_field: null         # optional: use entry[value_field] as the value (default: the YAML key)
  join_key: tests.rhaiis.model_key   # see "enrichment" below
  preset_pool: false        # set true when pointing at genuine presets.d files (see below)
```

**`preset_pool`** matters because Forge itself (`core.library.config.Project.load_presets`)
interprets a `presets.d` file two different ways depending on a marker key:

- A file with `__multiple: true` holds several named presets — its other
  top-level keys are the preset names (e.g. RHAIIS's `presets.d/presets.yaml`).
- A file **without** `__multiple` is a single preset, named after the
  file's own filename (e.g. skeleton's `presets.d/deep_testing.yaml` is one
  preset called `deep_testing`, not several presets named after its keys).

Set `preset_pool: true` whenever `options_ref` points at real `presets.d`
files (as most of `llm_d`'s per-dimension fields do) so this convention is
respected. Leave it `false` (default) for plain catalog files like
`config.d/models.yaml`, where every top-level key genuinely is its own
entry. A mode's `presets_ref` (below) is always treated as a preset pool
automatically.

There are two distinct uses, chosen automatically based on whether the field
already has options:

1. **Build fresh options** (field has no options yet) — every top-level key
   in the referenced file/directory becomes one option. This is the common
   case for projects whose `presets.d` is already split one-dimension-per-file
   (e.g. `llm_d`'s `models.yaml`, `cluster_config.yaml`, `benchmarks.yaml`).
2. **Enrich existing options** (field already has options — see
   `presets_ref` below) — look up each existing option by `join_key` (or by
   the option's own value if `join_key` is unset) in the referenced file,
   and copy in a nicer `label` and the full matched entry as `extra`
   (informational; e.g. a model's GPU/TP metadata). This is how RHAIIS's
   `model` field gets a human-readable name from `config.d/models.yaml`
   even though its options were produced from `presets.d`.

## Cross-field compatibility constraints: `restrict_if`

`visible_if` hides/shows a whole field. `restrict_if` is the narrower
sibling: it drops *some* of a field's own options — whatever their
source (`options`, `options_ref`, or a shared `presets_ref` pool) — while
another field currently has a matching value. Use it for real
hardware/software compatibility constraints, e.g. an engine that doesn't
support one of the accelerators:

```yaml
- key: accelerator
  label: Accelerator
  type: radio
  required: true
  maps_to: rhaiis.accelerator
  restrict_if:
    - when: {field: engine, equals: trtllm}
      exclude_values: [amd]
```

Each rule's `when` takes the same shape as `visible_if` (`{field, equals}`
or `{field, one_of}`). Multiple rules may target the same field; every
matching rule's `exclude_values` are unioned. If the field's
currently-selected value is excluded by a newly-matching rule (e.g. the
user just switched `engine` to `trtllm` while `accelerator: amd` was
already selected), the frontend clears that field's selection so a stale,
now-invalid combination is never submitted.

A real compatibility constraint is symmetric, so declare it on **both**
fields, each referencing the other — `restrict_if` only prunes the field
it's declared on, it doesn't infer the reverse direction automatically:

```yaml
- key: accelerator
  ...
  restrict_if:
    - when: {field: engine, equals: trtllm}
      exclude_values: [amd]
- key: engine
  ...
  restrict_if:
    - when: {field: accelerator, equals: amd}
      exclude_values: [trtllm]
```

## Sourcing a *shared* pool of self-tagged presets: `presets_ref`

Some projects (RHAIIS) keep every dimension's presets mixed together in the
same `presets.d` files, distinguished only by which override key each entry
happens to set (`rhaiis.accelerator`, `tests.rhaiis.model_key`, ...). For
this case, declare the shared pool once at the **mode** level:

```yaml
modes:
  - id: single
    presets_ref:
      dir: presets.d
    sections:
      - id: infra
        fields:
          - {key: accelerator, type: radio, maps_to: rhaiis.accelerator}
          - {key: engine, type: select, maps_to: rhaiis.engine}
      - id: model
        fields:
          - {key: model, type: select, maps_to: tests.rhaiis.model_key}
          - {key: workload, type: multiselect, maps_to: tests.rhaiis.workload_key}
```

The backend partitions every entry in the shared pool to whichever single
field's `maps_to` key it contains (becoming that field's option, keyed by
the preset's own name). An entry that sets **two or more** fields' keys at
once (a compound/"quick" preset) is instead promoted to `mode.quick_presets`
— this generalizes what used to be RHAIIS-only hardcoded categorization
(`_CATEGORY_KEYS` in `rhaiis_project.py`) into an algorithm driven purely by
each project's declared `maps_to` values. No Python code changes are needed
to onboard a new project with this convention — only the YAML.

Note: `maps_to` here doubles as the partitioning key *and* as the normal
override-field behavior described above — the selected preset's own key
(e.g. `nvidia`) is written directly to `config_overrides[maps_to]` (e.g.
`rhaiis.accelerator: nvidia`), it is **not** additionally pushed to `args`.
For every preset RHAIIS currently defines this way (accelerator, engine,
model, workload are each single-key presets), that's functionally
identical to what Forge's own resolution of that preset key would do. If a
future preset partitioned this way ever needs to set more than the one
`maps_to` key, promote it to a real `options_ref`-only arg field (no
`maps_to`) instead so Forge resolves it in full.

### Quick presets

```json
{
  "key": "h200-vllm-smoke",
  "label": "H200 Vllm Smoke",
  "fills": {"model": "llama3-70b", "workload": "chat-1k"},
  "overrides": {"tests.rhaiis.version": "v1.2.3"}
}
```

On selection, the frontend should:

1. Push the quick preset's own `key` as one arg.
2. Set each field named in `fills` to the given value (so the UI reflects
   the choice, and so that field's own value is *also* included in `args`
   if it's an arg field — mirroring today's behavior where selecting a
   compound preset still pushes the individually-filled model/workload
   alongside the compound key itself).
3. Apply `overrides` (leftover keys not owned by any field) directly into
   `config_overrides`.

## Matrix / CPT mode

A `kind: matrix` mode expands into **one job per model**, each covering every
selected workload — e.g. RHAIIS's CPT pipeline. This is a fully generic
mechanism (`POST /fournos/submit-matrix`); no project gets its own backend
code path, RHAIIS included.

```yaml
- id: cpt
  label: CPT Pipeline
  kind: matrix
  presets_ref: {dir: presets.d, preset_pool: true}
  matrix:
    marker_key: __cpt          # presence (+ truthy) marks a preset entry as a pipeline
    models_key: __models       # sub-key: {model_key: {overrides..., __tp: N}} or [model_key, ...]
    workloads_key: __workloads # sub-key: [workload_key, ...]
    label_key: __description   # sub-key: human label (optional)
    tp_key: __tp               # per-model parallelism hint (optional)
  dimensions: [model, workload]   # informational only
  sections:                       # optional: shared fields for every generated job
    - id: infra
      fields:
        - {key: accelerator, type: radio, maps_to: rhaiis.accelerator}
        - {key: engine, type: select, maps_to: rhaiis.engine}
```

The marker/sub-key **names** are project-configurable (default to RHAIIS's
own `__cpt`/`__models`/`__workloads`/`__description`/`__tp` convention) — the
resolution engine itself doesn't know anything about RHAIIS. The backend
scans the mode's `presets_ref` pool (same pool used for ordinary field
partitioning — the two mechanisms compose) for entries where
`entry[marker_key]` is truthy, and expands each into a `UiPipeline`:

- `models`: normalized from `entry[models_key]` — either a dict
  (`{model_key: {overrides..., <tp_key>: N}}`) or a plain list of model
  keys.
- `workloads`: `entry[workloads_key]`, a plain list.
- `overrides`: every other key on the entry (e.g. a pinned image tag),
  informational and passed straight through as shared `config_overrides`.

The frontend renders a pipeline picker plus model/workload checkboxes
(defaulting to all selected), then submits one `SubmitMatrixRequest` per
click — resulting in one `FournosJob` per selected model, with `args =
[...shared mode args, model.key, ...selected workloads]` and
`config_overrides` merged from the shared fields, the pipeline's own
`overrides`, and that model's per-model `overrides`.

## Building the submission from a resolved schema (frontend)

Given the resolved schema and the user's current field values:

```
args = []
if quick_preset selected:
    args.append(quick_preset.key)
    apply quick_preset.overrides into config_overrides
for each arg field (no maps_to) in declared order:
    for each selected value (single, or each item if multiselect):
        args.append(value)
for each override field (maps_to set):
    config_overrides[field.maps_to] = current value
```

This needs one small, generic addition to `SubmitJobRequest`: an `args:
list[str]` field (alongside the existing single `preset: str`), so a form
with several arg-fields can submit more than one preset key at once. When
`args` is non-empty the submit endpoint uses it directly; otherwise it falls
back to `[preset]` exactly as before — fully backward compatible with the
existing plain "Preset" dropdown. `kind: matrix` modes submit through the
separate, equally generic `POST /fournos/submit-matrix` endpoint instead
(see above), since they create more than one job per click.

## Example: a "simple" project (flat, one-dimension-per-directory presets)

```yaml
schema_version: 1
project: mcp_gateway
title: MCP Gateway
modes:
  - id: single
    label: Submit Job
    default: true
    sections:
      - id: run
        label: Run
        fields:
          - key: preset
            label: Preset
            type: select
            required: true
            options_ref: {dir: presets.d}
          - key: gateway_version
            label: Gateway Version
            type: text
            maps_to: infrastructure.mcp_gateway_version
            placeholder: main
```

Each project publishes its own `ui/submit.yaml` at the root of its
directory in the Forge repo (e.g. `projects/rhaiis/ui/submit.yaml`); the
Control Center fetches it directly from GitHub at request time.
