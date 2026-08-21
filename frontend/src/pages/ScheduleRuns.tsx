import { useParams, Link } from 'react-router-dom'
import { ArrowLeftIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { useScheduleRuns } from '../hooks/useFournos'
import type { ScheduleRun } from '../types'

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
  const { data: runs, isLoading } = useScheduleRuns(name)

  return (
    <div className="space-y-6">
      <div>
        <Link to="/testing?tab=schedules" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
          <ArrowLeftIcon className="h-4 w-4" /> Back to Schedules
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Schedule Runs: <span className="font-mono">{name}</span></h1>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <ArrowPathIcon className="h-8 w-8 text-gray-300 animate-spin" />
          </div>
        ) : !runs?.length ? (
          <div className="text-center py-12 text-gray-500">No runs recorded for this schedule</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Preset</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trigger</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {runs.map((run: ScheduleRun) => (
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
                    <td className="px-4 py-3 text-sm text-gray-500">{run.preset || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 capitalize">{run.trigger_type}</td>
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
