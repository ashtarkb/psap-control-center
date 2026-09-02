import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeftIcon, ArrowPathIcon, PlayIcon, TrashIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { isAdmin } from '../stores/authStore'
import { useRecurringJobChildren, useTriggerRecurringJob, useDeleteRecurringJob } from '../hooks/useFournos'
import type { ScheduleChildJob } from '../types'

const STATUS_COLORS: Record<string, string> = {
  Running: 'bg-blue-100 text-blue-800',
  Succeeded: 'bg-green-100 text-green-800',
  Failed: 'bg-red-100 text-red-800',
  Stopped: 'bg-yellow-100 text-yellow-800',
  Pending: 'bg-gray-100 text-gray-700',
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '-'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
}

export default function ScheduleRuns() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const { data: runs, isLoading } = useRecurringJobChildren(name)
  const triggerRecurring = useTriggerRecurringJob()
  const deleteRecurring = useDeleteRecurringJob()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/testing?tab=schedules" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
            <ArrowLeftIcon className="h-4 w-4" /> Back to Schedules
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Recurring Job: <span className="font-mono">{name}</span></h1>
          <p className="mt-1 text-sm text-gray-500">Child jobs created by this recurring FournosJob, newest first.</p>
        </div>
        {isAdmin() && name && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => triggerRecurring.mutate(name)}
              disabled={triggerRecurring.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <PlayIcon className="h-4 w-4" /> Trigger Now
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete recurring job "${name}"? This stops future runs; past child jobs stay in history.`)) {
                  deleteRecurring.mutate(name, { onSuccess: () => navigate('/testing?tab=schedules') })
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <TrashIcon className="h-4 w-4" /> Delete Schedule
            </button>
          </div>
        )}
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <ArrowPathIcon className="h-8 w-8 text-gray-300 animate-spin" />
          </div>
        ) : !runs?.length ? (
          <div className="text-center py-12 text-gray-500">No child jobs recorded for this recurring job yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {runs.map((run: ScheduleChildJob) => (
                  <tr key={run.name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      <Link to={`/testing/jobs/${run.name}`} className="text-indigo-600 hover:text-indigo-800 font-medium">
                        {run.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[run.status] || 'bg-gray-100 text-gray-500')}>
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDuration(run.duration_seconds)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {run.created_at ? new Date(run.created_at).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {run.mlflow_url && (
                        <a href={run.mlflow_url} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700 text-xs">
                          MLflow
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
