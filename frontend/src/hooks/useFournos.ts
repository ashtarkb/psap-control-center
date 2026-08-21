import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fournosApi } from '../services/api'
import type {
  FournosJobListResponse,
  FournosJobDetailResponse,
  FournosJobEvent,
  FournosSchedule,
  ScheduleRun,
  ForgeProject,
  GitHubPR,
  SubmitJobRequest,
  SubmitJobResponse,
  CreateScheduleRequest,
} from '../types'

// ─── Jobs ──────────────────────────────────────────────────────────────

export function useFournosJobs(params: {
  tab?: string
  project?: string
  cluster?: string
  status?: string
  owner?: string
  page?: number
  per_page?: number
} = {}) {
  return useQuery<FournosJobListResponse>({
    queryKey: ['fournos-jobs', params],
    queryFn: () => fournosApi.listJobs(params),
    refetchInterval: params.tab === 'live' ? 5000 : false,
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

export function useForgeProjectInfo(name: string | undefined) {
  return useQuery<ForgeProject>({
    queryKey: ['forge-project', name],
    queryFn: () => fournosApi.getProjectInfo(name!),
    enabled: !!name,
  })
}

export function usePipelines() {
  return useQuery<string[]>({
    queryKey: ['fournos-pipelines'],
    queryFn: () => fournosApi.listPipelines(),
    staleTime: 30 * 60 * 1000,
  })
}

// ─── Schedules ─────────────────────────────────────────────────────────

export function useFournosSchedules() {
  return useQuery<FournosSchedule[]>({
    queryKey: ['fournos-schedules'],
    queryFn: () => fournosApi.listSchedules(),
    refetchInterval: 30000,
  })
}

export function useScheduleRuns(name: string | undefined) {
  return useQuery<ScheduleRun[]>({
    queryKey: ['fournos-schedule-runs', name],
    queryFn: () => fournosApi.getScheduleRuns(name!),
    enabled: !!name,
  })
}

export function useCreateSchedule() {
  const qc = useQueryClient()
  return useMutation<FournosSchedule, Error, CreateScheduleRequest>({
    mutationFn: (req) => fournosApi.createSchedule(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-schedules'] })
    },
  })
}

export function useToggleSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.toggleSchedule(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-schedules'] })
    },
  })
}

export function useTriggerSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.triggerSchedule(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-schedules'] })
      qc.invalidateQueries({ queryKey: ['fournos-jobs'] })
    },
  })
}

export function useDeleteSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => fournosApi.deleteSchedule(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fournos-schedules'] })
    },
  })
}

// ─── GitHub PRs ────────────────────────────────────────────────────────

export function useGithubPRs() {
  return useQuery<GitHubPR[]>({
    queryKey: ['github-prs'],
    queryFn: () => fournosApi.getGithubPRs(),
    staleTime: 60 * 1000,
  })
}
