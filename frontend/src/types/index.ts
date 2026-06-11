export interface Cluster {
  id: string
  name: string
  description?: string
  api_server_url?: string
  status: string
  color: string
  last_health_check?: string
  node_count?: string
  gpu_count?: string
  gpu_type?: string
  gpu_allocation_mode?: string
  cluster_version?: string
  metadata_info?: Record<string, unknown>
  tags?: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ClusterStatus {
  status: string
  api_server_url?: string
  node_count?: string
  gpu_count?: string
  gpu_type?: string
  gpu_allocation_mode?: string
  cluster_version?: string
  last_health_check?: string
  nodes?: NodeInfo[]
  namespaces?: string[]
  resource_usage?: ResourceUsage
}

export interface GpuTypeInfo {
  product: string
  count: number
  allocated: number
  free: number
  node_count: number
}

export interface GpuPodInfo {
  name: string
  namespace: string
  gpu_count: number
  node?: string
}

export interface GpuAllocationStatus {
  gpu_allocation_mode: string
  dra_available: boolean
  dra_api_version?: string
  total_gpus: number
  allocated_gpus: number
  free_gpus: number
  gpu_types: GpuTypeInfo[]
  gpu_pods: GpuPodInfo[]
}

export interface NodeInfo {
  name: string
  status: string
  roles: string[]
  cpu: string
  memory: string
  gpu: string
}

export interface ResourceUsage {
  total_cpu_cores: number
  total_memory_gb: number
  total_gpus: number
  running_pods: number
  total_pods: number
  total_nodes: number
}

export type ReservationType = 'cluster' | 'gpu'

export interface Reservation {
  id: string
  cluster_id?: string | null
  cluster_name?: string
  title: string
  description?: string
  user_name: string
  user_email?: string
  team?: string
  start_time: string
  end_time: string
  reservation_type: ReservationType
  gpu_count?: number | null
  enforce_isolation: boolean
  enforcement_namespace?: string | null
  enforcement_status?: string | null
  purpose?: string
  notes?: string
  color: string
  status: 'scheduled' | 'active' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
}

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  cluster_id?: string | null
  cluster_name: string
  user_name: string
  team?: string
  status: string
  color: string
  description?: string
  reservation_type: ReservationType
  gpu_count?: number | null
}

export interface ClusterOccupancyResponse {
  occupied: boolean
  reservations: Array<{
    user_name: string
    team?: string
    title: string
    start_time: string
    end_time: string
    reservation_type: ReservationType
    gpu_count?: number | null
    enforcement_namespace?: string | null
    enforcement_status?: string | null
  }>
  gpu_summary?: {
    total_reserved_gpus: number
    has_cluster_reservation: boolean
    reservation_count: number
  } | null
}

export interface ClusterListResponse {
  clusters: Cluster[]
  total: number
}

export interface ReservationListResponse {
  reservations: Reservation[]
  total: number
}

export interface TopologyNode {
  name: string
  status: string
  roles: string[]
  cpu: string
  memory: string
  memory_gb: number
  gpu: string
  gpu_type: string
  instance_type: string
  zone: string
  region: string
  pod_count: number
  os_image: string
  kernel_version: string
  container_runtime: string
  kubelet_version: string
  architecture: string
  internal_ip?: string
  external_ip?: string
}

export interface ClusterTopology {
  nodes: TopologyNode[]
  control_plane: TopologyNode[]
  workers: TopologyNode[]
  infra: TopologyNode[]
  total_nodes: number
  zones: string[]
}

export interface OcpDetails {
  cluster_version?: string
  cluster_id?: string
  platform?: string
  infrastructure?: string
  network_type?: string
  ingress_domain?: string
  update_available?: boolean
  available_updates?: string[]
  api_server_url?: string
  api_server_internal?: string
  cluster_network?: Array<{ cidr: string; hostPrefix: number }>
  service_network?: string[]
  conditions?: Array<{ type: string; status: string; message: string }>
}

export interface Operator {
  name: string
  namespace: string
  version?: string
  phase?: string
  display_name?: string
  description?: string
  provider?: string
}

export interface PodInfo {
  name: string
  namespace: string
  node?: string
  phase: string
  ip?: string
  containers: string[]
  restarts: number
  created?: string
}

export interface DeploymentInfo {
  name: string
  namespace: string
  replicas: number
  ready_replicas: number
  available_replicas: number
}

export interface WorkloadsResponse {
  pods: PodInfo[]
  deployments: DeploymentInfo[]
  pods_by_node: Record<string, PodInfo[]>
  total_pods: number
  total_deployments: number
}

// Hearth integration types
export interface HearthGPU {
  vendor: string
  model: string
  short_name: string
  count: number
  node_count?: number
}

export interface HearthHardware {
  gpus: HearthGPU[]
  total_gpus: number
  last_discovery?: string
  consecutive_failures: number
  last_error?: string
}

export interface HearthCondition {
  type: string
  status: string
  last_transition_time?: string
  reason?: string
  message?: string
}

export interface HearthCluster {
  name: string
  kubeconfig_secret: string
  owner?: string
  ttl?: string
  gpu_discovery_interval?: string
  hardware?: HearthHardware
  kubeconfig_status?: string
  locked: boolean
  lock_expires_at?: string
  owner_set_at?: string
  lock_job_name?: string
  gpu_summary?: string
  conditions: HearthCondition[]
  created_at?: string
}

export interface HearthClusterListResponse {
  clusters: HearthCluster[]
  total: number
  available: boolean
}

export interface HearthStatus {
  available: boolean
  configured: boolean
  cluster_count: number
  total_gpus: number
  locked_clusters: number
  error?: string
}

export interface HearthConnectResponse {
  success: boolean
  message: string
}
