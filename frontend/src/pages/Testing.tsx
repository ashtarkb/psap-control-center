import { useState, useMemo, useEffect, useRef, Fragment, type ComponentType } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Menu, Transition } from '@headlessui/react'
import {
  PlayIcon,
  ClockIcon,
  CalendarDaysIcon,
  PlusIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  XMarkIcon,
  StopIcon,
  TrashIcon,
  LockClosedIcon,
  WrenchScrewdriverIcon,
  MagnifyingGlassIcon,
  ChartBarIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { isAdmin, isAuthenticated } from '../stores/authStore'
import { useClusters } from '../hooks/useClusters'
import DynamicSubmitForm from '../components/DynamicSubmitForm'
import ClusterCombobox from '../components/ClusterCombobox'
import ClusterScheduleModal from '../components/ClusterScheduleModal'
import ClusterActivityModal from '../components/ClusterActivityModal'
import SchedulingCalendar from '../components/SchedulingCalendar'
import { cronFiresWithin } from '../utils/cronOccurrences'
import { browserTimezone, datetimeLocalToUtcIso } from '../utils/timezone'
import WizardSteps from '../components/WizardSteps'
import ReviewRow, { ReviewSection } from '../components/ReviewRow'
import YamlPreview from '../components/YamlPreview'
import SearchableSelect from '../components/SearchableSelect'
import { buildSingleJobPreview, toYamlPreview, withVersionOverride } from '../utils/fournosJobPreview'
import {
  useFournosJobs,
  useRecurringJobs,
  useClusterLocks,
  useForgeProjects,
  usePipelines,
  useSubmitJob,
  useCancelJob,
  useRerunJob,
  useDeleteHistoryJob,
  useTriggerRecurringJob,
  useDeleteRecurringJob,
  useDeleteClusterLock,
  useCreateClusterLock,
  useGithubPRs,
  useRefreshGithubPRs,
  useProjectUiSchema,
  useRefreshProjectUiSchema,
  useClusterOverview,
} from '../hooks/useFournos'
import type {
  FournosJobSummary,
  RecurringJob,
  ClusterLock,
  ForgeProject,
  Cluster,
  JobScheduling,
  ClusterOverview,
} from '../types'

const RUNNING_JOB_STATUSES = new Set(['Running', 'Pending', 'Admitted', 'Resolving'])

/** Is there anything happening on this cluster right now, or coming up in
 * the next `hours` hours? Used to decide whether the "what's happening on
 * this cluster" popup should open automatically on the Submit page — we
 * only want to interrupt the user when it's actually relevant. */
function hasUpcomingClusterActivity(overview: ClusterOverview | undefined, hours: number): boolean {
  if (!overview) return false
  const now = Date.now()
  const windowMs = hours * 3600_000
  const untilTs = now + windowMs

  for (const job of overview.current_jobs) {
    if (RUNNING_JOB_STATUSES.has(job.status)) return true
    if (job.scheduled_start_time) {
      const t = new Date(job.scheduled_start_time).getTime()
      if (t > now && t <= untilTs) return true
    }
  }
  for (const r of overview.recurring_jobs) {
    if (cronFiresWithin(r.schedule, new Date(now), windowMs)) return true
  }
  for (const lock of overview.locks) {
    const startMs = lock.scheduled_start_time ? new Date(lock.scheduled_start_time).getTime() : new Date(lock.created_at).getTime()
    const lockUntilMs = lock.lock_until ? new Date(lock.lock_until).getTime() : null
    const activeNow = startMs <= now && (lockUntilMs === null || lockUntilMs > now)
    const startsSoon = startMs > now && startMs <= untilTs
    if (activeNow || startsSoon) return true
  }
  return false
}

const STATUS_COLORS: Record<string, string> = {
  Running: 'bg-blue-100 text-blue-800',
  Succeeded: 'bg-green-100 text-green-800',
  Failed: 'bg-red-100 text-red-800',
  Stopped: 'bg-yellow-100 text-yellow-800',
  Pending: 'bg-gray-100 text-gray-700',
  Resolving: 'bg-purple-100 text-purple-800',
  Admitted: 'bg-indigo-100 text-indigo-800',
  Unknown: 'bg-gray-100 text-gray-500',
}

const ALL_STATUSES = ['Running', 'Pending', 'Admitted', 'Resolving', 'Succeeded', 'Failed', 'Stopped']

/** Today's date in the browser's own timezone, as a "YYYY-MM-DD" string —
 * matches what a native `<input type="date">` shows/expects, no UTC
 * conversion needed since it's just the local calendar date. */
function todayDateStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function formatAge(ts: string | null): string {
  if (!ts) return '-'
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  if (h < 24) return `${h}h ${m}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

const TABS = [
  { id: 'live', label: 'Live Jobs', icon: PlayIcon },
  { id: 'history', label: 'History', icon: ClockIcon },
  { id: 'submit', label: 'Submit Job', icon: PlusIcon },
  { id: 'schedules', label: 'Schedules/Locks', icon: CalendarDaysIcon },
]

// ─── Sortable table headers ─────────────────────────────────────────────
// Shared by every table on this page (Live Jobs / History are server-driven
// via sort_by+sort_dir query params; Recurring Jobs / Cluster Locks sort
// client-side over their already-fully-loaded list — see sortRows below).

type SortDir = 'asc' | 'desc'
interface SortState { by: string; dir: SortDir }

/** Clicking the already-active column flips its direction; clicking a new
 * column starts it off ascending. */
function toggleSort(prev: SortState, key: string): SortState {
  return prev.by === key ? { by: key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { by: key, dir: 'asc' }
}

function sortRows<T>(rows: T[], sort: SortState, accessors: Record<string, (row: T) => string | number>): T[] {
  const accessor = accessors[sort.by]
  if (!accessor) return rows
  const sorted = [...rows].sort((a, b) => {
    const av = accessor(a)
    const bv = accessor(b)
    if (av < bv) return -1
    if (av > bv) return 1
    return 0
  })
  return sort.dir === 'desc' ? sorted.reverse() : sorted
}

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string
  sortKey: string
  sort: SortState
  onSort: (key: string) => void
  align?: 'left' | 'right'
}) {
  const active = sort.by === sortKey
  return (
    <th className={clsx('px-4 py-3 text-xs font-medium uppercase', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={clsx(
          'inline-flex items-center gap-1 hover:text-gray-700',
          active ? 'text-gray-900' : 'text-gray-500'
        )}
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />
        ) : (
          <ChevronUpDownIcon className="h-3.5 w-3.5 text-gray-300" />
        )}
      </button>
    </th>
  )
}

/** "3 dots" per-row actions menu — currently just History's Rerun+Delete,
 * but generic enough to grow more actions/other tables later. */
function RowActionsMenu({ items }: { items: Array<{ label: string; icon: ComponentType<{ className?: string }>; onClick: () => void; danger?: boolean }> }) {
  if (!items.length) return null
  return (
    <Menu as="div" className="relative inline-block text-left">
      <Menu.Button className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
        <EllipsisVerticalIcon className="h-5 w-5" />
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-10 mt-1 w-36 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
          {items.map((item) => (
            <Menu.Item key={item.label}>
              {({ active }) => (
                <button
                  type="button"
                  onClick={item.onClick}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                    item.danger ? 'text-red-600' : 'text-gray-700',
                    active && (item.danger ? 'bg-red-50' : 'bg-gray-50')
                  )}
                >
                  <item.icon className="h-4 w-4" /> {item.label}
                </button>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  )
}

// ─── Job Table ──────────────────────────────────────────────────────────

function JobsTable({
  jobs,
  source,
  sort,
  onSort,
  onCancel,
  onDelete,
  onRerun,
}: {
  jobs: FournosJobSummary[]
  source: 'live' | 'history'
  sort: SortState
  onSort: (key: string) => void
  onCancel?: (name: string) => void
  onDelete?: (name: string) => void
  onRerun?: (name: string) => void
}) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        {source === 'live' ? 'No active jobs' : 'No archived jobs found'}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <SortableTh label="Name" sortKey="name" sort={sort} onSort={onSort} />
            <SortableTh label="Project" sortKey="project" sort={sort} onSort={onSort} />
            <SortableTh label="Cluster" sortKey="cluster" sort={sort} onSort={onSort} />
            <SortableTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
            <SortableTh label={source === 'live' ? 'Age' : 'Date'} sortKey={source === 'live' ? 'age' : 'date'} sort={sort} onSort={onSort} />
            <SortableTh label="Owner" sortKey="owner" sort={sort} onSort={onSort} />
            <SortableTh label="Triggered By" sortKey="triggered_by" sort={sort} onSort={onSort} />
            {source === 'history' && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">MLflow</th>}
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {jobs.map((job) => (
            <tr key={job.name} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm">
                <Link
                  to={`/testing/jobs/${job.name}`}
                  className="text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  {job.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-sm text-gray-900">{job.project || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-900">{job.cluster || '-'}</td>
              <td className="px-4 py-3 text-sm">
                <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[job.status] || STATUS_COLORS.Unknown)}>
                  {job.status}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {source === 'live' ? formatAge(job.created_at) : (job.completed_at ? new Date(job.completed_at).toLocaleString() : '-')}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">{job.owner || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {job.trigger_type === 'recurring' && job.triggered_by_schedule ? (
                  <Link
                    to={`/testing/schedules/${job.triggered_by_schedule}/runs`}
                    className="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-700"
                    title={`Created by recurring job "${job.triggered_by_schedule}"`}
                  >
                    <CalendarDaysIcon className="h-3.5 w-3.5" /> {job.triggered_by_schedule}
                  </Link>
                ) : job.trigger_type === 'deferred' ? (
                  <span className="inline-flex items-center gap-1 text-gray-400">
                    <ClockIcon className="h-3.5 w-3.5" /> Deferred
                  </span>
                ) : job.trigger_type === 'recurring-parent' ? (
                  <span className="inline-flex items-center gap-1 text-teal-600">
                    <CalendarDaysIcon className="h-3.5 w-3.5" /> Recurring template
                  </span>
                ) : (
                  '-'
                )}
              </td>
              {source === 'history' && (
                <td className="px-4 py-3 text-sm text-center">
                  {job.mlflow_url ? (
                    <a
                      href={job.mlflow_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      <ChartBarIcon className="h-3.5 w-3.5" /> MLflow
                    </a>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
              )}
              <td className="px-4 py-3 text-sm text-right">
                {source === 'live' && isAdmin() && ['Running', 'Pending', 'Admitted', 'Resolving'].includes(job.status) && onCancel && (
                  <button onClick={() => onCancel(job.name)} className="text-red-500 hover:text-red-700" title="Cancel">
                    <StopIcon className="h-4 w-4" />
                  </button>
                )}
                {source === 'history' && isAdmin() && (
                  <RowActionsMenu
                    items={[
                      ...(onRerun ? [{ label: 'Rerun', icon: ArrowPathIcon, onClick: () => onRerun(job.name) }] : []),
                      ...(onDelete ? [{ label: 'Delete', icon: TrashIcon, onClick: () => onDelete(job.name), danger: true }] : []),
                    ]}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Submit Form ────────────────────────────────────────────────────────

const VERSION_PROJECTS = ['mcp_gateway']

function SubmitForm({ onSubmitted }: { onSubmitted?: (name: string) => void }) {
  const { data: projects } = useForgeProjects()
  const { data: pipelines } = usePipelines()
  const { data: githubPRs } = useGithubPRs()
  const refreshGithubPRs = useRefreshGithubPRs()
  const submitJob = useSubmitJob()

  // "Basics" — common to every project, owned here so there is exactly one
  // wizard/step indicator (DynamicSubmitForm only renders steps 2 and 3,
  // driven by the `step` state below, and never its own nested wizard).
  const [project, setProject] = useState('')
  const [cluster, setCluster] = useState('')
  const [pipeline, setPipeline] = useState('forge-test-only')
  const [preset, setPreset] = useState('')
  const [version, setVersion] = useState('')
  const [owner, setOwner] = useState('')
  const [priority, setPriority] = useState('manual')
  const [exclusive, setExclusive] = useState(false)
  const [configRaw, setConfigRaw] = useState('')
  const [pullSha, setPullSha] = useState('')
  const [prSearch, setPrSearch] = useState('')
  const [prDropdownOpen, setPrDropdownOpen] = useState(false)
  // step 1 = "what do you want to do" (Lock / Forge Job / Custom Job).
  // For jobType === 'forge': 2 = Basics, 3 = Project Details, 4 = Review & Submit.
  // For jobType === 'lock': 2 = pick a cluster + inspect/manage its locks.
  // For jobType === 'custom': 2 = coming-soon placeholder.
  const [jobType, setJobType] = useState<'lock' | 'forge' | 'custom' | ''>('')
  const [step, setStep] = useState(1)
  const [lockCluster, setLockCluster] = useState('')
  const [lockReason, setLockReason] = useState('')
  const [lockOwner, setLockOwner] = useState('')
  const [scheduling, setScheduling] = useState<JobScheduling>({ mode: 'now' })
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const createLock = useCreateClusterLock()

  // "What's happening on this cluster" popup for the Basics step — only
  // interrupts the user automatically when there's something running or
  // starting within the next 4 hours; otherwise stays out of the way and
  // is reachable via the small manual link next to the Cluster field.
  const { data: clusterOverview } = useClusterOverview(jobType === 'forge' ? cluster || undefined : undefined)
  const [clusterActivityModalOpen, setClusterActivityModalOpen] = useState(false)
  const autoPromptedClusterRef = useRef<string | null>(null)
  useEffect(() => {
    setClusterActivityModalOpen(false)
    if (!cluster) autoPromptedClusterRef.current = null
  }, [cluster])
  useEffect(() => {
    if (!cluster || !clusterOverview) return
    if (autoPromptedClusterRef.current === cluster) return
    autoPromptedClusterRef.current = cluster
    if (hasUpcomingClusterActivity(clusterOverview, 4)) setClusterActivityModalOpen(true)
  }, [cluster, clusterOverview])

  const selectedProject = useMemo(
    () => projects?.find((p: ForgeProject) => p.name === project),
    [projects, project]
  )

  // Any project that publishes a projects/<name>/ui/submit.yaml in Forge
  // gets a fully dynamic form for free — see docs/ui-schema-spec.md. This
  // is the same mechanism for every project, RHAIIS included; there is no
  // project-specific form or backend code path.
  const { data: uiSchemaResp, isFetching: isFetchingUiSchema } = useProjectUiSchema(project || undefined)
  const dynamicSchema = uiSchemaResp?.found ? uiSchemaResp.ui_schema : null
  const refreshUiSchema = useRefreshProjectUiSchema()

  useEffect(() => {
    if (jobType === 'forge') setStep(2)
  }, [project, jobType])

  const showVersion = VERSION_PROJECTS.includes(project)

  const filteredPRs = useMemo(() => {
    if (!githubPRs) return []
    if (!prSearch.trim()) return githubPRs
    const q = prSearch.toLowerCase()
    return githubPRs.filter(
      (pr) =>
        String(pr.number).includes(q) ||
        pr.title.toLowerCase().includes(q) ||
        pr.author.toLowerCase().includes(q)
    )
  }, [githubPRs, prSearch])

  const handleProjectChange = (name: string) => {
    setProject(name)
    setPreset('')
    setVersion('')
    const proj = projects?.find((p: ForgeProject) => p.name === name)
    if (proj?.cluster) setCluster(proj.cluster)
  }

  const selectPR = (pr: { number: number; title: string; author: string; head_sha: string; draft: boolean } | null) => {
    if (pr) {
      setPrSearch(`#${pr.number} — ${pr.title} (${pr.author})`)
      setPullSha(pr.head_sha)
    } else {
      setPrSearch('')
      setPullSha('')
    }
    setPrDropdownOpen(false)
  }

  const configOverrides = useMemo(() => {
    const overrides: Record<string, string> = {}
    configRaw.split('\n').forEach((line: string) => {
      const idx = line.indexOf(':')
      if (idx > 0) {
        overrides[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    })
    return overrides
  }, [configRaw])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const overrides = configOverrides

    try {
      const result = await submitJob.mutateAsync({
        project,
        cluster,
        pipeline,
        preset,
        version,
        owner,
        priority,
        exclusive,
        config_overrides: overrides,
        pull_sha: pullSha,
        schedule: scheduling.mode === 'recurring' ? scheduling.scheduleUtc : '',
        scheduled_start_time: scheduling.mode === 'defer' ? scheduling.scheduledStartTimeUtc : null,
      })
      onSubmitted?.(result.job_name)
    } catch {
      // error displayed below
    }
  }

  const wizardSteps =
    jobType === 'forge'
      ? ['Job Type', 'Basics', 'Project Details', 'Review & Submit']
      : jobType === 'lock'
        ? ['Job Type', 'Lock Cluster']
        : jobType === 'custom'
          ? ['Job Type', 'Custom Job']
          : ['Job Type']

  const outerMaxWidth =
    jobType === 'forge' && step === 4
      ? 'max-w-5xl'
      : step === 1 || (jobType === 'forge' && step === 2) || (jobType === 'lock' && step === 2)
        ? 'max-w-4xl'
        : 'max-w-2xl'

  return (
    <div className={clsx('mx-auto space-y-6', outerMaxWidth)}>
      {step > 1 && <WizardSteps steps={wizardSteps} current={step} />}

      {step === 1 && (
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">What do you want to do?</h3>
          <p className="text-sm text-gray-500 mb-6">Pick a job type to get started.</p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              {
                type: 'lock' as const,
                icon: LockClosedIcon,
                title: 'Lock a Cluster',
                desc: 'Reserve a cluster and inspect its current Fournos jobs, schedules, and locks.',
                color: 'amber',
              },
              {
                type: 'forge' as const,
                icon: PlayIcon,
                title: 'Run a Forge Job',
                desc: 'Submit a FournosJob against a Forge project — RHAIIS, llm_d, mcp_gateway, and more.',
                color: 'indigo',
              },
              {
                type: 'custom' as const,
                icon: WrenchScrewdriverIcon,
                title: 'Custom Job',
                desc: 'Bring your own pipeline definition, outside of Forge presets.',
                color: 'gray',
              },
            ].map(({ type, icon: Icon, title, desc, color }) => (
              <button
                key={type}
                type="button"
                onClick={() => { setJobType(type); setStep(2) }}
                className={clsx(
                  'group relative flex flex-col items-center gap-3.5 rounded-2xl border-2 bg-white px-6 py-9 text-center shadow-sm transition-all',
                  'hover:-translate-y-1 hover:shadow-xl',
                  color === 'amber' && 'border-gray-200 hover:border-amber-400',
                  color === 'indigo' && 'border-gray-200 hover:border-indigo-400',
                  color === 'gray' && 'border-gray-200 hover:border-gray-400'
                )}
              >
                <span
                  className={clsx(
                    'flex h-16 w-16 items-center justify-center rounded-2xl transition-colors',
                    color === 'amber' && 'bg-amber-50 text-amber-600 group-hover:bg-amber-100',
                    color === 'indigo' && 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100',
                    color === 'gray' && 'bg-gray-100 text-gray-600 group-hover:bg-gray-200'
                  )}
                >
                  <Icon className="h-8 w-8" />
                </span>
                <span className="text-lg font-semibold text-gray-900">{title}</span>
                <span className="text-sm leading-relaxed text-gray-500">{desc}</span>
                <span
                  className={clsx(
                    'mt-1 inline-flex items-center gap-1 text-sm font-medium opacity-0 transition-opacity group-hover:opacity-100',
                    color === 'amber' && 'text-amber-600',
                    color === 'indigo' && 'text-indigo-600',
                    color === 'gray' && 'text-gray-600'
                  )}
                >
                  Get started →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && jobType === 'lock' && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-start gap-3 border-b border-gray-100 bg-amber-50/60 px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <LockClosedIcon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Lock details</h3>
                <p className="text-xs text-gray-500">Reserve a cluster so no other jobs can run on it during a chosen time window.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 px-5 py-5 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-900">Cluster</label>
                <ClusterCombobox
                  value={lockCluster}
                  onChange={setLockCluster}
                  inputClassName="mt-1.5 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900">
                  Reason<span className="ml-0.5 text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={lockReason}
                  onChange={(e) => setLockReason(e.target.value)}
                  required
                  placeholder="e.g. hardware maintenance"
                  className="mt-1.5 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900">
                  Owner<span className="ml-0.5 text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={lockOwner}
                  onChange={(e) => setLockOwner(e.target.value)}
                  required
                  placeholder="your-name"
                  className="mt-1.5 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            {createLock.error && (
              <div className="mx-5 mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{createLock.error.message}</div>
            )}

            <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-5">
              {!lockCluster ? (
                <p className="py-6 text-center text-sm text-gray-400">Pick a cluster to inspect and schedule its locks.</p>
              ) : !lockReason.trim() || !lockOwner.trim() ? (
                <p className="py-6 text-center text-sm text-gray-400">Enter a reason and an owner for the lock to pick a time on the calendar.</p>
              ) : (
                <>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">Pick a time</h4>
                  <SchedulingCalendar
                    cluster={lockCluster}
                    variant="lock"
                    onApplyLock={async (choice) => {
                      await createLock.mutateAsync({
                        cluster: lockCluster,
                        owner: lockOwner,
                        reason: lockReason,
                        scheduled_start_time: choice.startUtc,
                        lock_until: choice.untilUtc,
                      })
                    }}
                  />
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Back
          </button>
        </div>
      )}

      {step === 2 && jobType === 'custom' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center space-y-2">
            <WrenchScrewdriverIcon className="h-10 w-10 mx-auto text-gray-300" />
            <h3 className="text-sm font-semibold text-gray-700">Custom Job — Coming Soon</h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              Support for bringing your own pipeline or job definition (outside of Forge presets) is planned but not implemented yet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Back
          </button>
        </div>
      )}

      {step === 2 && jobType === 'forge' && (
        <div className="rounded-lg border border-gray-200 p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Project</label>
              {project && (
                <button
                  type="button"
                  onClick={() => refreshUiSchema.mutate(project)}
                  disabled={refreshUiSchema.isPending || isFetchingUiSchema}
                  title="Re-fetch this project's ui/submit.yaml from Forge (in case it was just published or updated)"
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-indigo-600 disabled:opacity-50"
                >
                  <ArrowPathIcon className={clsx('h-3.5 w-3.5', (refreshUiSchema.isPending || isFetchingUiSchema) && 'animate-spin')} />
                  Refresh from Forge
                </button>
              )}
            </div>
            <select value={project} onChange={(e) => handleProjectChange(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" required>
              <option value="">Select a project</option>
              {(projects || []).map((p: ForgeProject) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Cluster</label>
              <ClusterCombobox
                value={cluster}
                onChange={setCluster}
                required
                inputClassName="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Pipeline</label>
              <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                {(pipelines || []).map((p: string) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Owner<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                placeholder="your-name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                <option value="manual">manual</option>
                <option value="low">low</option>
                <option value="normal">normal</option>
                <option value="high">high</option>
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={exclusive} onChange={(e) => setExclusive(e.target.checked)} className="rounded border-gray-300 text-indigo-600" />
                Exclusive (lock cluster for this job)
              </label>
            </div>
          </div>

          {/* What's happening on this cluster — pops up automatically only
              when something is running or starting within the next 4
              hours (see hasUpcomingClusterActivity above); otherwise it
              stays out of the way and is reachable via this manual link. */}
          {cluster && (
            <div>
              <button
                type="button"
                onClick={() => setClusterActivityModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                <CalendarDaysIcon className="h-3.5 w-3.5" />
                View {cluster}'s schedule
              </button>
              <ClusterActivityModal
                open={clusterActivityModalOpen}
                onClose={() => setClusterActivityModalOpen(false)}
                cluster={cluster}
              />
            </div>
          )}

          {/* Pull Request picker */}
          <div className="relative">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Pull Request (optional)</label>
              <button
                type="button"
                onClick={() => refreshGithubPRs.mutate()}
                disabled={refreshGithubPRs.isPending}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                title="Re-fetch open PRs from GitHub"
              >
                <ArrowPathIcon className={clsx('h-3.5 w-3.5', refreshGithubPRs.isPending && 'animate-spin')} />
                Refresh
              </button>
            </div>
            <input
              type="text"
              value={prSearch}
              onChange={(e) => { setPrSearch(e.target.value); setPrDropdownOpen(true); setPullSha('') }}
              onFocus={() => setPrDropdownOpen(true)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              placeholder="Search PRs by number, title, or author..."
            />
            {pullSha && (
              <p className="mt-1 text-xs text-gray-500">
                HEAD SHA: <code className="text-indigo-600 font-mono">{pullSha}</code>
              </p>
            )}
            {!pullSha && (
              <p className="mt-1 text-xs text-gray-400">
                {githubPRs ? `${githubPRs.length} open PR(s) loaded from Forge repo.` : 'Loading PRs...'}
                {' '}Forge will build from this commit instead of the default image.
              </p>
            )}
            {prDropdownOpen && filteredPRs.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-md bg-white shadow-lg border border-gray-200">
                <button type="button" onClick={() => selectPR(null)} className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100">
                  None (clear selection)
                </button>
                {filteredPRs.map((pr) => (
                  <button
                    key={pr.number}
                    type="button"
                    onClick={() => selectPR(pr)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 border-b border-gray-50"
                  >
                    <span className="font-medium text-gray-900">#{pr.number}</span>
                    <span className="text-gray-600 ml-1">{pr.title}</span>
                    <span className="text-gray-400 ml-1">({pr.author})</span>
                    {pr.draft && <span className="ml-1 text-xs text-yellow-600">[draft]</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeftIcon className="h-4 w-4" /> Back
            </button>
            <button
              type="button"
              disabled={!project || !cluster || !owner.trim()}
              onClick={() => setStep(3)}
              title={!owner.trim() ? 'Owner is required' : undefined}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              Next: Project Details
            </button>
          </div>
        </div>
      )}

      {/* Defer / Set Recurring is decided on the Review & Submit step (see
          below and DynamicSubmitForm) — deliberately not here, so it's set
          only once every field the user filled in is finalized. */}
      {jobType === 'forge' && (
        <ClusterScheduleModal
          open={scheduleModalOpen}
          onClose={() => setScheduleModalOpen(false)}
          cluster={cluster}
          onApply={setScheduling}
        />
      )}

      {/* DynamicSubmitForm stays mounted across steps 3/4 (of the "forge"
          flow) so its internal field state survives navigating back to
          review it — it renders nothing itself outside those steps. */}
      {jobType === 'forge' && dynamicSchema && (
        <DynamicSubmitForm
          project={project}
          schema={dynamicSchema}
          basics={{ cluster, pipeline, owner, priority, exclusive, pullSha, prLabel: prSearch || pullSha, scheduling }}
          step={step - 1}
          onBack={() => setStep(step - 1)}
          onNext={() => setStep(step + 1)}
          onSubmitted={onSubmitted}
          onOpenScheduleModal={() => setScheduleModalOpen(true)}
        />
      )}

      {jobType === 'forge' && !dynamicSchema && step === 3 && (
        <div className="space-y-6">
          <ReviewSection title="Project Details">
            <div className="p-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Preset</label>
                {selectedProject?.presets?.length ? (
                  <select value={preset} onChange={(e) => setPreset(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                    <option value="">None (default)</option>
                    {selectedProject.presets.map((p: string) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <input type="text" value={preset} onChange={(e) => setPreset(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="Optional preset" />
                )}
              </div>

              {showVersion && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">MCP Gateway Version</label>
                  <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="v1.2.3 or commit SHA" />
                  <p className="mt-1 text-xs text-gray-400">Semver tag or 40-char commit SHA for nightly builds.</p>
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Config Overrides</label>
                <textarea value={configRaw} onChange={(e) => setConfigRaw(e.target.value)} rows={3} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono" placeholder="infrastructure.version: latest" />
                <p className="mt-1 text-xs text-gray-400">Same as /var directives. One key: value per line.</p>
              </div>
            </div>
          </ReviewSection>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeftIcon className="h-4 w-4" /> Back
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              Next: Review
            </button>
          </div>
        </div>
      )}

      {jobType === 'forge' && !dynamicSchema && step === 4 && (
        <form onSubmit={handleSubmit} className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 lg:items-start">
          <div className="space-y-4 min-w-0">
            <ReviewSection title="Basics">
              <ReviewRow label="Project" value={project} missing={!project} />
              <ReviewRow label="Cluster" value={cluster} missing={!cluster} />
              <ReviewRow label="Pipeline" value={pipeline} />
              {owner && <ReviewRow label="Owner" value={owner} />}
              <ReviewRow label="Priority" value={priority} />
              {exclusive && <ReviewRow label="Exclusive" value="Yes" />}
              {pullSha && <ReviewRow label="Pull Request" value={prSearch || pullSha} mono={!prSearch} />}
              <ReviewRow
                label="Schedule"
                value={
                  scheduling.mode === 'now'
                    ? 'Run now'
                    : scheduling.mode === 'defer'
                      ? `Deferred — ${scheduling.label}`
                      : `Recurring — ${scheduling.label}`
                }
              />
            </ReviewSection>

            {submitJob.error && (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
                {submitJob.error.message}
              </div>
            )}
            <ReviewSection title="Project Details">
              {preset && <ReviewRow label="Preset" value={preset} />}
              {showVersion && version && <ReviewRow label="MCP Gateway Version" value={version} />}
              {configRaw.trim() && <ReviewRow label="Config Overrides" value={configRaw.trim()} mono />}
              {!preset && !(showVersion && version) && !configRaw.trim() && (
                <ReviewRow label="Overrides" value="None" />
              )}
            </ReviewSection>

            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <ArrowLeftIcon className="h-4 w-4" /> Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(true)}
                  disabled={!cluster}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  title={!cluster ? 'Pick a cluster first' : undefined}
                >
                  <ClockIcon className="h-4 w-4" />
                  Defer / Set Recurring…
                </button>
                <button type="submit" disabled={submitJob.isPending || !project || !cluster || !owner.trim()} className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
                  {submitJob.isPending ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <PlayIcon className="h-4 w-4" />}
                  Submit Job
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 lg:mt-0 lg:sticky lg:top-4">
            <YamlPreview
              yaml={toYamlPreview(
                buildSingleJobPreview({
                  project,
                  cluster,
                  pipeline,
                  owner,
                  priority,
                  exclusive,
                  pullSha,
                  args: preset ? [preset] : [],
                  configOverrides: withVersionOverride(project, showVersion ? version : '', configOverrides),
                  schedule: scheduling.mode === 'recurring' ? scheduling.scheduleUtc : '',
                  scheduledStartTime: scheduling.mode === 'defer' ? scheduling.scheduledStartTimeUtc : null,
                })
              )}
            />
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Schedules Tab ──────────────────────────────────────────────────────
//
// Shows the native Fournos recurring jobs (FournosJob.spec.schedule) and
// cluster locks (FournosJob.spec.lockOnly) living in the fournos namespace
// right now — not a Control Center-managed concept, so this is always in
// sync with `kubectl get fjob` and with the Live Jobs tab.

function SchedulesFilterBar({
  search,
  onSearch,
  cluster,
  onCluster,
  status,
  onStatus,
  clusterOptions,
  statusOptions,
  count,
  countLabel,
}: {
  search: string
  onSearch: (v: string) => void
  cluster: string
  onCluster: (v: string) => void
  status: string
  onStatus: (v: string) => void
  clusterOptions: string[]
  statusOptions: string[]
  count: number
  countLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name, project, owner…"
          className="w-56 rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <SearchableSelect value={cluster} onChange={onCluster} options={clusterOptions} placeholder="All clusters" className="w-44" />
      <SearchableSelect value={status} onChange={onStatus} options={statusOptions} placeholder="All statuses" className="w-44" />
      {(search || cluster || status) && (
        <button
          onClick={() => { onSearch(''); onCluster(''); onStatus('') }}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-600"
        >
          <XMarkIcon className="h-3.5 w-3.5" /> Clear
        </button>
      )}
      <span className="ml-auto text-xs text-gray-400">{count} {countLabel}</span>
    </div>
  )
}

function RecurringJobsPanel() {
  const { data: recurringJobs, isLoading } = useRecurringJobs()
  const triggerRecurring = useTriggerRecurringJob()
  const deleteRecurring = useDeleteRecurringJob()
  const [search, setSearch] = useState('')
  const [cluster, setCluster] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<SortState>({ by: '', dir: 'asc' })

  const clusterOptions = useMemo(
    () => Array.from(new Set((recurringJobs || []).map((r) => r.cluster))).sort(),
    [recurringJobs]
  )
  const statusOptions = useMemo(
    () => Array.from(new Set((recurringJobs || []).map((r) => r.phase).filter(Boolean))).sort(),
    [recurringJobs]
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = (recurringJobs || []).filter((r) => {
      if (cluster && r.cluster !== cluster) return false
      if (status && r.phase !== status) return false
      if (q && !`${r.name} ${r.project} ${r.owner}`.toLowerCase().includes(q)) return false
      return true
    })
    return sortRows(rows, sort, {
      name: (r) => r.name.toLowerCase(),
      project: (r) => r.project.toLowerCase(),
      schedule: (r) => r.schedule,
      cluster: (r) => r.cluster.toLowerCase(),
      phase: (r) => r.phase || '',
      last_run: (r) => r.last_scheduled_time || '',
    })
  }, [recurringJobs, search, cluster, status, sort])

  return (
    <div className="space-y-4">
      <SchedulesFilterBar
        search={search} onSearch={setSearch}
        cluster={cluster} onCluster={setCluster}
        status={status} onStatus={setStatus}
        clusterOptions={clusterOptions} statusOptions={statusOptions}
        count={filtered.length} countLabel="recurring jobs"
      />
      <div className="overflow-hidden rounded-xl border border-gray-200">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading recurring jobs…</div>
        ) : !filtered.length ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {recurringJobs?.length ? 'No recurring jobs match these filters.' : 'No recurring jobs in the fournos namespace right now.'}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <SortableTh label="Name" sortKey="name" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Project" sortKey="project" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Schedule (UTC)" sortKey="schedule" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Cluster" sortKey="cluster" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Phase" sortKey="phase" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Last Run" sortKey="last_run" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map((r: RecurringJob) => (
                <tr key={r.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">
                    <Link to={`/testing/schedules/${r.name}/runs`} className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:text-indigo-800">
                      <CalendarDaysIcon className="h-4 w-4 text-teal-500" /> {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">{r.project}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">{r.schedule}</code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">{r.cluster}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[r.phase] || STATUS_COLORS.Unknown)}>
                      {r.phase || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{r.last_scheduled_time ? formatAge(r.last_scheduled_time) + ' ago' : 'never'}</td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin() && (
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => triggerRecurring.mutate(r.name)} className="text-xs font-medium text-indigo-500 hover:text-indigo-700" title="Trigger an off-cycle run now">
                          Trigger Now
                        </button>
                        <button onClick={() => { if (confirm(`Delete recurring job "${r.name}"?`)) deleteRecurring.mutate(r.name) }} className="text-gray-400 hover:text-red-600" title="Delete">
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ClusterLocksPanel() {
  const { data: locks, isLoading } = useClusterLocks()
  const deleteLock = useDeleteClusterLock()
  const [search, setSearch] = useState('')
  const [cluster, setCluster] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<SortState>({ by: '', dir: 'asc' })

  const clusterOptions = useMemo(
    () => Array.from(new Set((locks || []).map((l) => l.cluster))).sort(),
    [locks]
  )
  const statusOptions = useMemo(
    () => Array.from(new Set((locks || []).map((l) => l.phase).filter(Boolean))).sort(),
    [locks]
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = (locks || []).filter((l) => {
      if (cluster && l.cluster !== cluster) return false
      if (status && l.phase !== status) return false
      if (q && !`${l.cluster} ${l.reason} ${l.owner}`.toLowerCase().includes(q)) return false
      return true
    })
    return sortRows(rows, sort, {
      cluster: (l) => l.cluster.toLowerCase(),
      reason: (l) => (l.reason || '').toLowerCase(),
      owner: (l) => (l.owner || '').toLowerCase(),
      starts: (l) => l.scheduled_start_time || l.created_at || '',
      until: (l) => l.lock_until || '',
      phase: (l) => l.phase || '',
    })
  }, [locks, search, cluster, status, sort])

  return (
    <div className="space-y-4">
      <SchedulesFilterBar
        search={search} onSearch={setSearch}
        cluster={cluster} onCluster={setCluster}
        status={status} onStatus={setStatus}
        clusterOptions={clusterOptions} statusOptions={statusOptions}
        count={filtered.length} countLabel="cluster locks"
      />
      <div className="overflow-hidden rounded-xl border border-gray-200">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading cluster locks…</div>
        ) : !filtered.length ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {locks?.length ? 'No cluster locks match these filters.' : 'No active or scheduled cluster locks.'}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <SortableTh label="Cluster" sortKey="cluster" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Reason" sortKey="reason" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Owner" sortKey="owner" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Starts" sortKey="starts" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Until" sortKey="until" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <SortableTh label="Phase" sortKey="phase" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map((l: ClusterLock) => (
                <tr key={l.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    <span className="inline-flex items-center gap-1.5">
                      <LockClosedIcon className="h-4 w-4 text-amber-500" /> {l.cluster}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{l.reason || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{l.owner || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{l.scheduled_start_time ? new Date(l.scheduled_start_time).toLocaleString() : 'now'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{l.lock_until ? new Date(l.lock_until).toLocaleString() : 'indefinite'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[l.phase] || STATUS_COLORS.Unknown)}>
                      {l.phase || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin() && (
                      <button onClick={() => { if (confirm(`Release lock on "${l.cluster}"?`)) deleteLock.mutate(l.name) }} className="text-gray-400 hover:text-red-600" title="Release lock">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const SCHEDULE_SUBTABS = [
  { id: 'recurring' as const, label: 'Recurring Jobs', icon: CalendarDaysIcon },
  { id: 'locks' as const, label: 'Cluster Locks', icon: LockClosedIcon },
]

function SchedulesTab() {
  const [subTab, setSubTab] = useState<'recurring' | 'locks'>('recurring')
  return (
    <div className="space-y-4 p-4">
      <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 p-1">
        {SCHEDULE_SUBTABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              subTab === t.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {subTab === 'recurring' ? <RecurringJobsPanel /> : <ClusterLocksPanel />}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────

export default function Testing() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'live'
  const [page, setPage] = useState(1)
  const [filterProject, setFilterProject] = useState('')
  const [filterCluster, setFilterCluster] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  // History-only date + local time-of-day range filter. Empty historyDate
  // means "no time filter" — from/to only matter once a date is picked.
  const [historyDate, setHistoryDate] = useState('')
  const [historyFromTime, setHistoryFromTime] = useState('00:00')
  const [historyToTime, setHistoryToTime] = useState('23:59')
  // Live/History are server-paginated, so sorting has to be sent to the API
  // rather than done in-browser (client-side sort would only reorder the
  // current page). Kept as two separate states since their sortable
  // columns differ slightly (Age vs. Date).
  const [liveSort, setLiveSort] = useState<SortState>({ by: '', dir: 'desc' })
  const [historySort, setHistorySort] = useState<SortState>({ by: 'date', dir: 'desc' })
  const activeSort = activeTab === 'live' ? liveSort : historySort
  const setActiveSort = activeTab === 'live' ? setLiveSort : setHistorySort
  const handleSort = (key: string) => {
    setActiveSort((prev) => toggleSort(prev, key))
    setPage(1)
  }
  const tz = browserTimezone()

  const { data: clustersData } = useClusters()
  const { data: forgeProjects } = useForgeProjects()

  const filterClusterNames = useMemo(
    () => (clustersData?.clusters || []).map((c: Cluster) => c.name),
    [clustersData]
  )
  const filterProjectNames = useMemo(
    () => (forgeProjects || []).map((p: ForgeProject) => p.name),
    [forgeProjects]
  )

  // Converted to UTC right before hitting the API — same pattern as every
  // other scheduling control (SchedulingCalendar, timezone.ts). "To" rolls
  // over to the next calendar day when it's <= "From", so a range like
  // 22:00 -> 02:00 is treated as spanning midnight rather than empty.
  const { historyStartUtc, historyEndUtc } = useMemo(() => {
    if (activeTab !== 'history' || !historyDate) return { historyStartUtc: undefined, historyEndUtc: undefined }
    const [y, mo, d] = historyDate.split('-').map(Number)
    const startUtc = datetimeLocalToUtcIso(`${historyDate}T${historyFromTime}`, tz) || undefined
    const overnight = historyToTime <= historyFromTime
    const endDate = new Date(y, mo - 1, d + (overnight ? 1 : 0))
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`
    const endUtc = datetimeLocalToUtcIso(`${endDateStr}T${historyToTime}`, tz) || undefined
    return { historyStartUtc: startUtc, historyEndUtc: endUtc }
  }, [activeTab, historyDate, historyFromTime, historyToTime, tz])

  const { data: jobsData, isLoading, refetch } = useFournosJobs({
    tab: activeTab === 'live' || activeTab === 'history' ? activeTab : undefined,
    project: filterProject || undefined,
    cluster: filterCluster || undefined,
    status: filterStatus || undefined,
    start_time: historyStartUtc,
    end_time: historyEndUtc,
    sort_by: activeSort.by || undefined,
    sort_dir: activeSort.dir,
    page,
    per_page: 50,
  })

  const cancelJob = useCancelJob()
  const deleteJob = useDeleteHistoryJob()
  const rerunJob = useRerunJob()

  const setTab = (tab: string) => {
    setSearchParams({ tab })
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-display">Testing</h1>
          <p className="mt-1 text-sm text-gray-500">
            Submit, monitor, and review FournosJob test runs
          </p>
        </div>
        {(activeTab === 'live' || activeTab === 'history') && (
          <button onClick={() => refetch()} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowPathIcon className="h-4 w-4" /> Refresh
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {TABS.map((tab) => {
            if (tab.id === 'submit' && !isAuthenticated()) return null
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={clsx(
                  'whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium flex items-center gap-1.5',
                  activeTab === tab.id
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Filters (for live/history tabs) */}
      {(activeTab === 'live' || activeTab === 'history') && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Filters</span>
          <SearchableSelect
            value={filterProject}
            onChange={(v) => { setFilterProject(v); setPage(1) }}
            options={filterProjectNames}
            placeholder="All projects"
            className="w-44"
          />
          <SearchableSelect
            value={filterCluster}
            onChange={(v) => { setFilterCluster(v); setPage(1) }}
            options={filterClusterNames}
            placeholder="All clusters"
            className="w-44"
          />
          <SearchableSelect
            value={filterStatus}
            onChange={(v) => { setFilterStatus(v); setPage(1) }}
            options={ALL_STATUSES}
            placeholder="All statuses"
            className="w-44"
          />
          {activeTab === 'history' && (
            <>
              <div className="h-5 w-px bg-gray-200" />
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={historyDate}
                  onChange={(e) => { setHistoryDate(e.target.value); setPage(1) }}
                  className="rounded-md border-gray-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => { setHistoryDate(todayDateStr()); setPage(1) }}
                  className={clsx(
                    'rounded-md border px-2 py-1.5 text-xs font-medium',
                    historyDate === todayDateStr()
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                      : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  )}
                >
                  Today
                </button>
              </div>
              {historyDate && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={historyFromTime}
                    onChange={(e) => { setHistoryFromTime(e.target.value); setPage(1) }}
                    className="rounded-md border-gray-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-400">to</span>
                  <input
                    type="time"
                    value={historyToTime}
                    onChange={(e) => { setHistoryToTime(e.target.value); setPage(1) }}
                    className="rounded-md border-gray-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-400" title="Times are converted to UTC using your browser's timezone before filtering">({tz})</span>
                </div>
              )}
            </>
          )}
          {(filterProject || filterCluster || filterStatus || historyDate) && (
            <button
              onClick={() => {
                setFilterProject(''); setFilterCluster(''); setFilterStatus('')
                setHistoryDate(''); setHistoryFromTime('00:00'); setHistoryToTime('23:59')
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-600"
              title="Clear filters"
            >
              <XMarkIcon className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400">
            {jobsData?.total ?? 0} {activeTab === 'live' ? 'active' : 'archived'} jobs
          </span>
        </div>
      )}

      {/* Content */}
      {activeTab === 'submit' ? (
        <div className="rounded-xl bg-white shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Submit FournosJob</h2>
          <SubmitForm onSubmitted={() => setTab('live')} />
        </div>
      ) : (
      <div className="card">
        {activeTab === 'live' && (
          isLoading ? (
            <div className="text-center py-12 text-gray-400">Loading live jobs...</div>
          ) : (
            <>
              <JobsTable
                jobs={jobsData?.jobs ?? []}
                source="live"
                sort={liveSort}
                onSort={handleSort}
                onCancel={(name) => { if (confirm(`Cancel job "${name}"?`)) cancelJob.mutate(name) }}
              />
              {(jobsData?.total ?? 0) > 50 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="text-sm text-gray-500 disabled:opacity-40">Previous</button>
                  <span className="text-sm text-gray-500">Page {page}</span>
                  <button disabled={(jobsData?.jobs.length ?? 0) < 50} onClick={() => setPage(p => p + 1)} className="text-sm text-gray-500 disabled:opacity-40">Next</button>
                </div>
              )}
            </>
          )
        )}

        {activeTab === 'history' && (
          isLoading ? (
            <div className="text-center py-12 text-gray-400">Loading history...</div>
          ) : (
            <>
              <JobsTable
                jobs={jobsData?.jobs ?? []}
                source="history"
                sort={historySort}
                onSort={handleSort}
                onDelete={(name) => { if (confirm(`Delete job "${name}" from history?`)) deleteJob.mutate(name) }}
                onRerun={(name) => rerunJob.mutate(name)}
              />
              {(jobsData?.total ?? 0) > 50 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="text-sm text-gray-500 disabled:opacity-40">Previous</button>
                  <span className="text-sm text-gray-500">Page {page} of {Math.ceil((jobsData?.total ?? 0) / 50)}</span>
                  <button disabled={(jobsData?.jobs.length ?? 0) < 50} onClick={() => setPage(p => p + 1)} className="text-sm text-gray-500 disabled:opacity-40">Next</button>
                </div>
              )}
            </>
          )
        )}

        {activeTab === 'schedules' && <SchedulesTab />}
      </div>
      )}
    </div>
  )
}
