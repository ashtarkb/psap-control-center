import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeftIcon,
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { isAdmin } from '../stores/authStore'
import {
  useFournosJob,
  useFournosJobEvents,
  useCancelJob,
  useRerunJob,
} from '../hooks/useFournos'
import type { PipelineStage, FournosPod, TaskProgress } from '../types'

const PHASE_COLORS: Record<string, string> = {
  Running: 'bg-blue-500',
  Succeeded: 'bg-green-500',
  Failed: 'bg-red-500',
  Stopped: 'bg-yellow-500',
  Pending: 'bg-gray-300',
  Cancelled: 'bg-gray-400',
  Skipped: 'bg-gray-200',
}

const STATUS_BADGE: Record<string, string> = {
  Running: 'bg-blue-100 text-blue-800',
  Succeeded: 'bg-green-100 text-green-800',
  Failed: 'bg-red-100 text-red-800',
  Stopped: 'bg-yellow-100 text-yellow-800',
  Pending: 'bg-gray-100 text-gray-700',
  Resolving: 'bg-purple-100 text-purple-800',
  Admitted: 'bg-indigo-100 text-indigo-800',
}

function formatDuration(startStr: string | null, endStr: string | null): string {
  if (!startStr) return ''
  const start = new Date(startStr).getTime()
  const end = endStr ? new Date(endStr).getTime() : Date.now()
  const s = Math.max(0, Math.floor((end - start) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

// ─── Pipeline Timeline ──────────────────────────────────────────────────

function PipelineTimeline({ stages }: { stages: PipelineStage[] }) {
  if (!stages.length) return null

  const mainStages = stages.filter((s) => !s.finally)
  const finallyStages = stages.filter((s) => s.finally)
  const pct = 100 / (stages.length || 1)

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Pipeline Timeline</h3>
      <div className="flex gap-0.5 h-8 rounded-lg overflow-hidden">
        {mainStages.map((stage) => (
          <div
            key={stage.name}
            style={{ width: `${pct}%`, minWidth: 8 }}
            className={clsx(
              'relative group',
              PHASE_COLORS[stage.status] || 'bg-gray-200',
              stage.status === 'Running' && 'animate-pulse'
            )}
            title={`${stage.displayName}: ${stage.status}`}
          >
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
              {stage.displayName} — {stage.status}
              {stage.startTime && (
                <span className="ml-1 text-gray-300">
                  ({formatDuration(stage.startTime, stage.completionTime)})
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {finallyStages.length > 0 && (
        <>
          <p className="text-xs text-gray-400">Finally</p>
          <div className="flex gap-0.5 h-4 rounded overflow-hidden">
            {finallyStages.map((stage) => (
              <div
                key={stage.name}
                style={{ width: `${100 / finallyStages.length}%`, minWidth: 8 }}
                className={clsx(PHASE_COLORS[stage.status] || 'bg-gray-200', stage.status === 'Running' && 'animate-pulse')}
                title={`${stage.displayName}: ${stage.status}`}
              />
            ))}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
        {stages.map((stage) => (
          <div key={stage.name} className="flex items-center gap-2 text-xs">
            <span className={clsx('w-2 h-2 rounded-full shrink-0', PHASE_COLORS[stage.status] || 'bg-gray-200')} />
            <span className="text-gray-700 truncate">{stage.displayName}</span>
            <span className="text-gray-400 ml-auto">{formatDuration(stage.startTime, stage.completionTime)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Task Progress ──────────────────────────────────────────────────────

function TaskProgressBar({ progress }: { progress: TaskProgress }) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{progress.completed}/{progress.total} tasks</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-3 text-xs text-gray-400">
        {progress.failed > 0 && <span className="text-red-500">{progress.failed} failed</span>}
        {progress.cancelled > 0 && <span>{progress.cancelled} cancelled</span>}
        {progress.skipped > 0 && <span>{progress.skipped} skipped</span>}
      </div>
    </div>
  )
}

// ─── Conditions ─────────────────────────────────────────────────────────

function ConditionsPanel({ conditions }: { conditions: Array<Record<string, string>> }) {
  if (!conditions?.length) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">Conditions</h3>
      <div className="space-y-1">
        {conditions.map((c, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span className={clsx('mt-0.5 w-2 h-2 rounded-full shrink-0', c.status === 'True' ? 'bg-green-500' : c.status === 'False' ? 'bg-red-500' : 'bg-gray-300')} />
            <div>
              <span className="font-medium text-gray-700">{c.type}</span>
              {c.reason && <span className="text-gray-400 ml-1">({c.reason})</span>}
              {c.message && <p className="text-gray-500 mt-0.5">{c.message}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Pods ───────────────────────────────────────────────────────────────

function PodsPanel({
  pods,
  onSelectPod,
  selectedPod,
}: {
  pods: FournosPod[]
  onSelectPod: (name: string) => void
  selectedPod: string
}) {
  if (!pods.length) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">Pods ({pods.length})</h3>
      <div className="space-y-1">
        {pods.map((pod) => (
          <button
            key={pod.name}
            onClick={() => onSelectPod(pod.name)}
            className={clsx(
              'w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between',
              selectedPod === pod.name ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50'
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <span className={clsx('w-2 h-2 rounded-full', pod.ready ? 'bg-green-500' : pod.phase === 'Running' ? 'bg-blue-500 animate-pulse' : 'bg-gray-300')} />
              <span className="truncate font-mono">{pod.name}</span>
            </div>
            <span className="text-gray-400 ml-2">{pod.age_minutes}m</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Log Viewer ─────────────────────────────────────────────────────────

function LogViewer({ jobName, podName }: { jobName: string; podName: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    setLines([])
    setConnected(false)
    const evtSource = new EventSource(`/api/v1/fournos/jobs/${jobName}/logs/${podName}`)
    evtSource.onopen = () => setConnected(true)
    evtSource.onmessage = (event) => {
      setLines((prev) => [...prev, event.data])
    }
    evtSource.onerror = () => {
      setConnected(false)
      evtSource.close()
    }
    return () => evtSource.close()
  }, [jobName, podName])

  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, autoScroll])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <DocumentTextIcon className="h-4 w-4" />
          Logs — <span className="font-mono text-xs text-gray-500">{podName}</span>
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className={clsx('flex items-center gap-1', connected ? 'text-green-600' : 'text-gray-400')}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300')} />
            {connected ? 'Live' : 'Disconnected'}
          </span>
          <label className="flex items-center gap-1 text-gray-500">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="rounded border-gray-300 text-indigo-600 h-3 w-3" />
            Auto-scroll
          </label>
        </div>
      </div>
      <div className="bg-gray-950 rounded-lg p-4 h-96 overflow-y-auto font-mono text-xs text-gray-300 leading-relaxed">
        {lines.length === 0 && !connected && <span className="text-gray-500">Waiting for logs...</span>}
        {lines.map((line, i) => (
          <div key={i} className="hover:bg-gray-800/50">{line}</div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────

export default function TestingJobDetail() {
  const { name } = useParams<{ name: string }>()
  const { data, isLoading, error } = useFournosJob(name)
  const { data: events } = useFournosJobEvents(name)
  const cancelJob = useCancelJob()
  const rerunJob = useRerunJob()
  const [selectedPod, setSelectedPod] = useState('')
  const [showSpec, setShowSpec] = useState(false)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <ArrowPathIcon className="h-8 w-8 text-gray-300 animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link to="/testing" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </Link>
        <div className="card p-8 text-center text-gray-500">Job not found</div>
      </div>
    )
  }

  const { job, pods, stages, current_step, forge_info, task_progress } = data
  const meta = job.metadata as Record<string, unknown>
  const spec = job.spec as Record<string, unknown>
  const status = job.status as Record<string, unknown>
  const phase = (status.phase as string) || 'Unknown'
  const message = (status.message as string) || ''
  const conditions = (status.conditions as Array<Record<string, string>>) || []
  const isRunning = ['Running', 'Pending', 'Admitted', 'Resolving'].includes(phase)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/testing" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
            <ArrowLeftIcon className="h-4 w-4" /> Back to Testing
          </Link>
          <h1 className="text-xl font-bold text-gray-900 font-mono">{name}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
            {forge_info.project && <span className="font-medium text-gray-700">{forge_info.project}</span>}
            {forge_info.args?.length > 0 && <span>{forge_info.args.join(' ')}</span>}
            <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_BADGE[phase] || 'bg-gray-100 text-gray-600')}>
              {phase}
            </span>
            {job.source === 'history' && <span className="text-xs text-gray-400">(from history)</span>}
          </div>
        </div>

        {isAdmin() && (
          <div className="flex gap-2">
            {isRunning && (
              <button onClick={() => { if (confirm(`Cancel "${name}"?`)) cancelJob.mutate(name!) }} className="inline-flex items-center gap-1 rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">
                <StopIcon className="h-4 w-4" /> Cancel
              </button>
            )}
            <button onClick={() => rerunJob.mutate(name!)} disabled={rerunJob.isPending} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
              <PlayIcon className="h-4 w-4" /> Re-run
            </button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Cluster</p>
          <p className="text-sm font-medium text-gray-900">{(spec.cluster as string) || '-'}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Pipeline</p>
          <p className="text-sm font-medium text-gray-900">{(spec.pipeline as string) || '-'}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Owner</p>
          <p className="text-sm font-medium text-gray-900">{(spec.owner as string) || '-'}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Created</p>
          <p className="text-sm font-medium text-gray-900">
            {meta.creationTimestamp ? new Date(meta.creationTimestamp as string).toLocaleString() : '-'}
          </p>
        </div>
      </div>

      {/* Current step & task progress */}
      {(current_step || task_progress) && (
        <div className="card p-4 space-y-3">
          {current_step && (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-gray-500">Current step:</span>
              <span className="font-medium text-gray-900">{current_step.displayName}</span>
            </div>
          )}
          {task_progress && <TaskProgressBar progress={task_progress} />}
        </div>
      )}

      {/* Message */}
      {message && (
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Status Message</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{message}</p>
        </div>
      )}

      {/* Pipeline Timeline */}
      {stages.length > 0 && (
        <div className="card p-4">
          <PipelineTimeline stages={stages} />
        </div>
      )}

      {/* Conditions */}
      {conditions.length > 0 && (
        <div className="card p-4">
          <ConditionsPanel conditions={conditions} />
        </div>
      )}

      {/* Pods & Logs */}
      {pods.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card p-4">
            <PodsPanel pods={pods} onSelectPod={setSelectedPod} selectedPod={selectedPod} />
          </div>
          <div className="card p-4 lg:col-span-2">
            {selectedPod ? (
              <LogViewer jobName={name!} podName={selectedPod} />
            ) : (
              <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                Select a pod to view logs
              </div>
            )}
          </div>
        </div>
      )}

      {/* Events */}
      {events && events.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Event History</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {events.map((evt) => (
              <div key={evt.id} className="flex items-start gap-2 text-xs">
                <span className={clsx('mt-0.5 w-2 h-2 rounded-full shrink-0', PHASE_COLORS[evt.phase] || 'bg-gray-300')} />
                <span className="text-gray-400 shrink-0">
                  {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : ''}
                </span>
                <span className="font-medium text-gray-700">{evt.phase}</span>
                {evt.message && <span className="text-gray-500 truncate">{evt.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Forge info & PR */}
      {forge_info.pr_url && (
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Pull Request</p>
          <a href={forge_info.pr_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:text-indigo-800">
            #{forge_info.pr_number}: {forge_info.pr_title}
          </a>
        </div>
      )}

      {/* MLflow link */}
      {job.mlflow_url && (
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">MLflow</p>
          <a href={job.mlflow_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:text-indigo-800">
            View MLflow Run
          </a>
        </div>
      )}

      {/* Raw spec toggle */}
      <div className="card">
        <button onClick={() => setShowSpec(!showSpec)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-500 hover:text-gray-700">
          <span>FournosJob Spec</span>
          <ChevronDownIcon className={clsx('h-4 w-4 transition-transform', showSpec && 'rotate-180')} />
        </button>
        {showSpec && (
          <pre className="p-4 text-xs overflow-x-auto bg-gray-50 border-t border-gray-200 font-mono text-gray-600">
            {JSON.stringify(spec, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
