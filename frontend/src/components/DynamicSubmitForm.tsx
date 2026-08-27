import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftIcon, ArrowPathIcon, PlayIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import ReviewRow, { ReviewSection } from './ReviewRow'
import { useSubmitJob, useSubmitMatrix } from '../hooks/useFournos'
import type { ProjectUiSchema, UiField, UiMode, UiPipeline, UiQuickPreset } from '../types'

// ─── Generic, schema-driven submit form ────────────────────────────────
//
// Renders whatever fields a project's ui/submit.yaml declares (see
// docs/ui-schema-spec.md), and builds a submission the same way for any
// project: arg-fields (no `maps_to`) contribute preset keys to `args`,
// override-fields (`maps_to` set) write into `config_overrides`.
//
// This only renders the *project-specific* portion of the submit wizard
// (steps 2 "Project Details" and 3 "Review & Submit" — nothing for step 1).
// Cluster, pipeline, owner, priority, exclusive, and the PR picker are
// "Basics", common to every project, and owned by the parent page — passed
// in here as `basics` — so there is exactly one wizard/step indicator, not
// one nested inside another.
//
// A `kind: matrix` mode (e.g. RHAIIS's CPT pipelines) additionally offers a
// pipeline picker plus model/workload checkboxes, submitting one job per
// selected model via `/fournos/submit-matrix` — this is the exact same
// renderer for every project, no per-project branch.

export interface SubmitBasics {
  cluster: string
  pipeline: string
  owner: string
  priority: string
  exclusive: boolean
  pullSha: string
  /** Human-readable label for the review step, e.g. "#123 — title (author)". */
  prLabel: string
}

function defaultValueFor(field: UiField): unknown {
  if (field.default !== undefined && field.default !== null) return field.default
  if (field.type === 'boolean') return false
  if (field.type === 'multiselect') return []
  return ''
}

function fieldsOf(mode: UiMode): UiField[] {
  return mode.sections.flatMap((s) => s.fields)
}

function isFieldVisible(field: UiField, values: Record<string, unknown>): boolean {
  const cond = field.visible_if
  if (!cond) return true
  const current = values[cond.field]
  if (cond.equals !== undefined) return current === cond.equals
  if (cond.one_of) return cond.one_of.includes(current)
  return true
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value == null ? '' : String(value)
}

function stringifyOverrides(overrides: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(overrides)) out[k] = stringifyValue(v)
  return out
}

