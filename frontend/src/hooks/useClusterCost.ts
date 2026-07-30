import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clusterApi } from '../services/api'
import type { ClusterCost } from '../types'
import toast from 'react-hot-toast'

export function useClusterCosts(id: string) {
  return useQuery({
    queryKey: ['clusterCost', id],
    queryFn: () => clusterApi.getCost(id),
    enabled: !!id,
    staleTime: 60000,
  })
}

export function useLatestClusterCost(id: string): { data: ClusterCost | undefined; isLoading: boolean } {
  const { data, isLoading } = useClusterCosts(id)
  return { data: data?.[0], isLoading }
}

export function useRefreshClusterCost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: clusterApi.refreshCost,
    onSuccess: (data, id) => {
      queryClient.setQueryData(['clusterCost', id], data)
      toast.success('Cluster costs refreshed')
    },
    onError: (error: Error) => {
      toast.error(`Failed to refresh cost: ${error.message}`)
    },
  })
}
