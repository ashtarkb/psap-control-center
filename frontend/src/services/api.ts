import axios from 'axios'
import type { 
  Cluster, 
  ClusterStatus, 
  ClusterListResponse, 
  ClusterTopology,
  OcpDetails,
  Operator,
  WorkloadsResponse,
  GpuAllocationStatus,
  Reservation, 
  ReservationListResponse,
  CalendarEvent,
  ClusterOccupancyResponse,
  HearthCluster,
  HearthClusterListResponse,
  HearthStatus,
  HearthConnectResponse,
} from '../types'
import { createLogger } from '../utils/logger'
import { getBasicAuthHeader } from '../stores/authStore'

const logger = createLogger('API')

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  if (config.method && config.method !== 'get') {
    const authHeader = getBasicAuthHeader()
    if (authHeader) {
      config.headers.Authorization = authHeader
    }
  }
  return config
})

api.interceptors.response.use(
  (response) => {
    logger.debug('API response:', response.config.method?.toUpperCase(), response.config.url, response.status)
    return response
  },
  (error) => {
    const detail = error.response?.data?.detail
    if (detail) {
      error.message = detail
    }
    logger.error('API error:', error.config?.method?.toUpperCase(), error.config?.url, error.response?.status, error.message)
    return Promise.reject(error)
  }
)

export const clusterApi = {
  list: async (activeOnly = false): Promise<ClusterListResponse> => {
    const { data } = await api.get('/clusters', { params: { active_only: activeOnly } })
    return data
  },

  get: async (id: string): Promise<Cluster> => {
    const { data } = await api.get(`/clusters/${id}`)
    return data
  },

  create: async (cluster: { 
    name: string; 
    description?: string; 
    kubeconfig_content?: string; 
    api_server_url?: string;
    username?: string;
    password?: string;
    tags?: string[] 
  }): Promise<Cluster> => {
    const { data } = await api.post('/clusters', cluster)
    return data
  },

  update: async (id: string, cluster: Partial<Cluster>): Promise<Cluster> => {
    const { data } = await api.put(`/clusters/${id}`, cluster)
    return data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/clusters/${id}`)
  },

  getStatus: async (id: string): Promise<ClusterStatus> => {
    const { data } = await api.get(`/clusters/${id}/status`)
    return data
  },

  refreshStatus: async (id: string): Promise<ClusterStatus> => {
    const { data } = await api.post(`/clusters/${id}/refresh`)
    return data
  },

  uploadKubeconfig: async (id: string, file: File): Promise<Cluster> => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await api.post(`/clusters/${id}/kubeconfig`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  validateKubeconfig: async (file: File): Promise<{ valid: boolean; contexts?: string[]; api_server?: string }> => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await api.post('/clusters/validate-kubeconfig', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  loginWithCredentials: async (id: string, credentials: { api_server_url: string; username: string; password: string }): Promise<Cluster> => {
    const { data } = await api.post(`/clusters/${id}/login`, credentials)
    return data
  },

  testCredentials: async (credentials: { api_server_url: string; username: string; password: string }): Promise<{ valid: boolean; api_server: string; auth_type: string }> => {
    const { data } = await api.post('/clusters/test-credentials', credentials)
    return data
  },

  getTopology: async (id: string): Promise<ClusterTopology> => {
    const { data } = await api.get(`/clusters/${id}/topology`)
    return data
  },

  getOcpDetails: async (id: string): Promise<OcpDetails> => {
    const { data } = await api.get(`/clusters/${id}/ocp-details`)
    return data
  },

  getOperators: async (id: string): Promise<{ operators: Operator[]; total: number }> => {
    const { data } = await api.get(`/clusters/${id}/operators`)
    return data
  },

  getWorkloads: async (id: string, namespace?: string): Promise<WorkloadsResponse> => {
    const { data } = await api.get(`/clusters/${id}/workloads`, { params: { namespace } })
    return data
  },

  getGpuStatus: async (id: string): Promise<GpuAllocationStatus> => {
    const { data } = await api.get(`/clusters/${id}/gpu-status`)
    return data
  },

  getGpuPodHistory: async (id: string, limit = 25): Promise<{
    pods: Array<{
      name: string
      namespace: string
      gpu_count: number
      node?: string
      first_seen: string
      last_seen: string
      finished_at: string
    }>
    total: number
  }> => {
    const { data } = await api.get(`/clusters/${id}/gpu-pod-history`, { params: { limit } })
    return data
  },

  getRefreshSchedule: async (): Promise<{
    server_time: string
    last_refresh: string | null
    next_refresh: string | null
    in_progress: boolean
    total: number
    completed: number
  }> => {
    const { data } = await api.get('/clusters/refresh-schedule')
    return data
  },
}

export const reservationApi = {
  list: async (params?: {
    cluster_id?: string
    user_name?: string
    start_date?: string
    end_date?: string
    status?: string
  }): Promise<ReservationListResponse> => {
    const { data } = await api.get('/reservations', { params })
    return data
  },

  get: async (id: string): Promise<Reservation> => {
    const { data } = await api.get(`/reservations/${id}`)
    return data
  },

  create: async (reservation: Omit<Reservation, 'id' | 'status' | 'created_at' | 'updated_at' | 'color'>): Promise<Reservation> => {
    const { data } = await api.post('/reservations', reservation)
    return data
  },

  update: async (id: string, reservation: Partial<Reservation>): Promise<Reservation> => {
    const { data } = await api.put(`/reservations/${id}`, reservation)
    return data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/reservations/${id}`)
  },

  cancel: async (id: string): Promise<Reservation> => {
    const { data } = await api.post(`/reservations/${id}/cancel`)
    return data
  },

  getCalendarEvents: async (startDate: string, endDate: string, clusterId?: string): Promise<CalendarEvent[]> => {
    const { data } = await api.get('/reservations/calendar', {
      params: { start_date: startDate, end_date: endDate, cluster_id: clusterId },
    })
    return data
  },

  getCurrentReservations: async (clusterId: string): Promise<ClusterOccupancyResponse> => {
    const { data } = await api.get(`/reservations/cluster/${clusterId}/current`)
    return data
  },
}

export const hearthApi = {
  getStatus: async (): Promise<HearthStatus> => {
    const { data } = await api.get('/hearth/status')
    return data
  },

  connect: async (file: File): Promise<HearthConnectResponse> => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await api.post('/hearth/connect', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  disconnect: async (): Promise<HearthConnectResponse> => {
    const { data } = await api.post('/hearth/disconnect')
    return data
  },

  listClusters: async (): Promise<HearthClusterListResponse> => {
    const { data } = await api.get('/hearth/clusters')
    return data
  },

  getCluster: async (name: string): Promise<HearthCluster> => {
    const { data } = await api.get(`/hearth/clusters/${name}`)
    return data
  },
}

export const authApi = {
  check: async (username: string, password: string): Promise<{ authenticated: boolean; username: string }> => {
    const { data } = await api.get('/auth/check', {
      headers: {
        Authorization: 'Basic ' + btoa(`${username}:${password}`),
      },
    })
    return data
  },
}

export default api
