import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CloudArrowUpIcon,
  ServerStackIcon,
  CpuChipIcon,
  CircleStackIcon,
  CubeIcon,
  Square3Stack3DIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  FireIcon,
  LockClosedIcon,
  LockOpenIcon,
  ClockIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline'
import { useDropzone } from 'react-dropzone'
import {
  useCluster,
  useClusterStatus,
  useRefreshClusterStatus,
  useUploadKubeconfig,
  useClusterTopology,
  useOcpDetails,
  useClusterOperators,
  useClusterWorkloads,
} from '../hooks/useClusters'
import { useCurrentClusterUser } from '../hooks/useReservations'
import { useHearthCluster } from '../hooks/useHearth'
import { useGpuStatus } from '../hooks/useGpuStatus'
import { useClusterCosts, useRefreshClusterCost } from '../hooks/useClusterCost'
import { format } from 'date-fns'
import clsx from 'clsx'
import type { TopologyNode, PodInfo } from '../types'

function TopologyVisualization({ 
  controlPlane, 
  workers, 
  infra,
  zones 
}: { 
  controlPlane: TopologyNode[]
  workers: TopologyNode[]
  infra: TopologyNode[]
  zones: string[]
}) {
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null)

  const NodeCard = ({ node, variant }: { node: TopologyNode; variant: 'control' | 'worker' | 'infra' }) => {
    const gradients = {
      control: 'from-violet-600 to-purple-700',
      worker: 'from-cyan-500 to-blue-600',
      infra: 'from-amber-500 to-orange-600',
    }
    const glows = {
      control: 'hover:shadow-violet-500/30',
      worker: 'hover:shadow-cyan-500/30',
      infra: 'hover:shadow-amber-500/30',
    }
    const borders = {
      control: 'border-violet-500/30',
      worker: 'border-cyan-500/30',
      infra: 'border-amber-500/30',
    }
    const rings = {
      control: 'ring-violet-400',
      worker: 'ring-cyan-400',
      infra: 'ring-amber-400',
    }
    
    const isSelected = selectedNode?.name === node.name
    const isReady = node.status === 'Ready'
    
    return (
      <div
        onClick={() => setSelectedNode(isSelected ? null : node)}
        className={clsx(
          'relative p-4 rounded-xl cursor-pointer transition-all duration-300',
          'bg-slate-900/80 backdrop-blur-sm border',
          isReady ? borders[variant] : 'border-orange-500/50',
          isSelected && 'ring-2 ring-offset-2 ring-offset-slate-950',
          isSelected && rings[variant],
          isReady ? ['hover:shadow-lg', glows[variant]] : 'hover:shadow-lg hover:shadow-orange-500/30',
          'hover:scale-[1.02] hover:-translate-y-0.5'
        )}
      >
        {/* Glow effect */}
        <div className={clsx(
          'absolute inset-0 rounded-xl opacity-20 blur-xl transition-opacity',
          isReady ? `bg-gradient-to-br ${gradients[variant]}` : 'bg-orange-500',
          isSelected ? 'opacity-40' : 'opacity-0 group-hover:opacity-20'
        )} />
        
        {/* Status indicator with pulse */}
        <div className="absolute -top-1 -right-1">
          <span className="relative flex h-3 w-3">
            {isReady && (
              <span className={clsx(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                variant === 'control' ? 'bg-violet-400' : variant === 'worker' ? 'bg-cyan-400' : 'bg-amber-400'
              )} />
            )}
            <span className={clsx(
              'relative inline-flex rounded-full h-3 w-3',
              isReady ? (variant === 'control' ? 'bg-violet-500' : variant === 'worker' ? 'bg-cyan-500' : 'bg-amber-500') : 'bg-orange-500'
            )} />
          </span>
        </div>
        
        {/* Content */}
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <div className={clsx(
              'p-1.5 rounded-lg bg-gradient-to-br',
              isReady ? gradients[variant] : 'from-red-500 to-red-700'
            )}>
              <ServerStackIcon className="h-4 w-4 text-white" />
            </div>
            <span className="font-mono text-xs text-slate-300 truncate" title={node.name}>
              {node.name.length > 18 ? `${node.name.slice(0, 18)}...` : node.name}
            </span>
          </div>
          
          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 rounded-lg bg-slate-800/50">
              <div className="text-lg font-bold text-white">{node.cpu}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">CPU</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-slate-800/50">
              <div className="text-lg font-bold text-white">{node.memory_gb}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">GB</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-slate-800/50">
              <div className={clsx(
                'text-lg font-bold',
                Number(node.gpu) > 0 ? 'text-emerald-400' : 'text-slate-600'
              )}>{node.gpu}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">GPU</div>
            </div>
          </div>
          
          {/* Pod count bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
              <span>PODS</span>
              <span className="text-slate-400">{node.pod_count}</span>
            </div>
            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={clsx(
                  'h-full rounded-full bg-gradient-to-r',
                  isReady ? gradients[variant] : 'from-red-500 to-red-700'
                )}
                style={{ width: `${Math.min((node.pod_count / 100) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative space-y-8 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 -m-6 p-8 rounded-xl min-h-[500px]">
      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/30" />
          <span className="text-slate-400">Control Plane ({controlPlane.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/30" />
          <span className="text-slate-400">Workers ({workers.length})</span>
        </div>
        {infra.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/30" />
            <span className="text-slate-400">Infra ({infra.length})</span>
          </div>
        )}
      </div>

      {/* API Server Hub */}
      <div className="flex justify-center">
        <div className="relative">
          {/* Animated rings */}
          <div className="absolute inset-0 -m-4">
            <div className="absolute inset-0 rounded-full border border-cyan-500/20 animate-ping" style={{ animationDuration: '3s' }} />
            <div className="absolute inset-2 rounded-full border border-cyan-500/30 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.5s' }} />
          </div>
          
          <div className="relative bg-gradient-to-br from-slate-800 to-slate-900 px-8 py-4 rounded-2xl border border-cyan-500/30 shadow-2xl shadow-cyan-500/20">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent rounded-2xl" />
            <div className="relative flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/30">
                <GlobeAltIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <span className="font-bold text-white tracking-wide">API SERVER</span>
                <div className="text-[10px] text-cyan-400 tracking-widest">KUBERNETES CONTROL</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection lines */}
      <div className="flex justify-center">
        <div className="relative h-12 w-px">
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/50 to-violet-500/50" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
        </div>
      </div>

      {/* Control Plane Nodes */}
      {controlPlane.length > 0 && (
        <div>
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-violet-500/30" />
            <h4 className="text-xs font-bold text-violet-400 uppercase tracking-widest px-4">Control Plane</h4>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-violet-500/30" />
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {controlPlane.map((node) => (
              <div key={node.name} className="w-52">
                <NodeCard node={node} variant="control" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection to workers */}
      <div className="flex justify-center">
        <div className="relative h-8 w-px">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/50 to-cyan-500/50" />
        </div>
      </div>

      {/* Worker Nodes */}
      <div>
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-cyan-500/30" />
          <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-widest px-4">Worker Nodes</h4>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-cyan-500/30" />
        </div>
        
        {zones.length > 1 ? (
          <div className="space-y-6">
            {zones.map((zone) => {
              const zoneWorkers = workers.filter((w) => w.zone === zone)
              if (zoneWorkers.length === 0) return null
              return (
                <div key={zone} className="bg-slate-800/30 rounded-2xl p-5 border border-slate-700/50">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
                    <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">{zone}</span>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {zoneWorkers.map((node) => (
                      <div key={node.name} className="w-52">
                        <NodeCard node={node} variant="worker" />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-4">
            {workers.map((node) => (
              <div key={node.name} className="w-52">
                <NodeCard node={node} variant="worker" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Infra Nodes */}
      {infra.length > 0 && (
        <>
          <div className="flex justify-center">
            <div className="relative h-8 w-px">
              <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/50 to-amber-500/50" />
            </div>
          </div>
          
          <div>
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-500/30" />
              <h4 className="text-xs font-bold text-amber-400 uppercase tracking-widest px-4">Infrastructure</h4>
              <div className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-500/30" />
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              {infra.map((node) => (
                <div key={node.name} className="w-52">
                  <NodeCard node={node} variant="infra" />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Selected Node Details Overlay */}
      {selectedNode && (
        <div 
          className="absolute inset-0 z-20 flex items-center justify-center p-6 rounded-xl"
          onClick={() => setSelectedNode(null)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm rounded-xl" />
          
          {/* Modal */}
          <div 
            className="relative w-full max-w-2xl max-h-full overflow-auto animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-violet-500/20 to-cyan-500/20 rounded-2xl blur-xl" />
            <div className="relative p-6 bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-700/50 shadow-2xl">
              {/* Close button */}
              <button
                onClick={() => setSelectedNode(null)}
                className="absolute top-4 right-4 p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 transition-colors text-slate-400 hover:text-white z-10"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              
              <div className="flex items-start gap-4 mb-6 pr-10">
                <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/30 flex-shrink-0">
                  <ServerStackIcon className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-lg text-white break-all">{selectedNode.name}</h4>
                  <p className="text-sm text-slate-400 mt-1">{selectedNode.roles.join(' • ')}</p>
                  <span className={clsx(
                    'inline-block mt-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider',
                    selectedNode.status === 'Ready' 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                  )}>
                    {selectedNode.status}
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: 'Instance Type', value: selectedNode.instance_type || 'N/A' },
                  { label: 'Zone', value: selectedNode.zone || 'N/A' },
                  { label: 'CPU', value: selectedNode.cpu || 'N/A' },
                  { label: 'Memory', value: `${selectedNode.memory_gb || 0} GB` },
                  { label: 'GPU Count', value: selectedNode.gpu || '0' },
                  { label: 'GPU Type', value: selectedNode.gpu_type || 'N/A', highlight: Number(selectedNode.gpu) > 0 },
                  { label: 'Pods', value: String(selectedNode.pod_count || 0) },
                  { label: 'Architecture', value: selectedNode.architecture || 'N/A' },
                  { label: 'Internal IP', value: selectedNode.internal_ip || 'N/A', mono: true },
                  { label: 'OS Image', value: selectedNode.os_image || 'N/A', full: true },
                  { label: 'Container Runtime', value: selectedNode.container_runtime || 'N/A', full: true },
                  { label: 'Kubelet Version', value: selectedNode.kubelet_version || 'N/A', full: true },
                ].map((item) => (
                  <div 
                    key={item.label} 
                    className={clsx(
                      'p-3 rounded-xl border',
                      item.full && 'sm:col-span-2',
                      item.highlight 
                        ? 'bg-emerald-500/10 border-emerald-500/30' 
                        : 'bg-slate-800/50 border-slate-700/30'
                    )}
                  >
                    <p className={clsx(
                      'text-[10px] uppercase tracking-wider mb-1',
                      item.highlight ? 'text-emerald-400' : 'text-slate-500'
                    )}>{item.label}</p>
                    <p className={clsx(
                      'text-sm break-all',
                      item.mono && 'font-mono text-xs',
                      item.highlight ? 'text-emerald-300 font-semibold' : 'text-white'
                    )}>{item.value}</p>
                  </div>
                ))}
              </div>
              
              <p className="mt-4 text-center text-xs text-slate-600">Click anywhere outside or press X to close</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function WorkloadsByNode({ 
  podsByNode, 
  nodes 
}: { 
  podsByNode: Record<string, PodInfo[]>
  nodes: TopologyNode[]
}) {
  const [expandedNode, setExpandedNode] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {nodes.map((node) => {
        const pods = podsByNode[node.name] || []
        const isExpanded = expandedNode === node.name
        
        return (
          <div key={node.name} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedNode(isExpanded ? null : node.name)}
              className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ServerStackIcon className="h-5 w-5 text-gray-400" />
                <span className="font-medium text-gray-900">{node.name}</span>
                <span className={clsx(
                  'badge',
                  node.status === 'Ready' ? 'badge-success' : 'badge-error'
                )}>
                  {node.status}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">{pods.length} pods</span>
                <svg
                  className={clsx('h-5 w-5 text-gray-400 transition-transform', isExpanded && 'rotate-180')}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            
            {isExpanded && pods.length > 0 && (
              <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                {pods.slice(0, 20).map((pod) => (
                  <div key={`${pod.namespace}/${pod.name}`} className="flex items-center justify-between text-sm py-1">
                    <div className="flex items-center gap-2">
                      <CubeIcon className="h-4 w-4 text-gray-400" />
                      <span className="font-mono text-xs">{pod.namespace}/</span>
                      <span className="truncate max-w-xs">{pod.name}</span>
                    </div>
                    <span className={clsx(
                      'badge',
                      pod.phase === 'Running' ? 'badge-success' : 
                      pod.phase === 'Pending' ? 'badge-warning' : 'badge-error'
                    )}>
                      {pod.phase}
                    </span>
                  </div>
                ))}
                {pods.length > 20 && (
                  <p className="text-xs text-gray-500 text-center pt-2">
                    ...and {pods.length - 20} more pods
                  </p>
                )}
              </div>
            )}
            
            {isExpanded && pods.length === 0 && (
              <div className="p-4 text-sm text-gray-500 text-center">
                No pods on this node
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function ClusterDetail() {
  const { id } = useParams<{ id: string }>()
  const [showUpload, setShowUpload] = useState(false)
  const [activeTab, setActiveTab] = useState<'topology' | 'ocp' | 'operators' | 'workloads'>('topology')

  const { data: cluster, isLoading: clusterLoading } = useCluster(id!)
  useClusterStatus(id!)
  const { data: occupancy } = useCurrentClusterUser(id!)
  const { data: gpuStatus } = useGpuStatus(id, !!cluster)
  // Hearth integration: try to find a matching FournosCluster by name
  const clusterName = cluster?.name || ''
  const { data: hearthCluster } = useHearthCluster(clusterName)
  const { data: topology, isLoading: topologyLoading } = useClusterTopology(id!)
  const { data: ocpDetails, isLoading: ocpLoading } = useOcpDetails(id!)
  const { data: operatorsData, isLoading: operatorsLoading } = useClusterOperators(id!)
  const { data: workloads, isLoading: workloadsLoading } = useClusterWorkloads(id!)
  const { data: costs, isLoading: costsLoading } = useClusterCosts(id!)
  const refreshCost = useRefreshClusterCost()

  const refreshStatus = useRefreshClusterStatus()
  const uploadKubeconfig = useUploadKubeconfig()

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/x-yaml': ['.yaml', '.yml'], 'text/plain': ['.kubeconfig'] },
    multiple: false,
    onDrop: async (files) => {
      if (files[0] && id) {
        await uploadKubeconfig.mutateAsync({ id, file: files[0] })
        setShowUpload(false)
      }
    },
  })

  if (clusterLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <ArrowPathIcon className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!cluster) {
    return (
      <div className="text-center py-12">
        <ServerStackIcon className="h-16 w-16 mx-auto text-gray-300" />
        <h3 className="mt-4 text-lg font-medium text-gray-900">Cluster not found</h3>
        <Link to="/clusters" className="mt-4 inline-block text-primary-600 hover:text-primary-700">
          ← Back to clusters
        </Link>
      </div>
    )
  }

  const tabs = [
    { id: 'topology', label: 'Topology', icon: Square3Stack3DIcon },
    { id: 'ocp', label: 'OCP Details', icon: ShieldCheckIcon },
    { id: 'operators', label: 'Operators', icon: CubeIcon },
    { id: 'workloads', label: 'Workloads', icon: CircleStackIcon },
  ] as const

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/clusters" className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeftIcon className="h-5 w-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 font-display">{cluster.name}</h1>
          {cluster.description && (
            <p className="mt-1 text-sm text-gray-500">{cluster.description}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowUpload(!showUpload)} className="btn-secondary">
            <CloudArrowUpIcon className="h-4 w-4 mr-2" />
            Upload Kubeconfig
          </button>
          <button
            onClick={() => refreshStatus.mutate(id!)}
            disabled={refreshStatus.isPending}
            className="btn-primary"
          >
            <ArrowPathIcon className={`h-4 w-4 mr-2 ${refreshStatus.isPending ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {showUpload && (
        <div className="card p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Upload New Kubeconfig</h3>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getInputProps()} />
            <CloudArrowUpIcon className="h-12 w-12 mx-auto text-gray-400" />
            <p className="mt-2 text-sm text-gray-600">Drop your kubeconfig file here, or click to browse</p>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="card p-6">
          <div className="flex items-center gap-3">
            <div className={clsx(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              cluster.status === 'healthy' ? 'bg-green-100' : cluster.status === 'error' ? 'bg-orange-100' : 'bg-yellow-100'
            )}>
              <ServerStackIcon className={clsx(
                'h-6 w-6',
                cluster.status === 'healthy' ? 'text-green-600' : cluster.status === 'error' ? 'text-orange-600' : 'text-yellow-600'
              )} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className="text-xl font-semibold text-gray-900 capitalize">{cluster.status}</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <CircleStackIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Nodes</p>
              <p className="text-xl font-semibold text-gray-900">{cluster.node_count || 'N/A'}</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-purple-100 flex items-center justify-center">
              <CpuChipIcon className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">GPUs</p>
              <p className="text-xl font-semibold text-gray-900">{cluster.gpu_count || '0'}</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-orange-100 flex items-center justify-center">
              <CubeIcon className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Operators</p>
              <p className="text-xl font-semibold text-gray-900">{operatorsData?.total || '...'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Hearth Integration Panel */}
      {hearthCluster && (
        <div className="card border-l-4 border-l-orange-400">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <FireIcon className="h-5 w-5 text-orange-500" />
              <h3 className="font-semibold text-gray-900">Hearth Status</h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full ml-auto">
                FournosCluster CR
              </span>
            </div>
          </div>
          <div className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">GPU Hardware</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {hearthCluster.gpu_summary || 'Pending discovery'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Kubeconfig</p>
                <p className="mt-1">
                  <span className={clsx(
                    'badge',
                    hearthCluster.kubeconfig_status === 'Valid' ? 'badge-success' :
                    hearthCluster.kubeconfig_status === 'Unreachable' ? 'badge-error' :
                    'badge-warning'
                  )}>
                    {hearthCluster.kubeconfig_status || 'Unknown'}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Lock Status</p>
                <p className="mt-1">
                  {hearthCluster.locked ? (
                    <span className="flex items-center gap-1 text-sm font-medium text-orange-600">
                      <LockClosedIcon className="h-4 w-4" />
                      Locked
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm font-medium text-green-600">
                      <LockOpenIcon className="h-4 w-4" />
                      Available
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Owner</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {hearthCluster.owner || '—'}
                </p>
              </div>
            </div>

            {/* GPU Details */}
            {hearthCluster.hardware && hearthCluster.hardware.gpus.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">GPU Inventory</p>
                <div className="flex flex-wrap gap-2">
                  {hearthCluster.hardware.gpus.map((gpu, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                      <CpuChipIcon className="h-4 w-4 text-purple-600" />
                      <span className="text-sm font-medium text-purple-900">
                        {gpu.count}x {gpu.short_name.toUpperCase()}
                      </span>
                      <span className="text-xs text-purple-600">
                        ({gpu.vendor} · {gpu.node_count || '?'} node{gpu.node_count !== 1 ? 's' : ''})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lock expiry */}
            {hearthCluster.locked && hearthCluster.lock_expires_at && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <ClockIcon className="h-4 w-4 text-gray-400" />
                  Lock expires: {format(new Date(hearthCluster.lock_expires_at), 'MMM d, yyyy h:mm a')}
                </div>
              </div>
            )}

            {/* Discovery error */}
            {hearthCluster.hardware?.last_error && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-start gap-2 text-sm text-orange-600 bg-orange-50 p-3 rounded-lg">
                  <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">GPU Discovery Error</p>
                    <p className="text-xs mt-1">{hearthCluster.hardware.last_error}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* GPU Allocation Card */}
      {gpuStatus && gpuStatus.total_gpus > 0 && (
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-3">GPU Allocation</h3>
          <div className="grid grid-cols-3 gap-4 text-sm mb-3">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{gpuStatus.total_gpus}</p>
              <p className="text-xs text-gray-500">Total GPUs</p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <p className="text-2xl font-bold text-orange-600">{gpuStatus.allocated_gpus}</p>
              <p className="text-xs text-gray-500">Allocated</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{gpuStatus.free_gpus}</p>
              <p className="text-xs text-gray-500">Free</p>
            </div>
          </div>
          {gpuStatus.gpu_types.length > 0 && (
            <div className="space-y-2">
              {gpuStatus.gpu_types.map((t, i) => (
                <div key={i} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                  <span className="font-medium text-gray-700">{t.product}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">{t.node_count} node{t.node_count !== 1 ? 's' : ''}</span>
                    <span className="text-green-600 font-medium">{t.free}/{t.count} free</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {gpuStatus.dra_available && (
            <div className="mt-2 text-xs text-gray-500">
              DRA {gpuStatus.dra_api_version} &middot; {gpuStatus.gpu_allocation_mode} mode
            </div>
          )}
        </div>
      )}

      {/* Cost Card */}
      {cluster.provider === 'ibm' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <CurrencyDollarIcon className="h-5 w-5 text-emerald-600" />
              Cost
            </h3>
            <div className="flex items-center gap-3">
              {costs && costs.length > 0 && costs[0].fetched_at && (
                <span className="text-xs text-gray-400">
                  Updated {format(new Date(costs[0].fetched_at), 'MMM d, HH:mm')}
                </span>
              )}
              <button
                onClick={() => refreshCost.mutate(id!)}
                disabled={refreshCost.isPending}
                className="btn-secondary text-sm py-1.5 px-3"
              >
                <ArrowPathIcon className={clsx('h-3.5 w-3.5 mr-1.5', refreshCost.isPending && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>

          {costsLoading ? (
            <div className="text-sm text-gray-400">Loading...</div>
          ) : (!costs || costs.length === 0) ? (
            <div className="flex items-start gap-2 text-sm text-orange-600 bg-orange-50 p-3 rounded-lg">
              <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>No billing data available</span>
            </div>
          ) : (
            <div className="space-y-4">
              {costs.map((cost) => (
                <div key={cost.billing_month} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between p-4 bg-emerald-50">
                    <p className="text-sm font-medium text-gray-600">{cost.billing_month}</p>
                    <p className="text-xl font-bold text-emerald-700">
                      {cost.total_cost != null
                        ? cost.total_cost.toLocaleString(undefined, { style: 'currency', currency: cost.currency })
                        : '—'}
                    </p>
                  </div>
                  {cost.node_breakdown && cost.node_breakdown.length > 0 && (
                    <div className="p-3 space-y-1">
                      {cost.node_breakdown.map((n) => (
                        <div key={n.node} className="flex items-center justify-between text-sm p-1.5">
                          <span className="font-mono text-xs text-gray-700 truncate">{n.node}</span>
                          <span className="font-medium text-gray-900">
                            {n.cost.toLocaleString(undefined, { style: 'currency', currency: cost.currency })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {cost.error && (
                    <div className="px-4 py-2 text-xs text-orange-600 bg-orange-50 border-t border-orange-100">
                      {cost.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Current Reservations (multi-occupant) */}
      {occupancy?.occupied && occupancy.reservations.length > 0 && (
        <div className="card p-6 border-l-4 border-l-orange-500">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">
              Currently Reserved ({occupancy.reservations.length} active)
            </h3>
            {occupancy.gpu_summary && occupancy.gpu_summary.total_reserved_gpus > 0 && (
              <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded-full font-medium">
                {occupancy.gpu_summary.total_reserved_gpus} GPU reserved
              </span>
            )}
          </div>
          <div className="space-y-3">
            {occupancy.reservations.map((r, idx) => (
              <div key={idx} className="p-3 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">User</p>
                    <p className="font-medium text-gray-900">{r.user_name}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Purpose</p>
                    <p className="font-medium text-gray-900">{r.title}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Type</p>
                    <p className="font-medium text-gray-900">
                      {r.reservation_type === 'gpu' ? `${r.gpu_count ?? '?'} GPU` : 'Full Cluster'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Ends</p>
                    <p className="font-medium text-gray-900">
                      {format(new Date(r.end_time), 'MMM d, h:mm a')}
                    </p>
                  </div>
                </div>
                {r.enforcement_namespace && (
                  <div className="mt-2 p-2 bg-blue-50 rounded flex items-center gap-2 text-xs">
                    <span className="text-blue-700">Namespace: </span>
                    <code className="font-mono text-blue-900">{r.enforcement_namespace}</code>
                    {r.enforcement_status && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        r.enforcement_status === 'provisioned' ? 'bg-green-100 text-green-800' :
                        r.enforcement_status === 'error' ? 'bg-orange-100 text-orange-800' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {r.enforcement_status}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="card">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <tab.icon className="h-5 w-5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Topology Tab */}
          {activeTab === 'topology' && (
            <div>
              {topologyLoading ? (
                <div className="flex items-center justify-center h-64">
                  <ArrowPathIcon className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : topology ? (
                <TopologyVisualization
                  controlPlane={topology.control_plane}
                  workers={topology.workers}
                  infra={topology.infra}
                  zones={topology.zones}
                />
              ) : (
                <p className="text-center text-gray-500">Could not load topology</p>
              )}
            </div>
          )}

          {/* OCP Details Tab */}
          {activeTab === 'ocp' && (
            <div>
              {ocpLoading ? (
                <div className="flex items-center justify-center h-64">
                  <ArrowPathIcon className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : ocpDetails ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">OpenShift Version</p>
                      <p className="text-lg font-semibold text-gray-900">{ocpDetails.cluster_version || 'N/A'}</p>
                      {ocpDetails.update_available && (
                        <p className="text-xs text-orange-600 mt-1">Updates available</p>
                      )}
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">Platform</p>
                      <p className="text-lg font-semibold text-gray-900">{ocpDetails.platform || 'N/A'}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">Infrastructure</p>
                      <p className="text-lg font-semibold text-gray-900 truncate" title={ocpDetails.infrastructure}>
                        {ocpDetails.infrastructure || 'N/A'}
                      </p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">Network Type</p>
                      <p className="text-lg font-semibold text-gray-900">{ocpDetails.network_type || 'N/A'}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">Ingress Domain</p>
                      <p className="text-lg font-semibold text-gray-900 truncate" title={ocpDetails.ingress_domain}>
                        {ocpDetails.ingress_domain || 'N/A'}
                      </p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">Cluster ID</p>
                      <p className="text-sm font-mono text-gray-700 truncate" title={ocpDetails.cluster_id}>
                        {ocpDetails.cluster_id || 'N/A'}
                      </p>
                    </div>
                  </div>

                  {ocpDetails.conditions && ocpDetails.conditions.length > 0 && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Cluster Conditions</h4>
                      <div className="space-y-2">
                        {ocpDetails.conditions.map((condition, idx) => (
                          <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                            {condition.status === 'True' ? (
                              <CheckCircleIcon className="h-5 w-5 text-green-500 mt-0.5" />
                            ) : condition.status === 'False' ? (
                              <XCircleIcon className="h-5 w-5 text-gray-400 mt-0.5" />
                            ) : (
                              <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500 mt-0.5" />
                            )}
                            <div>
                              <p className="font-medium text-gray-900">{condition.type}</p>
                              {condition.message && (
                                <p className="text-sm text-gray-500">{condition.message}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {ocpDetails.available_updates && ocpDetails.available_updates.length > 0 && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Available Updates</h4>
                      <div className="flex flex-wrap gap-2">
                        {ocpDetails.available_updates.map((version) => (
                          <span key={version} className="badge badge-info">{version}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-center text-gray-500">Could not load OCP details</p>
              )}
            </div>
          )}

          {/* Operators Tab */}
          {activeTab === 'operators' && (
            <div>
              {operatorsLoading ? (
                <div className="flex items-center justify-center h-64">
                  <ArrowPathIcon className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : operatorsData?.operators ? (
                <div className="space-y-3">
                  {operatorsData.operators.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No operators installed</p>
                  ) : (
                    operatorsData.operators.map((op) => (
                      <div key={`${op.namespace}/${op.name}`} className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-medium text-gray-900">{op.display_name || op.name}</h4>
                            <p className="text-sm text-gray-500">{op.namespace}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {op.version && (
                              <span className="text-sm text-gray-600">{op.version}</span>
                            )}
                            <span className={clsx(
                              'badge',
                              op.phase === 'Succeeded' ? 'badge-success' : 
                              op.phase === 'Failed' ? 'badge-error' : 'badge-warning'
                            )}>
                              {op.phase}
                            </span>
                          </div>
                        </div>
                        {op.description && (
                          <p className="mt-2 text-sm text-gray-600 line-clamp-2">{op.description}</p>
                        )}
                        {op.provider && (
                          <p className="mt-1 text-xs text-gray-400">Provider: {op.provider}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <p className="text-center text-gray-500">Could not load operators</p>
              )}
            </div>
          )}

          {/* Workloads Tab */}
          {activeTab === 'workloads' && (
            <div>
              {workloadsLoading ? (
                <div className="flex items-center justify-center h-64">
                  <ArrowPathIcon className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : workloads && topology ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span>{workloads.total_pods} total pods</span>
                    <span>•</span>
                    <span>{workloads.total_deployments} deployments</span>
                  </div>
                  
                  <WorkloadsByNode 
                    podsByNode={workloads.pods_by_node} 
                    nodes={topology.nodes}
                  />
                </div>
              ) : (
                <p className="text-center text-gray-500">Could not load workloads</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
