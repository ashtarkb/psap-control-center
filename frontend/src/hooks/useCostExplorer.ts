import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { costExplorerApi } from '../services/api'
import type {
  YearSummary,
  ClusterEstimate,
  WorkloadAttribution,
  InstanceTypeRate,
  RateRefreshResponse,
  SnapshotPeriod,
} from '../types'
import toast from 'react-hot-toast'

export function useYearSummary(year: number) {
  return useQuery<YearSummary>({
    queryKey: ['cost-explorer', 'year', year],
    queryFn: () => costExplorerApi.getYearSummary(year),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export function useClusterEstimate(clusterId: string | undefined, month?: string) {
  return useQuery<ClusterEstimate>({
    queryKey: ['cost-explorer', 'estimate', clusterId, month],
    queryFn: () => costExplorerApi.getClusterEstimate(clusterId!, month),
    enabled: !!clusterId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export function useWorkloadAttribution(
  clusterId: string | undefined,
  month?: string
) {
  return useQuery<WorkloadAttribution[]>({
    queryKey: ['cost-explorer', 'workloads', clusterId, month],
    queryFn: () => costExplorerApi.getWorkloads(clusterId!, month),
    enabled: !!clusterId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export function usePublicRates() {
  return useQuery<InstanceTypeRate[]>({
    queryKey: ['cost-explorer', 'rates'],
    queryFn: costExplorerApi.getRates,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export function useSnapshots(start: string, end: string, granularity: string) {
  return useQuery<SnapshotPeriod[]>({
    queryKey: ['cost-explorer', 'snapshots', start, end, granularity],
    queryFn: () => costExplorerApi.getSnapshots(start, end, granularity),
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: !!start && !!end,
  })
}

export function useRecomputeSnapshots() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: costExplorerApi.recomputeSnapshots,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-explorer'] })
      toast.success('Snapshots recomputed')
    },
    onError: (error: Error) => {
      toast.error(`Recompute failed: ${error.message}`)
    },
  })
}

export function useRefreshRates() {
  const queryClient = useQueryClient()

  return useMutation<RateRefreshResponse>({
    mutationFn: costExplorerApi.refreshRates,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cost-explorer'] })
      toast.success(
        `Rates refreshed: ${data.updated} updated out of ${data.total}`
      )
    },
    onError: (error: Error) => {
      toast.error(`Rate refresh failed: ${error.message}`)
    },
  })
}
