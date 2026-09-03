export interface Cluster {
  id: string
  name: string
  description?: string
  api_server_url?: string
  status: string
  color: string
  provider: string
  infra_id?: string
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
export type ReservationPriority = 'undefined' | 'minor' | 'normal' | 'critical' | 'blocker'

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
  priority: ReservationPriority
  enforcement_namespace?: string | null
  enforcement_status?: string | null
  purpose?: string
  notes?: string
  color: string
  status: 'pending' | 'scheduled' | 'active' | 'completed' | 'cancelled' | 'denied'
  pending_modification?: Record<string, unknown> | null
  modification_requested_by?: string | null
  modification_requested_at?: string | null
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

export interface NodeCostInfo {
  node: string
  instance_name?: string
  cost: number
  service?: string
}

export interface ClusterCost {
  currency: string
  billing_month?: string
  total_cost?: number
  node_breakdown?: NodeCostInfo[]
  fetched_at?: string
  error?: string
}
export interface BillingReport {
  billing_month: string
  file_name: string
  file_size: number
  uploaded_at: string
  cluster_count: number
}

export interface CostRefreshStatus {
  in_progress: boolean
  total: number
  completed: number
  last_cluster: string | null
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

// Cost Explorer types

export interface InstanceTypeRate {
  instance_type: string
  region: string
  public_hourly_rate: number
  plan_id?: string
  is_estimated?: boolean
  last_fetched: string
}

export interface NodeEstimate {
  node_name: string
  instance_type?: string
  region?: string
  is_gpu: boolean
  hours_active: number
  public_rate?: number
  public_cost: number
  estimated_cost: number
  actual_cost?: number | null
  rate_available: boolean
}

export interface ClusterEstimate {
  cluster_id: string
  billing_month: string
  total_public_cost: number
  total_estimated_cost: number
  total_actual_cost?: number | null
  discount_pct: number
  node_count: number
  nodes: NodeEstimate[]
}

export interface WorkloadAttribution {
  namespace: string
  gpu_hours: number
  percentage: number
  estimated_cost: number
}

export interface ClusterMonthlyCost {
  cluster_id: string
  cluster_name: string
  cluster_color: string
  actual_cost?: number | null
  public_cost: number
  estimated_cost?: number | null
}

export interface MonthlyCostSummary {
  month: string
  actual_total?: number | null
  public_total: number
  estimated_total?: number | null
  savings?: number | null
  discount_pct?: number | null
  aggregate_discount_pct?: number | null
  is_estimate: boolean
  clusters: ClusterMonthlyCost[]
}

export interface YearSummary {
  year: number
  months: MonthlyCostSummary[]
  ytd_actual: number
  ytd_public: number
  ytd_estimated: number
  ytd_savings?: number | null
  ytd_discount_pct?: number | null
  aggregate_discount_pct?: number | null
  cluster_count: number
}

export interface RateRefreshResponse {
  updated: number
  total: number
}

export interface SnapshotCluster {
  cluster_id: string
  cluster_name: string
  cluster_color: string
  public_cost: number
  estimated_cost: number
  actual_cost?: number | null
}

export interface SnapshotPeriod {
  period: string
  public_total: number
  estimated_total: number
  actual_total?: number | null
  savings?: number | null
  discount_pct?: number | null
  clusters: SnapshotCluster[]
}

// ─── Fournos Testing Tab ──────────────────────────────────────────────

export interface FournosJobSummary {
  name: string
  project: string
  preset: string
  cluster: string
  pipeline: string
  owner: string
  status: string
  message: string
  created_at: string | null
  completed_at: string | null
  duration_seconds: number | null
  mlflow_url: string
  trigger_type: string
  triggered_by_schedule: string | null
  /** Actual planned start for a deferred one-off job — distinct from
   * created_at (when the CR was created). Powers the scheduling calendar. */
  scheduled_start_time: string | null
  source: 'live' | 'history'
}

export interface FournosJobListResponse {
  jobs: FournosJobSummary[]
  total: number
  page: number
  per_page: number
}

export interface PipelineStage {
  name: string
  displayName: string
  status: string
  startTime: string | null
  completionTime: string | null
  finally: boolean
}

export interface TaskProgress {
  completed: number
  failed: number
  cancelled: number
  incomplete: number
  skipped: number
  total: number
}

export interface FournosPod {
  name: string
  phase: string
  container: string
  ready: boolean
  restarts: number
  age_minutes: number
  exit_code: number | null
  term_reason: string
  term_message: string
}

export interface CurrentStep {
  name: string
  displayName: string
  startTime: string | null
}

export interface ForgeInfo {
  project: string
  args: string[]
  config_overrides: Record<string, unknown>
  pr_number: string
  pr_title: string
  pr_url: string
}

export interface FournosJobDetailResponse {
  job: {
    metadata: Record<string, unknown>
    spec: Record<string, unknown>
    status: Record<string, unknown>
    source: 'live' | 'history'
    duration_seconds: number | null
    mlflow_url: string
    ci_artifacts_url: string
  }
  pods: FournosPod[]
  stages: PipelineStage[]
  current_step: CurrentStep | null
  forge_info: ForgeInfo
  task_progress: TaskProgress | null
}

export interface FournosJobEvent {
  id: string
  phase: string
  message: string
  timestamp: string | null
}

// ─── Recurring jobs & cluster locks ─────────────────────────────────────
// Not separate resources — both are FournosJobs (spec.schedule /
// spec.lockOnly respectively), exactly as the operator itself models them.
// See docs on fournos/fournos/handlers/lifecycle.py + execution.py.

export interface RecurringJob {
  name: string
  project: string
  cluster: string
  pipeline: string
  preset: string
  owner: string
  schedule: string // cron expression, UTC
  phase: string
  message: string
  last_scheduled_time: string | null
  created_at: string
}

export interface ScheduleChildJob {
  name: string
  status: string
  trigger_type: string
  duration_seconds: number | null
  mlflow_url: string
  created_at: string
}

/** @deprecated kept as an alias for ScheduleChildJob during the Schedules-tab rename */
export type ScheduleRun = ScheduleChildJob

export interface ClusterLock {
  name: string
  cluster: string
  owner: string
  reason: string
  phase: string
  lock_until: string | null
  scheduled_start_time: string | null
  created_at: string
}

export interface CreateClusterLockRequest {
  cluster: string
  owner: string
  reason: string
  /** Lock is one-time only — omit for "held indefinitely until released". */
  lock_until?: string | null
  scheduled_start_time?: string | null
}

export interface ClusterOverview {
  cluster: string
  current_jobs: FournosJobSummary[]
  recurring_jobs: RecurringJob[]
  locks: ClusterLock[]
}

/** An ephemeral "someone else is booking this slot right now" claim on the
 * scheduling calendar — not a Fournos concept, purely a Control Center UX
 * nicety to stop two users racing on the same slot. See
 * slot_hold_service.py. */
export interface SlotHold {
  cluster: string
  start_time: string // ISO 8601 UTC, truncated to the slot granularity
  held_by: string
  expires_at: string
}

/** When a Submit-page job should run — threaded into SubmitJobRequest /
 * SubmitMatrixRequest as `schedule` / `scheduled_start_time` (both UTC). */
export type JobScheduling =
  | { mode: 'now' }
  | { mode: 'defer'; scheduledStartTimeUtc: string; label: string }
  | { mode: 'recurring'; scheduleUtc: string; label: string }

export interface ForgeProject {
  name: string
  cluster: string
  presets: string[]
  config_keys: string[]
  has_cli: boolean
}

export interface GitHubPR {
  number: number
  title: string
  author: string
  head_sha: string
  branch: string
  draft: boolean
}

export interface GithubSyncStatus {
  in_progress: boolean
  last_synced_at: string | null
  last_error: string | null
  project_count: number
}

export interface SubmitJobRequest {
  project: string
  cluster: string
  pipeline: string
  preset: string
  args?: string[]
  version: string
  owner: string
  exclusive: boolean
  config_overrides: Record<string, string>
  pull_sha: string
  priority?: string
  gpu_type?: string
  gpu_count?: number
  /** ISO 8601 UTC — mutually exclusive with `schedule`. Job stays Scheduled until this time. */
  scheduled_start_time?: string | null
  /** Cron expression, UTC — mutually exclusive with `scheduled_start_time`. Makes this a recurring template. */
  schedule?: string
}

export interface SubmitJobResponse {
  status: string
  job_name: string
  redirect: string
}

// ─── Matrix (pipeline/CPT-style) submission ────────────────────────────
// Generic across every project whose ui/submit.yaml declares a
// `kind: matrix` mode — not project-specific.

export interface SubmitMatrixModelInput {
  key: string
  overrides: Record<string, unknown>
  gpu_count?: number | null
}

export interface SubmitMatrixRequest {
  project: string
  cluster: string
  pipeline: string
  args: string[]
  config_overrides: Record<string, string>
  models: SubmitMatrixModelInput[]
  workloads: string[]
  owner: string
  priority: string
  exclusive: boolean
  pull_sha: string
  gpu_type: string
  scheduled_start_time?: string | null
  schedule?: string
}

export interface SubmitMatrixResultItem {
  model: string
  job_name?: string | null
  status: string
  error?: string | null
}

export interface SubmitMatrixResponse {
  status: string
  jobs: SubmitMatrixResultItem[]
  total: number
}

// ─── Generic project UI schema (projects/<name>/ui/submit.yaml) ───────

export interface UiOption {
  value: string
  label: string
  overrides: Record<string, unknown>
  extra: Record<string, unknown>
}

export interface UiVisibleIf {
  field: string
  equals?: unknown
  one_of?: unknown[]
}

export interface UiOptionRestriction {
  when: UiVisibleIf
  exclude_values: string[]
}

export interface UiField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multiselect' | 'radio' | 'hidden'
  required: boolean
  default?: unknown
  help: string
  placeholder: string
  maps_to?: string | null
  options: UiOption[]
  visible_if?: UiVisibleIf | null
  restrict_if: UiOptionRestriction[]
  min?: number | null
  max?: number | null
}

export interface UiSection {
  id: string
  label: string
  fields: UiField[]
}

export interface UiQuickPreset {
  key: string
  label: string
  fills: Record<string, unknown>
  overrides: Record<string, unknown>
}

export interface UiMatrixConfig {
  marker_key: string
  models_key: string
  workloads_key: string
  label_key: string
  tp_key: string
}

export interface UiPipelineModel {
  key: string
  label: string
  overrides: Record<string, unknown>
  tp?: number | null
}

export interface UiPipeline {
  key: string
  label: string
  models: UiPipelineModel[]
  workloads: string[]
  overrides: Record<string, unknown>
}

export interface UiMode {
  id: string
  label: string
  default: boolean
  kind: 'form' | 'matrix'
  sections: UiSection[]
  quick_presets: UiQuickPreset[]
  matrix?: UiMatrixConfig | null
  pipelines: UiPipeline[]
  dimensions: string[]
}

export interface ProjectUiSchema {
  schema_version: number
  project: string
  title: string
  description: string
  defaults: Record<string, unknown>
  modes: UiMode[]
}

export interface ProjectUiSchemaResponse {
  found: boolean
  project: string
  ui_schema: ProjectUiSchema | null
}

