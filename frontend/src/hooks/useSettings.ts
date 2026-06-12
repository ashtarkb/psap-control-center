import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '../services/api'
import toast from 'react-hot-toast'

export function useSlackSettings() {
  return useQuery({
    queryKey: ['settings', 'slack'],
    queryFn: settingsApi.getSlack,
    retry: false,
  })
}

export function useUpdateSlackSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (webhook_url: string | null) => settingsApi.updateSlack(webhook_url),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'slack'], data)
      toast.success(data.enabled ? 'Slack webhook saved' : 'Slack webhook removed')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update Slack settings: ${error.message}`)
    },
  })
}

export function useTestSlack() {
  return useMutation({
    mutationFn: settingsApi.testSlack,
    onSuccess: () => {
      toast.success('Test message sent to Slack')
    },
    onError: (error: Error) => {
      toast.error(`Slack test failed: ${error.message}`)
    },
  })
}
