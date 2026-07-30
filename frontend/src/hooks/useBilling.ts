import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { billingApi } from '../services/api'
import toast from 'react-hot-toast'

export function useBillingReports() {
  return useQuery({
    queryKey: ['billing', 'reports'],
    queryFn: billingApi.listReports,
    retry: false,
  })
}

export function useUploadBillingCsv() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ file, autoRefresh }: { file: File; autoRefresh: boolean }) =>
      billingApi.upload(file, autoRefresh),
    onSuccess: (data, { autoRefresh }) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'reports'] })
      if (autoRefresh) {
        queryClient.invalidateQueries({ queryKey: ['billing', 'cost-refresh-status'] })
        toast.success(`Billing report uploaded: ${data.billing_month} — refreshing cluster costs...`)
      } else {
        toast.success(`Billing report uploaded: ${data.billing_month} (${data.cluster_count} clusters)`)
      }
    },
    onError: (error: Error) => {
      toast.error(`Upload failed: ${error.message}`)
    },
  })
}

export function useDeleteBillingReport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (billingMonth: string) => billingApi.deleteReport(billingMonth),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'reports'] })
      toast.success('Billing report deleted')
    },
    onError: (error: Error) => {
      toast.error(`Delete failed: ${error.message}`)
    },
  })
}

export function useCostRefreshStatus(enabled: boolean) {
  const queryClient = useQueryClient()
  const wasInProgress = useRef(false)

  const query = useQuery({
    queryKey: ['billing', 'cost-refresh-status'],
    queryFn: billingApi.getCostRefreshStatus,
    enabled,
    refetchInterval: (q) => {
      if (q.state.data?.in_progress) return 1000
      return 5000
    },
  })

  useEffect(() => {
    if (query.data?.in_progress) {
      wasInProgress.current = true
    }
    if (wasInProgress.current && query.data && !query.data.in_progress) {
      wasInProgress.current = false
      queryClient.invalidateQueries({ queryKey: ['clusterCost'] })
      if (query.data.completed > 0) {
        toast.success(`Cluster costs updated (${query.data.completed} clusters)`)
      }
    }
  }, [query.data, queryClient])

  return query
}
