import { useQuery } from '@tanstack/react-query'
import { clusterApi } from '../services/api'
import type { GpuAllocationStatus } from '../types'

export function useGpuStatus(clusterId: string | undefined, enabled = true) {
  return useQuery<GpuAllocationStatus>({
    queryKey: ['gpu-status', clusterId],
    queryFn: () => clusterApi.getGpuStatus(clusterId!),
    enabled: !!clusterId && enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}
