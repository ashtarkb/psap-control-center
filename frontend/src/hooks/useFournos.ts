import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fournosApi } from '../services/api'
import type {
  FournosJobListResponse,
  FournosJobDetailResponse,
  FournosJobEvent,
  RecurringJob,
  ScheduleChildJob,
  ClusterLock,
  ClusterOverview,
  CreateClusterLockRequest,
  ForgeProject,
  GitHubPR,
  GithubSyncStatus,
  SlotHold,
  SubmitJobRequest,
  SubmitJobResponse,
  SubmitMatrixRequest,
  SubmitMatrixResponse,
  ProjectUiSchemaResponse,
} from '../types'

// ─── Jobs ──────────────────────────────────────────────────────────────

export function useFournosJobs(params: {
  tab?: string
  project?: string
  cluster?: string
  status?: string
  owner?: string
  start_time?: string
  end_time?: string
  sort_by?: string
  sort_dir?: 'asc' | 'desc'
  page?: number
  per_page?: number
} = {}) {
  return useQuery<FournosJobListResponse>({
    queryKey: ['fournos-jobs', params],
    queryFn: () => fournosApi.listJobs(params),
    refetchInterval: params.tab === 'live' ? 5000 : false,
    retry: 1,
  })
}

export function useFournosJob(name: string | undefined) {
  return useQuery<FournosJobDetailResponse>({
    queryKey: ['fournos-job', name],
    queryFn: () => fournosApi.getJob(name!),
    enabled: !!name,
    refetchInterval: 5000,
  })
}

export function useFournosJobEvents(name: string | undefined) {
  return useQuery<FournosJobEvent[]>({
    queryKey: ['fournos-job-events', name],
    queryFn: () => fournosApi.getJobEvents(name!),
    enabled: !!name,
  })
}

export function useCancelJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.cancelJob(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
      qc.invalidateQueries({ queryKey: ['fournos-job'] })
    },
  })
}

