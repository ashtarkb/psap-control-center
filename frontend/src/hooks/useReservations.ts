import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reservationApi } from '../services/api'
import type { Reservation } from '../types'
import toast from 'react-hot-toast'
import { createLogger } from '../utils/logger'

const logger = createLogger('Reservations')

export function useReservations(params?: {
  cluster_id?: string
  user_name?: string
  start_date?: string
  end_date?: string
  status?: string
}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['reservations', params],
    queryFn: () => reservationApi.list(params),
    refetchInterval: 10_000,
    ...(options?.enabled !== undefined && { enabled: options.enabled }),
  })
}

export function useReservation(id: string) {
  return useQuery({
    queryKey: ['reservation', id],
    queryFn: () => reservationApi.get(id),
    enabled: !!id,
  })
}

export function useCalendarEvents(startDate: string, endDate: string, clusterId?: string) {
  return useQuery({
    queryKey: ['calendarEvents', { startDate, endDate, clusterId }],
    queryFn: () => reservationApi.getCalendarEvents(startDate, endDate, clusterId),
    enabled: !!startDate && !!endDate,
    refetchInterval: 10_000,
  })
}

export function useCurrentClusterUser(clusterId: string) {
  return useQuery({
    queryKey: ['clusterOccupancy', clusterId],
    queryFn: () => reservationApi.getCurrentReservations(clusterId),
    enabled: !!clusterId,
    refetchInterval: 30000,
  })
}

export function useCreateReservation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reservationApi.create,
    onSuccess: (data) => {
      logger.info('Reservation created:', data.title, 'by', data.user_name)
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      if (data.cluster_id) {
        queryClient.invalidateQueries({ queryKey: ['clusterOccupancy', data.cluster_id] })
        queryClient.invalidateQueries({ queryKey: ['gpu-status', data.cluster_id] })
      }
      toast.success('Reservation submitted — pending admin approval')
    },
    onError: (error: Error) => {
      logger.error('Failed to create reservation:', error)
      toast.error(`Failed to create reservation: ${error.message}`)
    },
  })
}

export function useUpdateReservation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Reservation> }) =>
      reservationApi.update(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      queryClient.invalidateQueries({ queryKey: ['reservation', data.id] })
      if (data.cluster_id) {
        queryClient.invalidateQueries({ queryKey: ['clusterOccupancy', data.cluster_id] })
        queryClient.invalidateQueries({ queryKey: ['gpu-status', data.cluster_id] })
      }
      toast.success('Reservation updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update reservation: ${error.message}`)
    },
  })
}

export function useDeleteReservation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reservationApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      queryClient.invalidateQueries({ queryKey: ['clusterOccupancy'] })
      queryClient.invalidateQueries({ queryKey: ['gpu-status'] })
      toast.success('Reservation deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete reservation: ${error.message}`)
    },
  })
}

export function useCancelReservation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reservationApi.cancel,
    onSuccess: (data) => {
      logger.info('Reservation cancelled:', data.id)
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      queryClient.invalidateQueries({ queryKey: ['reservation', data.id] })
      if (data.cluster_id) {
        queryClient.invalidateQueries({ queryKey: ['clusterOccupancy', data.cluster_id] })
        queryClient.invalidateQueries({ queryKey: ['gpu-status', data.cluster_id] })
      }
      toast.success('Reservation cancelled')
    },
    onError: (error: Error) => {
      logger.error('Failed to cancel reservation:', error)
      toast.error(`Failed to cancel reservation: ${error.message}`)
    },
  })
}

export function useApproveReservation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reservationApi.approve,
    onSuccess: (data) => {
      logger.info('Reservation approved:', data.id)
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      if (data.cluster_id) {
        queryClient.invalidateQueries({ queryKey: ['clusterOccupancy', data.cluster_id] })
        queryClient.invalidateQueries({ queryKey: ['gpu-status', data.cluster_id] })
      }
      toast.success('Reservation approved')
    },
    onError: (error: Error) => {
      logger.error('Failed to approve reservation:', error)
      toast.error(`Failed to approve: ${error.message}`)
    },
  })
}

export function useDenyReservation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      reservationApi.deny(id, reason),
    onSuccess: (data) => {
      logger.info('Reservation denied:', data.id)
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      toast.success('Reservation denied')
    },
    onError: (error: Error) => {
      logger.error('Failed to deny reservation:', error)
      toast.error(`Failed to deny: ${error.message}`)
    },
  })
}

export function useRequestModification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Record<string, unknown> }) =>
      reservationApi.requestModification(id, changes),
    onSuccess: (data) => {
      logger.info('Modification requested:', data.id)
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      queryClient.invalidateQueries({ queryKey: ['reservation', data.id] })
      toast.success('Modification request submitted — pending admin approval')
    },
    onError: (error: Error) => {
      logger.error('Failed to request modification:', error)
      toast.error(`Failed to request modification: ${error.message}`)
    },
  })
}

export function useApproveModification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reservationApi.approveModification,
    onSuccess: (data) => {
      logger.info('Modification approved:', data.id)
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      if (data.cluster_id) {
        queryClient.invalidateQueries({ queryKey: ['clusterOccupancy', data.cluster_id] })
        queryClient.invalidateQueries({ queryKey: ['gpu-status', data.cluster_id] })
      }
      toast.success('Modification approved')
    },
    onError: (error: Error) => {
      logger.error('Failed to approve modification:', error)
      toast.error(`Failed to approve modification: ${error.message}`)
    },
  })
}

export function useDenyModification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      reservationApi.denyModification(id, reason),
    onSuccess: (data) => {
      logger.info('Modification denied:', data.id)
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
      toast.success('Modification denied')
    },
    onError: (error: Error) => {
      logger.error('Failed to deny modification:', error)
      toast.error(`Failed to deny modification: ${error.message}`)
    },
  })
}
