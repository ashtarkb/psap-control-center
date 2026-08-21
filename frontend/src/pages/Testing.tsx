import { useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  PlayIcon,
  ClockIcon,
  CalendarDaysIcon,
  PlusIcon,
  ArrowPathIcon,
  XMarkIcon,
  StopIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { isAdmin, isAuthenticated } from '../stores/authStore'
import { useClusters } from '../hooks/useClusters'
import {
  useFournosJobs,
  useFournosSchedules,
  useForgeProjects,
  usePipelines,
  useSubmitJob,
  useCancelJob,
  useDeleteHistoryJob,
  useToggleSchedule,
  useTriggerSchedule,
  useDeleteSchedule,
  useGithubPRs,
} from '../hooks/useFournos'
import type {
  FournosJobSummary,
  FournosSchedule,
  ForgeProject,
  Cluster,
} from '../types'

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

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '-'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
}

const TABS = [
  { id: 'live', label: 'Live Jobs', icon: PlayIcon },
  { id: 'history', label: 'History', icon: ClockIcon },
  { id: 'submit', label: 'Submit Job', icon: PlusIcon },
  { id: 'schedules', label: 'Schedules', icon: CalendarDaysIcon },
]

// ─── Job Table ──────────────────────────────────────────────────────────

function JobsTable({
  jobs,
  source,
  onCancel,
  onDelete,
}: {
  jobs: FournosJobSummary[]
  source: 'live' | 'history'
  onCancel?: (name: string) => void
  onDelete?: (name: string) => void
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
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Project</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cluster</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              {source === 'live' ? 'Age' : 'Duration'}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
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
                {source === 'live' ? formatAge(job.created_at) : formatDuration(job.duration_seconds)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">{job.owner || '-'}</td>
              <td className="px-4 py-3 text-sm text-right space-x-2">
                {source === 'live' && isAdmin() && ['Running', 'Pending', 'Admitted', 'Resolving'].includes(job.status) && onCancel && (
                  <button onClick={() => onCancel(job.name)} className="text-red-500 hover:text-red-700" title="Cancel">
                    <StopIcon className="h-4 w-4" />
                  </button>
                )}
                {source === 'history' && isAdmin() && onDelete && (
                  <button onClick={() => onDelete(job.name)} className="text-red-400 hover:text-red-600" title="Delete">
                    <TrashIcon className="h-4 w-4" />
                  </button>
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
  const { data: clustersData } = useClusters()
  const submitJob = useSubmitJob()
  const clusterNames = useMemo(
    () => (clustersData?.clusters || []).map((c: Cluster) => c.name),
    [clustersData]
  )

  const [project, setProject] = useState('')
  const [cluster, setCluster] = useState('')
  const [pipeline, setPipeline] = useState('forge-test-only')
  const [preset, setPreset] = useState('')
  const [version, setVersion] = useState('')
  const [owner, setOwner] = useState('')
  const [exclusive, setExclusive] = useState(false)
  const [configRaw, setConfigRaw] = useState('')
  const [pullSha, setPullSha] = useState('')
  const [prSearch, setPrSearch] = useState('')
  const [prDropdownOpen, setPrDropdownOpen] = useState(false)

  const selectedProject = useMemo(
    () => projects?.find((p: ForgeProject) => p.name === project),
    [projects, project]
  )

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const overrides: Record<string, string> = {}
    configRaw.split('\n').forEach((line: string) => {
      const idx = line.indexOf(':')
      if (idx > 0) {
        overrides[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    })

    try {
      const result = await submitJob.mutateAsync({
        project,
        cluster,
        pipeline,
        preset,
        version,
        owner,
        exclusive,
        config_overrides: overrides,
        pull_sha: pullSha,
      })
      onSubmitted?.(result.job_name)
    } catch {
      // error displayed below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {submitJob.error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {submitJob.error.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Project</label>
          <select value={project} onChange={(e) => handleProjectChange(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" required>
            <option value="">Select a project</option>
            {(projects || []).map((p: ForgeProject) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Cluster</label>
          <input
            type="text"
            list="cluster-suggestions"
            value={cluster}
            onChange={(e) => setCluster(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="Cluster name"
            required
          />
          {clusterNames.length > 0 && (
            <datalist id="cluster-suggestions">
              {clusterNames.map((name: string) => <option key={name} value={name} />)}
            </datalist>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Pipeline</label>
          <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
            {(pipelines || []).map((p: string) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

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
          {!selectedProject && project === '' && (
            <p className="mt-1 text-xs text-gray-400">Select a project first to see available presets.</p>
          )}
        </div>

        {showVersion && (
          <div>
            <label className="block text-sm font-medium text-gray-700">MCP Gateway Version</label>
            <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="v1.2.3 or commit SHA" />
            <p className="mt-1 text-xs text-gray-400">Semver tag or 40-char commit SHA for nightly builds.</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">Owner</label>
          <input type="text" value={owner} onChange={(e) => setOwner(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="your-name" />
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={exclusive} onChange={(e) => setExclusive(e.target.checked)} className="rounded border-gray-300 text-indigo-600" />
            Exclusive (lock cluster for this job)
          </label>
        </div>
      </div>

      {/* Pull Request picker */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700">Pull Request (optional)</label>
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

      <div>
        <label className="block text-sm font-medium text-gray-700">Config Overrides</label>
        <textarea value={configRaw} onChange={(e) => setConfigRaw(e.target.value)} rows={3} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono" placeholder="infrastructure.version: latest" />
        <p className="mt-1 text-xs text-gray-400">Same as /var directives. One key: value per line.</p>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={submitJob.isPending || !project || !cluster} className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
          {submitJob.isPending ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <PlayIcon className="h-4 w-4" />}
          Submit Job
        </button>
      </div>
    </form>
  )
}

// ─── Schedules Tab ──────────────────────────────────────────────────────

function SchedulesTab() {
  const { data: schedules, isLoading } = useFournosSchedules()
  const toggleSchedule = useToggleSchedule()
  const triggerSchedule = useTriggerSchedule()
  const deleteSchedule = useDeleteSchedule()

  if (isLoading) return <div className="text-center py-8 text-gray-500">Loading schedules...</div>
  if (!schedules?.length) return <div className="text-center py-12 text-gray-500">No schedules configured</div>

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Project</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Schedule</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cluster</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Run</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {schedules.map((sched: FournosSchedule) => (
            <tr key={sched.name} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm">
                <Link to={`/testing/schedules/${sched.name}/runs`} className="text-indigo-600 hover:text-indigo-800 font-medium">
                  {sched.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-sm text-gray-900">{sched.project}</td>
              <td className="px-4 py-3 text-sm text-gray-500 font-mono">{sched.schedule}</td>
              <td className="px-4 py-3 text-sm text-gray-900">{sched.cluster}</td>
              <td className="px-4 py-3 text-sm">
                <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', sched.suspend ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800')}>
                  {sched.suspend ? 'Paused' : 'Active'}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">{sched.last_schedule ? formatAge(sched.last_schedule) + ' ago' : '-'}</td>
              <td className="px-4 py-3 text-right space-x-2">
                {isAdmin() && (
                  <>
                    <button onClick={() => toggleSchedule.mutate(sched.name)} className="text-gray-500 hover:text-gray-700 text-xs" title={sched.suspend ? 'Resume' : 'Pause'}>
                      {sched.suspend ? 'Resume' : 'Pause'}
                    </button>
                    <button onClick={() => triggerSchedule.mutate(sched.name)} className="text-indigo-500 hover:text-indigo-700 text-xs" title="Run Now">
                      Run
                    </button>
                    <button onClick={() => { if (confirm(`Delete schedule "${sched.name}"?`)) deleteSchedule.mutate(sched.name) }} className="text-red-400 hover:text-red-600 text-xs" title="Delete">
                      Del
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

  const { data: jobsData, isLoading, refetch } = useFournosJobs({
    tab: activeTab === 'live' || activeTab === 'history' ? activeTab : undefined,
    project: filterProject || undefined,
    cluster: filterCluster || undefined,
    status: filterStatus || undefined,
    page,
    per_page: 50,
  })

  const cancelJob = useCancelJob()
  const deleteJob = useDeleteHistoryJob()

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
        <div className="flex flex-wrap gap-3 items-center">
          {filterProjectNames.length > 0 ? (
            <select value={filterProject} onChange={(e) => { setFilterProject(e.target.value); setPage(1) }} className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
              <option value="">All projects</option>
              {filterProjectNames.map((name: string) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <input type="text" placeholder="Filter project..." value={filterProject} onChange={(e) => { setFilterProject(e.target.value); setPage(1) }} className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm w-40" />
          )}
          <select value={filterCluster} onChange={(e) => { setFilterCluster(e.target.value); setPage(1) }} className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
            <option value="">All clusters</option>
            {filterClusterNames.map((name: string) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }} className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
            <option value="">All statuses</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(filterProject || filterCluster || filterStatus) && (
            <button onClick={() => { setFilterProject(''); setFilterCluster(''); setFilterStatus('') }} className="text-xs text-gray-400 hover:text-gray-600" title="Clear filters">
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400">
            {jobsData?.total ?? 0} {activeTab === 'live' ? 'active' : 'archived'} jobs
          </span>
        </div>
      )}

      {/* Content */}
      <div className="card">
        {activeTab === 'live' && (
          isLoading ? (
            <div className="text-center py-12 text-gray-400">Loading live jobs...</div>
          ) : (
            <>
              <JobsTable
                jobs={jobsData?.jobs ?? []}
                source="live"
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
                onDelete={(name) => { if (confirm(`Delete job "${name}" from history?`)) deleteJob.mutate(name) }}
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

        {activeTab === 'submit' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Submit FournosJob</h2>
            <SubmitForm onSubmitted={() => setTab('live')} />
          </div>
        )}

        {activeTab === 'schedules' && <SchedulesTab />}
      </div>
    </div>
  )
}
