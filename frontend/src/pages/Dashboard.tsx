import { Link } from 'react-router-dom'
import {
  ServerStackIcon,
  CalendarDaysIcon,
  CpuChipIcon,
  UserGroupIcon,
  CheckCircleIcon,
  FireIcon,
  LockClosedIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { useQueries } from '@tanstack/react-query'
import { useClusters } from '../hooks/useClusters'
import { useReservations } from '../hooks/useReservations'
import { useHearthClusters } from '../hooks/useHearth'
import { clusterApi } from '../services/api'
import { format } from 'date-fns'
import type { HearthCluster, GpuAllocationStatus } from '../types'
import GpuDonutChart from '../components/GpuDonutChart'

export default function Dashboard() {
  const { data: clustersData, isLoading: clustersLoading } = useClusters()
  const { data: reservationsData, isLoading: reservationsLoading } = useReservations()
  
  const { data: hearthData } = useHearthClusters()
  const hearthClusters = hearthData?.clusters || []
  const hearthAvailable = hearthData?.available ?? false

  const clusters = clustersData?.clusters || []
  const reservations = reservationsData?.reservations || []

  const healthyClusters = clusters.filter((c) => c.status === 'healthy').length
  const activeReservations = reservations.filter((r) => r.status === 'active').length
  const gpuReservations = reservations.filter((r) => r.status === 'active' && r.reservation_type === 'gpu')
  const totalReservedGpus = gpuReservations.reduce((sum, r) => sum + (r.gpu_count || 0), 0)

  const healthyClusterIds = clusters.filter((c) => c.status === 'healthy').map((c) => c.id)
  const gpuStatusQueries = useQueries({
    queries: healthyClusterIds.map((id) => ({
      queryKey: ['gpu-status', id],
      queryFn: () => clusterApi.getGpuStatus(id),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  })

  const gpuTotals = gpuStatusQueries.reduce(
    (acc, q) => {
      const data = q.data as GpuAllocationStatus | undefined
      if (data) {
        acc.total += data.total_gpus
        acc.allocated += data.allocated_gpus
      }
      return acc
    },
    { total: 0, allocated: 0 }
  )
  const gpuStatusLoading = gpuStatusQueries.some((q) => q.isLoading)
  const totalGpus = gpuTotals.total || clusters.reduce((sum, c) => sum + parseInt(c.gpu_count || '0'), 0)

  const stats = [
    {
      name: 'Total Clusters',
      value: clusters.length,
      icon: ServerStackIcon,
      color: 'bg-blue-500',
      href: '/clusters',
    },
    {
      name: 'Healthy Clusters',
      value: healthyClusters,
      icon: CheckCircleIcon,
      color: 'bg-green-500',
      href: '/clusters',
    },
    {
      name: 'Active Reservations',
      value: activeReservations,
      icon: UserGroupIcon,
      color: 'bg-orange-500',
      href: '/reservations',
    },
  ]

  // Separate active, upcoming (scheduled), and past reservations
  const activeReservationsList = reservations.filter((r) => r.status === 'active')
  const upcomingReservations = reservations
    .filter((r) => r.status === 'scheduled')
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
  const pastReservations = reservations
    .filter((r) => r.status === 'completed' || r.status === 'cancelled' || r.status === 'denied')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-display">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Overview of your cluster infrastructure and reservations
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/clusters" className="btn-secondary">
            View Clusters
          </Link>
          <Link to="/calendar" className="btn-primary">
            <CalendarDaysIcon className="h-4 w-4 mr-2" />
            Open Calendar
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.name}
            to={stat.href}
            className="card p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center">
              <div className={`${stat.color} rounded-lg p-3`}>
                <stat.icon className="h-6 w-6 text-white" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">{stat.name}</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {clustersLoading || reservationsLoading ? '...' : stat.value}
                </p>
              </div>
            </div>
          </Link>
        ))}
        <Link
          to="/clusters"
          className="card p-6 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-4">
            {clustersLoading || gpuStatusLoading ? (
              <div className="bg-purple-500 rounded-lg p-3">
                <CpuChipIcon className="h-6 w-6 text-white" />
              </div>
            ) : (
              <GpuDonutChart used={gpuTotals.allocated} total={totalGpus} size={64} strokeWidth={7} />
            )}
            <div>
              <p className="text-sm font-medium text-gray-500">GPU Utilization</p>
              {clustersLoading || gpuStatusLoading ? (
                <p className="text-2xl font-semibold text-gray-900">...</p>
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <p className="text-2xl font-semibold text-gray-900">{gpuTotals.allocated}</p>
                  <p className="text-sm text-gray-400">/</p>
                  <p className="text-lg text-gray-500">{totalGpus}</p>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-0.5">used / total</p>
            </div>
          </div>
        </Link>
      </div>

      {/* GPU Reservation Summary */}
      {totalReservedGpus > 0 && (
        <div className="card p-4 bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CpuChipIcon className="h-6 w-6 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-gray-700">GPU Reservations Active</p>
                <p className="text-xs text-gray-500">{gpuReservations.length} reservation{gpuReservations.length !== 1 ? 's' : ''} using partial GPUs</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-purple-700">{totalReservedGpus}</p>
              <p className="text-xs text-gray-500">GPUs reserved of {totalGpus} total</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Cluster Status</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {clustersLoading ? (
              <div className="px-6 py-8 text-center text-gray-500">Loading clusters...</div>
            ) : clusters.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <ServerStackIcon className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-500">No clusters configured</p>
                <Link to="/clusters" className="mt-3 inline-block text-sm text-primary-600 hover:text-primary-700">
                  Add your first cluster
                </Link>
              </div>
            ) : (
              clusters.slice(0, 5).map((cluster) => {
                const gpuData = gpuStatusQueries.find(
                  (_q, i) => healthyClusterIds[i] === cluster.id
                )?.data as GpuAllocationStatus | undefined
                const clusterTotal = gpuData?.total_gpus ?? parseInt(cluster.gpu_count || '0')
                const clusterUsed = gpuData?.allocated_gpus ?? 0

                return (
                  <Link
                    key={cluster.id}
                    to={`/clusters/${cluster.id}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-3 w-3 rounded-full ${
                          cluster.status === 'healthy'
                            ? 'bg-green-500'
                            : cluster.status === 'error'
                            ? 'bg-orange-500'
                            : 'bg-yellow-500'
                        }`}
                      />
                      <div>
                        <p className="font-medium text-gray-900">{cluster.name}</p>
                        <p className="text-sm text-gray-500">
                          {cluster.node_count || '?'} nodes · {clusterUsed}/{clusterTotal} GPUs
                          {cluster.gpu_type && <span className="ml-1">({cluster.gpu_type})</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {clusterTotal > 0 && (
                        <GpuDonutChart used={clusterUsed} total={clusterTotal} size={40} strokeWidth={5} />
                      )}
                      <span
                        className={`badge ${
                          cluster.status === 'healthy'
                            ? 'badge-success'
                            : cluster.status === 'error'
                            ? 'badge-error'
                            : 'badge-warning'
                        }`}
                      >
                        {cluster.status}
                      </span>
                    </div>
                  </Link>
                )
              })
            )}
          </div>
          {clusters.length > 5 && (
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
              <Link to="/clusters" className="text-sm text-primary-600 hover:text-primary-700">
                View all {clusters.length} clusters →
              </Link>
            </div>
          )}
        </div>

        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 bg-green-50">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <h2 className="text-lg font-semibold text-gray-900">Active Reservations</h2>
            </div>
          </div>
          <div className="divide-y divide-gray-200">
            {reservationsLoading ? (
              <div className="px-6 py-8 text-center text-gray-500">Loading reservations...</div>
            ) : activeReservationsList.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <CalendarDaysIcon className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-500">No active reservations</p>
                <Link to="/reservations" className="mt-3 inline-block text-sm text-primary-600 hover:text-primary-700">
                  Create a reservation
                </Link>
              </div>
            ) : (
              activeReservationsList.slice(0, 5).map((reservation) => (
                <div
                  key={reservation.id}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-1 rounded-full"
                      style={{ backgroundColor: reservation.color }}
                    />
                    <div>
                      <p className="font-medium text-gray-900">
                        {reservation.title}
                        {reservation.reservation_type === 'gpu' && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800">
                            {reservation.gpu_count} GPU
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-gray-500">
                        {reservation.cluster_name || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {reservation.user_name}{reservation.team && ` · ${reservation.team}`}
                        {reservation.enforcement_namespace && (
                          <span className="ml-1 font-mono">
                            ({reservation.enforcement_namespace})
                            {reservation.enforcement_status && (
                              <span className={`ml-1 px-1 py-0.5 rounded text-[9px] font-medium ${
                                reservation.enforcement_status === 'provisioned' ? 'bg-green-100 text-green-800' :
                                reservation.enforcement_status === 'error' ? 'bg-orange-100 text-orange-800' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {reservation.enforcement_status}
                              </span>
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-gray-600">
                      {format(new Date(reservation.start_time), 'MMM d, h:mm a')}
                    </p>
                    <p className="text-gray-500">
                      to {format(new Date(reservation.end_time), 'MMM d, h:mm a')}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          {activeReservationsList.length > 5 && (
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
              <Link to="/reservations" className="text-sm text-primary-600 hover:text-primary-700">
                View all active reservations →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Hearth GPU Cluster Status */}
      {hearthAvailable && hearthClusters.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FireIcon className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-semibold text-gray-900">Hearth GPU Clusters</h2>
              </div>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                via FournosCluster CRDs
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Auto-discovered clusters with GPU hardware and Kueue quota status
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cluster
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    GPU Hardware
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Kubeconfig
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Lock Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Owner
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {hearthClusters.map((hc: HearthCluster) => (
                  <tr key={hc.name} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <ServerStackIcon className="h-5 w-5 text-gray-400" />
                        <span className="font-medium text-gray-900">{hc.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {hc.gpu_summary ? (
                        <div className="flex items-center gap-2">
                          <CpuChipIcon className="h-4 w-4 text-purple-500" />
                          <span className="text-sm font-medium text-gray-900">{hc.gpu_summary}</span>
                        </div>
                      ) : hc.hardware?.last_error ? (
                        <div className="flex items-center gap-1 text-sm text-orange-600">
                          <ExclamationTriangleIcon className="h-4 w-4" />
                          Discovery error
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">Pending discovery</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`badge ${
                        hc.kubeconfig_status === 'Valid' ? 'badge-success' :
                        hc.kubeconfig_status === 'Unreachable' ? 'badge-error' :
                        'badge-warning'
                      }`}>
                        {hc.kubeconfig_status || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {hc.locked ? (
                        <span className="flex items-center gap-1 text-sm font-medium text-orange-600">
                          <LockClosedIcon className="h-4 w-4" />
                          Locked
                          {hc.lock_expires_at && (
                            <span className="text-xs text-gray-400 ml-1">
                              (expires {format(new Date(hc.lock_expires_at), 'MMM d, h:mm a')})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-sm text-green-600">Available</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {hc.owner || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
            {hearthClusters.length} cluster{hearthClusters.length !== 1 ? 's' : ''} discovered
            {' · '}
            {hearthClusters.reduce((sum, c) => sum + (c.hardware?.total_gpus || 0), 0)} total GPUs
            {' · '}
            {hearthClusters.filter(c => c.locked).length} locked
          </div>
        </div>
      )}

      {/* Upcoming Reservations */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Upcoming Reservations</h2>
          <p className="text-sm text-gray-500 mt-1">Scheduled reservations for the next 7 days</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reservation
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cluster
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reservationsLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : upcomingReservations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No upcoming reservations scheduled
                  </td>
                </tr>
              ) : (
                upcomingReservations.slice(0, 10).map((reservation) => (
                  <tr key={reservation.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-8 w-1 rounded-full"
                          style={{ backgroundColor: reservation.color }}
                        />
                        <span className="font-medium text-gray-900">{reservation.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {reservation.cluster_name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <p className="text-sm text-gray-900">{reservation.user_name}</p>
                        {reservation.team && (
                          <p className="text-xs text-gray-500">{reservation.team}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      <div>
                        <p className="text-gray-900">{format(new Date(reservation.start_time), 'MMM d, yyyy h:mm a')}</p>
                        <p className="text-xs">to {format(new Date(reservation.end_time), 'MMM d, yyyy h:mm a')}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="badge badge-info">
                        scheduled
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Past Reservations */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Past Reservations</h2>
          <p className="text-sm text-gray-500 mt-1">Completed reservations from the last 30 days</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reservation
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cluster
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reservationsLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : pastReservations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No past reservations
                  </td>
                </tr>
              ) : (
                pastReservations.slice(0, 10).map((reservation) => (
                  <tr key={reservation.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-8 w-1 rounded-full opacity-50"
                          style={{ backgroundColor: reservation.color }}
                        />
                        <span className="font-medium text-gray-600">{reservation.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {reservation.cluster_name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <p className="text-sm text-gray-600">{reservation.user_name}</p>
                        {reservation.team && (
                          <p className="text-xs text-gray-400">{reservation.team}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      <div>
                        <p className="text-gray-600">{format(new Date(reservation.start_time), 'MMM d, yyyy h:mm a')}</p>
                        <p className="text-xs text-gray-400">to {format(new Date(reservation.end_time), 'MMM d, yyyy h:mm a')}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`badge ${
                          reservation.status === 'completed'
                            ? 'badge-success'
                            : 'badge-error'
                        }`}
                      >
                        {reservation.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pastReservations.length > 10 && (
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
            <Link to="/reservations" className="text-sm text-primary-600 hover:text-primary-700">
              View all past reservations →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