function formatOverridesTooltip(overrides?: Record<string, unknown>): string {
  if (!overrides || Object.keys(overrides).length === 0) return ''
  return Object.entries(overrides)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function optionLabel(field: UiField, raw: string): string {
  return field.options.find((o) => o.value === raw)?.label || raw
}

/** Human-readable rendering of a field's current value for the review step. */
function formatFieldValueForReview(field: UiField, value: unknown): string | null {
  if (field.type === 'boolean') return value ? 'Yes' : 'No'
  if (field.type === 'multiselect') {
    const arr = Array.isArray(value) ? (value as string[]) : []
    if (arr.length === 0) return null
    return arr.map((v) => optionLabel(field, v)).join(', ')
  }
  if (field.type === 'select' || field.type === 'radio') {
    if (!value) return null
    return optionLabel(field, value as string)
  }
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

export default function DynamicSubmitForm({
  project,
  schema,
  basics,
  step,
  onBack,
  onNext,
  onSubmitted,
}: {
  project: string
  schema: ProjectUiSchema
  basics: SubmitBasics
  /** Which shared wizard step is active; this component only renders for 2 and 3. */
  step: number
  onBack: () => void
  onNext: () => void
  onSubmitted?: (name: string) => void
}) {
  const submitJob = useSubmitJob()
  const submitMatrix = useSubmitMatrix()

  const allModes = schema.modes

  const [activeModeId, setActiveModeId] = useState<string>(
    () => (allModes.find((m) => m.default) || allModes[0])?.id || ''
  )
  const activeMode = useMemo(
    () => allModes.find((m) => m.id === activeModeId) || allModes[0],
    [allModes, activeModeId]
  )
  const isMatrix = activeMode?.kind === 'matrix'

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [quickPresetKey, setQuickPresetKey] = useState('')

  // Matrix-mode-only selection state
  const [pipelineKey, setPipelineKey] = useState('')
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [selectedWorkloads, setSelectedWorkloads] = useState<string[]>([])
  const selectedPipeline: UiPipeline | undefined = useMemo(
    () => activeMode?.pipelines.find((p) => p.key === pipelineKey),
    [activeMode, pipelineKey]
  )

  useEffect(() => {
    if (!activeMode) return
    const initial: Record<string, unknown> = {}
    for (const field of fieldsOf(activeMode)) {
      initial[field.key] = defaultValueFor(field)
    }
    setValues(initial)
    setQuickPresetKey('')
    setPipelineKey(activeMode.pipelines[0]?.key || '')
  }, [activeMode])

  useEffect(() => {
    if (!selectedPipeline) {
      setSelectedModels([])
      setSelectedWorkloads([])
      return
    }
    setSelectedModels(selectedPipeline.models.map((m) => m.key))
    setSelectedWorkloads(selectedPipeline.workloads)
  }, [selectedPipeline])

  const setFieldValue = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const applyQuickPreset = (qp: UiQuickPreset) => {
    const wasActive = quickPresetKey === qp.key
    setQuickPresetKey(wasActive ? '' : qp.key)
    if (wasActive || !activeMode) return
    const fields = fieldsOf(activeMode)
    setValues((prev) => {
      const next = { ...prev }
      for (const [fieldKey, fillValue] of Object.entries(qp.fills)) {
        const field = fields.find((f) => f.key === fieldKey)
        if (!field) continue
        if (field.type === 'multiselect') {
          const arr = Array.isArray(next[fieldKey]) ? [...(next[fieldKey] as string[])] : []
          if (typeof fillValue === 'string' && !arr.includes(fillValue)) arr.push(fillValue)
          next[fieldKey] = arr
        } else {
          next[fieldKey] = fillValue
        }
      }
      return next
    })
  }

  // Shared-field args/overrides: every mode's own declared fields (arg
  // fields -> args, override fields -> config_overrides) plus any selected
  // quick preset — identical logic whether the mode is `form` or `matrix`.
  const collectSharedArgsAndOverrides = (): { args: string[]; overrides: Record<string, string> } => {
    const args: string[] = []
    const overrides: Record<string, string> = {}
    if (!activeMode) return { args, overrides }

    if (quickPresetKey) {
      args.push(quickPresetKey)
      const qp = activeMode.quick_presets.find((p) => p.key === quickPresetKey)
      if (qp) {
        for (const [k, v] of Object.entries(qp.overrides)) overrides[k] = stringifyValue(v)
      }
    }

    for (const field of fieldsOf(activeMode)) {
      if (!isFieldVisible(field, values)) continue
      const value = values[field.key]

      if (field.maps_to) {
        if (value === undefined || value === '' || value === null) continue
        overrides[field.maps_to] = stringifyValue(value)
      } else if (field.type === 'select' || field.type === 'radio') {
        if (typeof value === 'string' && value) args.push(value)
      } else if (field.type === 'multiselect' && Array.isArray(value)) {
        for (const v of value) if (typeof v === 'string' && v) args.push(v)
      }
    }

    return { args, overrides }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeMode) return

    if (isMatrix) {
      if (!selectedPipeline || selectedModels.length === 0 || selectedWorkloads.length === 0) return
      const { args, overrides } = collectSharedArgsAndOverrides()
      const modelByKey = new Map(selectedPipeline.models.map((m) => [m.key, m]))
      try {
        const result = await submitMatrix.mutateAsync({
          project,
          cluster: basics.cluster,
          pipeline: basics.pipeline,
          args,
          config_overrides: { ...overrides, ...stringifyOverrides(selectedPipeline.overrides) },
          models: selectedModels.map((key) => {
            const m = modelByKey.get(key)
            return {
              key,
              overrides: m?.overrides || {},
              gpu_count: m?.tp ?? null,
            }
          }),
          workloads: selectedWorkloads,
          owner: basics.owner,
          priority: basics.priority,
          exclusive: basics.exclusive,
          pull_sha: basics.pullSha,
          gpu_type: '',
        })
        onSubmitted?.(result.jobs?.[0]?.job_name || '')
      } catch {
        // error surfaced below via submitMatrix.error
      }
      return
    }

    const { args, overrides: configOverrides } = collectSharedArgsAndOverrides()
    try {
      const result = await submitJob.mutateAsync({
        project,
        cluster: basics.cluster,
        pipeline: basics.pipeline,
        preset: '',
        args,
        version: '',
        owner: basics.owner,
        exclusive: basics.exclusive,
        config_overrides: configOverrides,
        pull_sha: basics.pullSha,
        priority: basics.priority,
      })
      onSubmitted?.(result.job_name)
    } catch {
      // error surfaced below via submitJob.error
    }
  }

  if (!activeMode) {
    return step >= 2 ? (
      <p className="text-sm text-gray-500">{schema.title || project} has no submit form defined.</p>
    ) : null
  }

  if (step !== 2 && step !== 3) return null

  const canSubmit = isMatrix
    ? !submitMatrix.isPending && !!basics.cluster && !!selectedPipeline && selectedModels.length > 0 && selectedWorkloads.length > 0
    : !submitJob.isPending && !!basics.cluster

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {step === 2 && (
        <>
          {allModes.length > 1 && (
            <div className="flex gap-2">
              {allModes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveModeId(m.id)}
                  className={clsx(
                    'px-3 py-1.5 rounded-md text-sm font-medium border',
                    m.id === activeModeId
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                  )}
                >
                  {m.label || m.id}
                </button>
              ))}
            </div>
          )}

          {activeMode.quick_presets.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Quick Presets</label>
              <div className="flex flex-wrap gap-1.5">
                {activeMode.quick_presets.map((qp) => (
                  <button
                    key={qp.key}
                    type="button"
                    title={formatOverridesTooltip(qp.overrides)}
                    onClick={() => applyQuickPreset(qp)}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                      quickPresetKey === qp.key
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                    )}
                  >
                    {qp.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeMode.sections.map((section) => (
            <div key={section.id} className="rounded-lg border border-gray-200 p-4 space-y-4">
              {section.label && (
                <h3 className="text-sm font-semibold text-gray-900">{section.label}</h3>
              )}
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                {section.fields.map((field) => {
                  if (field.type === 'hidden' || !isFieldVisible(field, values)) return null
                  return (
                    <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                      <label className="block text-sm font-medium text-gray-700">
                        {field.label || field.key}
                        {field.required && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      <FieldControl
                        field={field}
                        value={values[field.key]}
                        onChange={(v) => setFieldValue(field.key, v)}
                      />
                      {field.help && <p className="mt-1 text-xs text-gray-400">{field.help}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {isMatrix && (
            <div className="space-y-4 rounded-lg border border-gray-200 p-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Pipeline</label>
                {activeMode.pipelines.length > 0 ? (
                  <select
                    value={pipelineKey}
                    onChange={(e) => setPipelineKey(e.target.value)}
                    className="input mt-1"
                  >
                    {activeMode.pipelines.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label || p.key}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 text-xs text-gray-400">
                    No pipelines are published for {schema.title || project} yet.
                  </p>
                )}
              </div>

              {selectedPipeline && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Models</label>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPipeline.models.map((m) => {
                        const checked = selectedModels.includes(m.key)
                        return (
                          <label
                            key={m.key}
                            title={formatOverridesTooltip(m.overrides)}
                            className={clsx(
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border cursor-pointer select-none',
                              checked
                                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                            )}
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3 rounded border-gray-300 text-indigo-600"
                              checked={checked}
                              onChange={() =>
                                setSelectedModels((prev) =>
                                  checked ? prev.filter((k) => k !== m.key) : [...prev, m.key]
                                )
                              }
                            />
                            {m.label || m.key}
                            {m.tp ? <span className="text-gray-400">tp{m.tp}</span> : null}
                          </label>
                        )
                      })}
                      {selectedPipeline.models.length === 0 && (
                        <p className="text-xs text-gray-400">This pipeline declares no models.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Workloads</label>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPipeline.workloads.map((w) => {
                        const checked = selectedWorkloads.includes(w)
                        return (
                          <label
                            key={w}
                            className={clsx(
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border cursor-pointer select-none',
                              checked
                                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                            )}
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3 rounded border-gray-300 text-indigo-600"
                              checked={checked}
                              onChange={() =>
                                setSelectedWorkloads((prev) =>
                                  checked ? prev.filter((x) => x !== w) : [...prev, w]
                                )
                              }
                            />
                            {w}
                          </label>
                        )
                      })}
                      {selectedPipeline.workloads.length === 0 && (
                        <p className="text-xs text-gray-400">This pipeline declares no workloads.</p>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-gray-400">
                    Submits {selectedModels.length} job(s), one per model, each covering{' '}
                    {selectedWorkloads.length} workload(s).
                  </p>
                </>
              )}
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeftIcon className="h-4 w-4" /> Back
            </button>
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              Next: Review
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          {(submitJob.error || submitMatrix.error) && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              {(submitJob.error || submitMatrix.error)?.message}
            </div>
          )}

          {(allModes.length > 1 || quickPresetKey) && (
            <ReviewSection>
              {allModes.length > 1 && <ReviewRow label="Mode" value={activeMode.label || activeMode.id} />}
              {quickPresetKey && (
                <ReviewRow
                  label="Quick Preset"
                  value={activeMode.quick_presets.find((p) => p.key === quickPresetKey)?.label || quickPresetKey}
                />
              )}
            </ReviewSection>
          )}

          {activeMode.sections.map((section) => {
            const rows = section.fields
              .filter((f) => f.type !== 'hidden' && isFieldVisible(f, values))
              .map((field) => ({ field, display: formatFieldValueForReview(field, values[field.key]) }))
              .filter(({ field, display }) => field.required || display !== null)
            if (rows.length === 0) return null
            return (
              <ReviewSection key={section.id} title={section.label}>
                {rows.map(({ field, display }) => (
                  <ReviewRow
                    key={field.key}
                    label={field.label || field.key}
                    value={display}
                    missing={display === null}
                  />
                ))}
              </ReviewSection>
            )
          })}

          {isMatrix && (
            <ReviewSection title="Matrix Selection">
              <ReviewRow
                label="Pipeline"
                value={selectedPipeline?.label || selectedPipeline?.key}
                missing={!selectedPipeline}
              />
              <ReviewRow
                label="Models"
                value={selectedModels
                  .map((k) => selectedPipeline?.models.find((m) => m.key === k)?.label || k)
                  .join(', ')}
                missing={selectedModels.length === 0}
              />
              <ReviewRow
                label="Workloads"
                value={selectedWorkloads.join(', ')}
                missing={selectedWorkloads.length === 0}
              />
            </ReviewSection>
          )}

          {!canSubmit && (
            <p className="text-xs text-orange-600">
              Some required fields above are missing — fill them in on the previous step before submitting.
            </p>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeftIcon className="h-4 w-4" /> Back
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitJob.isPending || submitMatrix.isPending ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <PlayIcon className="h-4 w-4" />
              )}
              {isMatrix ? `Submit ${selectedModels.length || ''} Job(s)` : 'Submit Job'}
            </button>
          </div>
        </>
      )}
    </form>
  )
}

// ─── Field controls ─────────────────────────────────────────────────────

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: UiField
  value: unknown
  onChange: (value: unknown) => void
}) {
  switch (field.type) {
    case 'boolean':
      return (
        <div className="mt-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600"
            />
            {field.placeholder || 'Enabled'}
          </label>
        </div>
      )

    case 'number':
      return (
        <input
          type="number"
          value={value === undefined || value === null ? '' : (value as number | string)}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="input mt-1"
          placeholder={field.placeholder}
        />
      )

    case 'textarea':
      return (
        <textarea
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="input mt-1 font-mono"
          placeholder={field.placeholder}
        />
      )

    case 'select':
      return (
        <select
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          className="input mt-1"
        >
          <option value="">{field.required ? 'Select...' : 'None'}</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value} title={formatOverridesTooltip(opt.overrides)}>
              {opt.label || opt.value}
            </option>
          ))}
        </select>
      )

    case 'radio':
      return (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {field.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={formatOverridesTooltip(opt.overrides)}
              onClick={() => onChange(value === opt.value ? '' : opt.value)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                value === opt.value
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
              )}
            >
              {opt.label || opt.value}
            </button>
          ))}
          {field.options.length === 0 && <p className="text-xs text-gray-400">None available.</p>}
        </div>
      )

    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      const toggle = (v: string) =>
        onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v])
      return (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {field.options.map((opt) => (
            <label
              key={opt.value}
              title={formatOverridesTooltip(opt.overrides)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border cursor-pointer select-none',
                selected.includes(opt.value)
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
              )}
            >
              <input
                type="checkbox"
                className="h-3 w-3 rounded border-gray-300 text-indigo-600"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              {opt.label || opt.value}
            </label>
          ))}
          {field.options.length === 0 && <p className="text-xs text-gray-400">None available.</p>}
        </div>
      )
    }

    case 'text':
    default:
      return (
        <input
          type="text"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          className="input mt-1"
          placeholder={field.placeholder}
        />
      )
  }
}