export function useRerunJob() {
  const qc = useQueryClient()
  return useMutation<SubmitJobResponse, Error, string>({
    mutationFn: (name: string) => fournosApi.rerunJob(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}

export function useDeleteHistoryJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.deleteHistoryJob(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}

export function useSubmitJob() {
  const qc = useQueryClient()
  return useMutation<SubmitJobResponse, Error, SubmitJobRequest>({
    mutationFn: (req) => fournosApi.submitJob(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}

// ─── Projects & Pipelines ──────────────────────────────────────────────

export function useForgeProjects() {
  return useQuery<ForgeProject[]>({
    queryKey: ['forge-projects'],
    queryFn: () => fournosApi.listProjects(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useProjectUiSchema(name: string | undefined) {
  return useQuery<ProjectUiSchemaResponse>({
    queryKey: ['project-ui-schema', name],
    queryFn: () => fournosApi.getProjectUiSchema(name!),
    enabled: !!name,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

export function useRefreshProjectUiSchema() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.refreshProjectUiSchema(name),
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: ['project-ui-schema', name] })
    },
  })
}

export function usePipelines() {
  return useQuery<string[]>({
    queryKey: ['fournos-pipelines'],
    queryFn: () => fournosApi.listPipelines(),
    staleTime: 30 * 60 * 1000,
  })
}

// ─── Recurring jobs (native FournosJob spec.schedule) ──────────────────

export function useRecurringJobs(cluster?: string) {
  return useQuery<RecurringJob[]>({
    queryKey: ['fournos-recurring-jobs', cluster],
    queryFn: () => fournosApi.listRecurringJobs(cluster),
    refetchInterval: 30000,
  })
}

export function useRecurringJobChildren(name: string | undefined) {
  return useQuery<ScheduleChildJob[]>({
    queryKey: ['fournos-recurring-job-children', name],
    queryFn: () => fournosApi.getRecurringJobChildren(name!),
    enabled: !!name,
    refetchInterval: 10000,
  })
}

export function useTriggerRecurringJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.triggerRecurringJob(name),
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: ['fournos-recurring-jobs'] })
      qc.invalidateQueries({ queryKey: ['fournos-recurring-job-children', name] })
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}

export function useDeleteRecurringJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.deleteRecurringJob(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-recurring-jobs'] })
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}

// ─── Cluster locks (native FournosJob spec.lockOnly) ────────────────────

export function useClusterLocks(cluster?: string) {
  return useQuery<ClusterLock[]>({
    queryKey: ['fournos-cluster-locks', cluster],
    queryFn: () => fournosApi.listClusterLocks(cluster),
    refetchInterval: 30000,
  })
}

export function useCreateClusterLock() {
  const qc = useQueryClient()
  return useMutation<ClusterLock, Error, CreateClusterLockRequest>({
    mutationFn: (req) => fournosApi.createClusterLock(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-cluster-locks'] })
      qc.invalidateQueries({ queryKey: ['fournos-cluster-overview'] })
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}

export function useDeleteClusterLock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.deleteClusterLock(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-cluster-locks'] })
      qc.invalidateQueries({ queryKey: ['fournos-cluster-overview'] })
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}

export function useClusterOverview(cluster: string | undefined) {
  return useQuery<ClusterOverview>({
    queryKey: ['fournos-cluster-overview', cluster],
    queryFn: () => fournosApi.getClusterOverview(cluster!),
    enabled: !!cluster,
    refetchInterval: 15000,
  })
}

// ─── Calendar slot holds (ephemeral, UX-only anti-race claim) ──────────

export function useSlotHolds(cluster: string | undefined, enabled = true) {
  return useQuery<SlotHold[]>({
    queryKey: ['fournos-slot-holds', cluster],
    queryFn: () => fournosApi.listSlotHolds(cluster!),
    enabled: !!cluster && enabled,
    refetchInterval: 8000,
  })
}

export function useHoldSlot() {
  const qc = useQueryClient()
  return useMutation<SlotHold, Error, { cluster: string; startTime: string }>({
    mutationFn: ({ cluster, startTime }) => fournosApi.holdSlot(cluster, startTime),
    onSuccess: (_data, { cluster }) => {
      qc.invalidateQueries({ queryKey: ['fournos-slot-holds', cluster] })
    },
  })
}

export function useReleaseSlot() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, { cluster: string; startTime: string }>({
    mutationFn: ({ cluster, startTime }) => fournosApi.releaseSlot(cluster, startTime),
    onSuccess: (_data, { cluster }) => {
      qc.invalidateQueries({ queryKey: ['fournos-slot-holds', cluster] })
    },
  })
}

// ─── GitHub PRs ────────────────────────────────────────────────────────

export function useGithubPRs() {
  return useQuery<GitHubPR[]>({
    queryKey: ['github-prs'],
    queryFn: () => fournosApi.getGithubPRs(),
    // Server caches this indefinitely (fetched from GitHub once, reused for
    // everyone) — mirror that here so we don't refetch on every mount/focus.
    // Use useRefreshGithubPRs() to force a real refresh from GitHub.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
}

export function useRefreshGithubPRs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => fournosApi.refreshGithubPRs(),
    onSuccess: (data) => {
      queryClient.setQueryData(['github-prs'], data)
    },
    onError: (error: Error) => {
      toast.error(`Failed to refresh PRs from GitHub: ${error.message}`)
    },
  })
}

// ─── GitHub sync status/refresh ────────────────────────────────────────
//
// Everything sourced from the Forge GitHub repo (projects, ui/submit.yaml
// schemas, pipeline definitions, open PRs) is refreshed on one shared
// shared server-side schedule (github_sync_service.py) rather than on every
// page load. This just surfaces that status + a manual "Refresh now" button.

export function useGithubSyncStatus() {
  return useQuery<GithubSyncStatus>({
    queryKey: ['github-sync-status'],
    queryFn: () => fournosApi.getGithubSyncStatus(),
    refetchInterval: 30000,
  })
}

export function useRefreshGithubSync() {
  const qc = useQueryClient()
  return useMutation<GithubSyncStatus, Error>({
    mutationFn: () => fournosApi.refreshGithubSync(),
    onSuccess: (data) => {
      qc.setQueryData(['github-sync-status'], data)
      // Every GitHub-sourced cache may have changed — let the relevant
      // views pick up fresh data on next read.
      qc.invalidateQueries({ queryKey: ['forge-projects'] })
      qc.invalidateQueries({ queryKey: ['project-ui-schema'] })
      qc.invalidateQueries({ queryKey: ['github-prs'] })
    },
    onError: (error: Error) => {
      toast.error(`GitHub sync failed: ${error.message}`)
    },
  })
}

// ─── Matrix (pipeline/CPT-style) submission ────────────────────────────
// Generic across every project — driven entirely by a `kind: matrix` mode
// in that project's ui/submit.yaml, no project-specific code.

export function useSubmitMatrix() {
  const qc = useQueryClient()
  return useMutation<SubmitMatrixResponse, Error, SubmitMatrixRequest>({
    mutationFn: (req) => fournosApi.submitMatrix(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}
