import { useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { Dialog, Transition, Listbox } from '@headlessui/react'
import {
  PlusIcon,
  CalendarDaysIcon,
  XMarkIcon,
  ChevronUpDownIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { 
  format, 
  startOfWeek, 
  addDays, 
  isToday,
} from 'date-fns'
import {
  useReservations,
  useCreateReservation,
  useDeleteReservation,
  useCancelReservation,
} from '../hooks/useReservations'
import { useClusters } from '../hooks/useClusters'
import { useGpuStatus } from '../hooks/useGpuStatus'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import type { ReservationType } from '../types'

const initialFormState = {
  cluster_id: '',
  title: '',
  description: '',
  user_name: '',
  user_email: '',
  team: '',
  start_time: '',
  end_time: '',
  purpose: '',
  reservation_type: 'cluster' as ReservationType,
  gpu_count: '' as string,
  enforce_isolation: false,
}

interface WeekCalendarReservation {
  start_time: string
  end_time: string
  color: string
  title: string
  status: string
  user_name: string
  cluster_name?: string
  reservation_type?: string
  gpu_count?: number | null
}

function WeekCalendar({ reservations }: { reservations: WeekCalendarReservation[] }) {
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date()))
  
  // Get all days in the week
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    days.push(addDays(currentWeekStart, i))
  }
  
  // Time slots from 6 AM to 10 PM (16 hours)
  const timeSlots = Array.from({ length: 17 }, (_, i) => i + 6) // 6, 7, 8, ... 22
  
  // Get ALL reservations that cover a specific hour on a specific day (supports overlapping on different clusters)
  const getReservationsForSlot = (date: Date, hour: number) => {
    const slotStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0)
    const slotEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 59, 59)
    
    return reservations.filter((r) => {
      if (r.status === 'cancelled') return false
      const start = new Date(r.start_time)
      const end = new Date(r.end_time)
      return start <= slotEnd && end > slotStart
    })
  }
  
  // Check if this is the first hour of a reservation on this day
  const isReservationStart = (date: Date, hour: number, reservation: WeekCalendarReservation) => {
    const start = new Date(reservation.start_time)
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0)
    
    // If reservation started on a previous day, check if this is 6 AM (first visible slot)
    if (start < dayStart) {
      return hour === 6
    }
    return start.getHours() === hour && 
           start.getDate() === date.getDate() &&
           start.getMonth() === date.getMonth()
  }
  
  const prevWeek = () => setCurrentWeekStart(addDays(currentWeekStart, -7))
  const nextWeek = () => setCurrentWeekStart(addDays(currentWeekStart, 7))
  const goToToday = () => setCurrentWeekStart(startOfWeek(new Date()))
  
  // Get current hour for highlighting
  const now = new Date()
  const currentHour = now.getHours()
  
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <button 
          onClick={prevWeek}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronLeftIcon className="h-5 w-5 text-gray-600" />
        </button>
        <div className="text-center">
          <h3 className="font-semibold text-gray-900">
            {format(currentWeekStart, 'MMM d')} - {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
          </h3>
          <button 
            onClick={goToToday}
            className="text-xs text-primary-600 hover:text-primary-700"
          >
            Go to today
          </button>
        </div>
        <button 
          onClick={nextWeek}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronRightIcon className="h-5 w-5 text-gray-600" />
        </button>
      </div>
      
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Header row with days */}
          <div className="grid grid-cols-8 border-b border-gray-200">
            <div className="p-2 text-xs font-medium text-gray-500 text-center border-r border-gray-100">
              Time
            </div>
            {days.map((date, idx) => {
              const isCurrentDay = isToday(date)
              return (
                <div 
                  key={idx}
                  className={clsx(
                    'p-2 text-center border-r border-gray-100 last:border-r-0',
                    isCurrentDay && 'bg-primary-50'
                  )}
                >
                  <div className="text-xs text-gray-500 uppercase">{format(date, 'EEE')}</div>
                  <div className={clsx(
                    'text-lg font-semibold',
                    isCurrentDay ? 'text-primary-700' : 'text-gray-900'
                  )}>
                    {format(date, 'd')}
                  </div>
                </div>
              )
            })}
          </div>
          
          {/* Time slots */}
          <div className="max-h-[196px] overflow-y-auto">
            {timeSlots.map((hour) => (
              <div key={hour} className="grid grid-cols-8 border-b border-gray-100 last:border-b-0">
                <div className="p-1 text-xs text-gray-500 text-center border-r border-gray-100 bg-gray-50">
                  {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                </div>
                {days.map((date, dayIdx) => {
                  const slotReservations = getReservationsForSlot(date, hour)
                  const isCurrentDay = isToday(date)
                  const isCurrentHour = isCurrentDay && hour === currentHour
                  const hasReservations = slotReservations.length > 0
                  const hasMultiple = slotReservations.length > 1
                  
                  // Build tooltip for all reservations in this slot
                  const tooltipText = hasReservations 
                    ? slotReservations.map(r => `${r.title} - ${r.user_name} (${r.cluster_name || 'Unknown'})`).join('\n')
                    : 'Available'
                  
                  return (
                    <div 
                      key={dayIdx}
                      className={clsx(
                        'relative h-7 border-r border-gray-100 last:border-r-0',
                        isCurrentHour && 'bg-primary-100',
                        !hasReservations && isCurrentDay && 'bg-primary-50/30',
                      )}
                      title={tooltipText}
                    >
                      {hasReservations ? (
                        hasMultiple ? (
                          // Multiple overlapping reservations - show split view with color stripes
                          <div className="absolute inset-0 flex">
                            {slotReservations.map((res, idx) => {
                              const showLabel = isReservationStart(date, hour, res)
                              const opacityHex = ['40', '60', '80', 'A0', 'C0'][idx % 5]
                              const color = res.color || '#3B82F6'
                              return (
                                <div
                                  key={idx}
                                  className="flex-1 flex items-center justify-center overflow-hidden border-r border-white/50 last:border-r-0"
                                  style={{ backgroundColor: `${color}${opacityHex}` }}
                                >
                                  {showLabel && slotReservations.length <= 2 && (
                                    <span 
                                      className="text-[8px] font-bold truncate px-0.5"
                                      style={{ color }}
                                    >
                                      {res.reservation_type === 'gpu'
                                        ? `${res.gpu_count ?? '?'}GPU`
                                        : (res.cluster_name?.substring(0, 8) || res.title.substring(0, 6))}
                                    </span>
                                  )}
                                </div>
                              )
                            })}
                            {/* Overlap indicator badge */}
                            <div className="absolute top-0 right-0 bg-gray-800 text-white text-[8px] font-bold px-1 rounded-bl">
                              {slotReservations.length}
                            </div>
                          </div>
                        ) : (
                          // Single reservation
                          <div 
                            className="absolute inset-0 flex items-center px-1"
                            style={{ backgroundColor: `${slotReservations[0].color || '#3B82F6'}30` }}
                          >
                            {isReservationStart(date, hour, slotReservations[0]) && (
                              <span 
                                className="text-[10px] font-medium truncate"
                                style={{ color: slotReservations[0].color || '#3B82F6' }}
                              >
                                {slotReservations[0].title}
                              </span>
                            )}
                          </div>
                        )
                      ) : (
                        <div className="absolute inset-0 hover:bg-green-50 transition-colors" />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Legend */}
      <div className="p-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-100 border border-green-300 rounded" />
            <span>Available</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-200 rounded" />
            <span>Reserved</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-gradient-to-r from-blue-200 to-purple-200 rounded relative">
              <span className="absolute -top-0.5 -right-0.5 bg-gray-800 text-white text-[6px] w-2 h-2 flex items-center justify-center rounded-sm">2</span>
            </div>
            <span>Overlapping</span>
          </div>
        </div>
        <Link 
          to="/calendar" 
          className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          <CalendarDaysIcon className="h-4 w-4" />
          Full Calendar
        </Link>
      </div>
    </div>
  )
}

function EnforcementStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null
  const styles: Record<string, string> = {
    provisioned: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
    cleaned: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function ReservationTypeBadge({ reservation }: { reservation: { reservation_type?: string; gpu_count?: number | null } }) {
  if (reservation.reservation_type === 'gpu') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
        {reservation.gpu_count ?? '?'} GPU
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
      Cluster
    </span>
  )
}

export default function Reservations() {
  const [isOpen, setIsOpen] = useState(false)
  const [form, setForm] = useState(initialFormState)
  const [selectedCluster, setSelectedCluster] = useState<{ id: string; name: string } | null>(null)

  const { data: reservationsData, isLoading: reservationsLoading } = useReservations()
  const { data: clustersData } = useClusters()
  const createReservation = useCreateReservation()
  const deleteReservation = useDeleteReservation()
  const cancelReservation = useCancelReservation()

  const reservations = reservationsData?.reservations || []
  const clusters = clustersData?.clusters || []

  // Split reservations into categories
  const activeReservations = reservations
    .filter((r) => r.status === 'active')
    .sort((a, b) => new Date(a.end_time).getTime() - new Date(b.end_time).getTime())
  
  const upcomingReservations = reservations
    .filter((r) => r.status === 'scheduled')
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
  
  const pastReservations = reservations
    .filter((r) => r.status === 'completed' || r.status === 'cancelled')
    .sort((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime())

  const selectedClusterData = clusters.find(c => c.id === selectedCluster?.id)
  const { data: gpuStatus } = useGpuStatus(selectedCluster?.id, !!selectedCluster)

  const handleSubmit = async () => {
    if (!form.cluster_id || !form.title || !form.user_name || !form.start_time || !form.end_time) {
      toast.error('Please fill in all required fields')
      return
    }

    if (form.reservation_type === 'gpu' && (!form.gpu_count || parseInt(form.gpu_count) < 1)) {
      toast.error('GPU count must be at least 1')
      return
    }

    await createReservation.mutateAsync({
      cluster_id: form.cluster_id,
      title: form.title,
      description: form.description || undefined,
      user_name: form.user_name,
      user_email: form.user_email || undefined,
      team: form.team || undefined,
      start_time: new Date(form.start_time).toISOString(),
      end_time: new Date(form.end_time).toISOString(),
      purpose: form.purpose || undefined,
      reservation_type: form.reservation_type,
      gpu_count: form.reservation_type === 'gpu' ? parseInt(form.gpu_count) : undefined,
      enforce_isolation: form.reservation_type === 'gpu' ? form.enforce_isolation : false,
    })

    setIsOpen(false)
    setForm(initialFormState)
    setSelectedCluster(null)
  }

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this reservation?')) {
      await deleteReservation.mutateAsync(id)
    }
  }

  const handleCancel = async (id: string) => {
    if (window.confirm('Are you sure you want to cancel this reservation?')) {
      await cancelReservation.mutateAsync(id)
    }
  }

  return (
    <div className="space-y-6">
      {/* Week Calendar - Centered */}
      <div className="flex justify-center">
        <div className="w-full max-w-4xl">
          <WeekCalendar reservations={reservations} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage cluster reservations and time slots
          </p>
        </div>
        <button onClick={() => setIsOpen(true)} className="btn-primary">
          <PlusIcon className="h-4 w-4 mr-2" />
          New Reservation
        </button>
      </div>

      <div className="space-y-6">

          {reservationsLoading ? (
        <div className="card p-12 text-center text-gray-500">Loading reservations...</div>
      ) : reservations.length === 0 ? (
        <div className="card p-12 text-center">
          <CalendarDaysIcon className="h-16 w-16 mx-auto text-gray-300" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No reservations yet</h3>
          <p className="mt-2 text-gray-500">Create your first reservation to get started.</p>
          <button onClick={() => setIsOpen(true)} className="mt-6 btn-primary">
            <PlusIcon className="h-4 w-4 mr-2" />
            New Reservation
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Reservations */}
          <div className="card border-l-4 border-l-green-500 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-green-50">
              <div className="flex items-center gap-2">
                {activeReservations.length > 0 && (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                )}
                <h2 className="text-lg font-semibold text-gray-900">Active Now ({activeReservations.length})</h2>
              </div>
            </div>
            {activeReservations.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500">No active reservations right now</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reservation</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cluster</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User / Team</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ends</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {activeReservations.map((reservation) => (
                      <tr key={reservation.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-1 rounded-full" style={{ backgroundColor: reservation.color }} />
                            <div>
                              <p className="font-medium text-gray-900">{reservation.title}</p>
                              {reservation.description && (
                                <p className="text-sm text-gray-500 truncate max-w-xs">{reservation.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{reservation.cluster_name || 'Unknown'}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <ReservationTypeBadge reservation={reservation} />
                          {reservation.enforcement_namespace && (
                            <div className="flex items-center gap-1 mt-1">
                              <p className="text-[10px] text-gray-500 font-mono">{reservation.enforcement_namespace}</p>
                              <EnforcementStatusBadge status={reservation.enforcement_status} />
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-900">{reservation.user_name}</p>
                          {reservation.team && <p className="text-xs text-gray-500">{reservation.team}</p>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <p className="text-gray-900">
                            Started: {format(new Date(reservation.start_time), 'MMM d, h:mm a')}
                          </p>
                          <p className="text-gray-500">
                            Ends: {format(new Date(reservation.end_time), 'MMM d, yyyy h:mm a')}
                          </p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button onClick={() => handleDelete(reservation.id)} className="text-red-600 hover:text-red-700">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Upcoming Reservations */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Upcoming ({upcomingReservations.length})</h2>
              <p className="text-sm text-gray-500 mt-1">Scheduled reservations</p>
            </div>
            {upcomingReservations.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500">No upcoming reservations</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reservation</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cluster</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User / Team</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {upcomingReservations.map((reservation) => (
                      <tr key={reservation.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-1 rounded-full" style={{ backgroundColor: reservation.color }} />
                            <div>
                              <p className="font-medium text-gray-900">{reservation.title}</p>
                              {reservation.description && (
                                <p className="text-sm text-gray-500 truncate max-w-xs">{reservation.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{reservation.cluster_name || 'Unknown'}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <ReservationTypeBadge reservation={reservation} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-900">{reservation.user_name}</p>
                          {reservation.team && <p className="text-xs text-gray-500">{reservation.team}</p>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <p className="text-gray-900">
                            {format(new Date(reservation.start_time), 'MMM d, yyyy h:mm a')}
                          </p>
                          <p className="text-gray-500">
                            to {format(new Date(reservation.end_time), 'MMM d, yyyy h:mm a')}
                          </p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button onClick={() => handleCancel(reservation.id)} className="text-orange-600 hover:text-orange-700 mr-3">Cancel</button>
                          <button onClick={() => handleDelete(reservation.id)} className="text-red-600 hover:text-red-700">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Past Reservations */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Past ({pastReservations.length})</h2>
              <p className="text-sm text-gray-500 mt-1">Completed and cancelled reservations</p>
            </div>
            {pastReservations.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500">No past reservations</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reservation</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cluster</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User / Team</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {pastReservations.map((reservation) => (
                      <tr key={reservation.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-1 rounded-full opacity-50" style={{ backgroundColor: reservation.color }} />
                            <div>
                              <p className="font-medium text-gray-600">{reservation.title}</p>
                              {reservation.description && (
                                <p className="text-sm text-gray-400 truncate max-w-xs">{reservation.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{reservation.cluster_name || 'Unknown'}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-600">{reservation.user_name}</p>
                          {reservation.team && <p className="text-xs text-gray-400">{reservation.team}</p>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <p className="text-gray-600">
                            {format(new Date(reservation.start_time), 'MMM d, yyyy h:mm a')}
                          </p>
                          <p className="text-gray-400">
                            to {format(new Date(reservation.end_time), 'MMM d, yyyy h:mm a')}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className={`badge ${reservation.status === 'completed' ? 'badge-success' : 'badge-error'}`}>
                              {reservation.status}
                            </span>
                            {reservation.status === 'cancelled' && reservation.notes && (
                              <p className="text-[10px] text-gray-400 leading-tight" title={reservation.notes}>
                                {reservation.notes.includes('[') ? reservation.notes.match(/\[([^\]]+)\]/)?.[1] : ''}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button onClick={() => handleDelete(reservation.id)} className="text-red-600 hover:text-red-700">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsOpen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl bg-white p-6 shadow-xl transition-all">
                  <div className="flex items-center justify-between">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      New Reservation
                    </Dialog.Title>
                    <button
                      onClick={() => setIsOpen(false)}
                      className="p-2 rounded-lg hover:bg-gray-100"
                    >
                      <XMarkIcon className="h-5 w-5 text-gray-500" />
                    </button>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Cluster *</label>
                      <Listbox
                        value={selectedCluster}
                        onChange={(cluster) => {
                          setSelectedCluster(cluster)
                          setForm((prev) => ({ ...prev, cluster_id: cluster?.id || '' }))
                        }}
                      >
                        <div className="relative mt-1">
                          <Listbox.Button className="relative w-full cursor-pointer rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-left shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
                            <span className="block truncate">
                              {selectedCluster?.name || 'Select a cluster'}
                            </span>
                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                              <ChevronUpDownIcon className="h-5 w-5 text-gray-400" />
                            </span>
                          </Listbox.Button>
                          <Transition
                            as={Fragment}
                            leave="transition ease-in duration-100"
                            leaveFrom="opacity-100"
                            leaveTo="opacity-0"
                          >
                            <Listbox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                              {clusters.map((cluster) => (
                                <Listbox.Option
                                  key={cluster.id}
                                  value={{ id: cluster.id, name: cluster.name }}
                                  className={({ active }) =>
                                    `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                                      active ? 'bg-primary-100 text-primary-900' : 'text-gray-900'
                                    }`
                                  }
                                >
                                  {({ selected }) => (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <div 
                                          className="w-3 h-3 rounded-full flex-shrink-0" 
                                          style={{ backgroundColor: cluster.color || '#3B82F6' }}
                                        />
                                        <span
                                          className={`block truncate ${
                                            selected ? 'font-medium' : 'font-normal'
                                          }`}
                                        >
                                          {cluster.name}
                                        </span>
                                      </div>
                                      {selected && (
                                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-600">
                                          <CheckIcon className="h-5 w-5" />
                                        </span>
                                      )}
                                    </>
                                  )}
                                </Listbox.Option>
                              ))}
                            </Listbox.Options>
                          </Transition>
                        </div>
                      </Listbox>
                    </div>

                    {/* Reservation Type Toggle */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Reservation Type *</label>
                      <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, reservation_type: 'cluster', gpu_count: '', enforce_isolation: false }))}
                          className={clsx(
                            'flex-1 py-2 px-4 text-sm font-medium transition-colors',
                            form.reservation_type === 'cluster'
                              ? 'bg-primary-600 text-white'
                              : 'bg-white text-gray-700 hover:bg-gray-50'
                          )}
                        >
                          Full Cluster
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, reservation_type: 'gpu' }))}
                          className={clsx(
                            'flex-1 py-2 px-4 text-sm font-medium transition-colors border-l border-gray-300',
                            form.reservation_type === 'gpu'
                              ? 'bg-primary-600 text-white'
                              : 'bg-white text-gray-700 hover:bg-gray-50'
                          )}
                        >
                          Specific GPUs
                        </button>
                      </div>
                    </div>

                    {/* GPU Count + Availability */}
                    {form.reservation_type === 'gpu' && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Number of GPUs *</label>
                          <input
                            type="number"
                            min="1"
                            max={gpuStatus?.free_gpus ?? gpuStatus?.total_gpus ?? 999}
                            value={form.gpu_count}
                            onChange={(e) => setForm(prev => ({ ...prev, gpu_count: e.target.value }))}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                            placeholder="e.g., 2"
                          />
                        </div>
                        {gpuStatus && (
                          <div className="p-3 bg-blue-50 rounded-lg text-sm">
                            <div className="font-medium text-blue-900 mb-1">GPU Availability</div>
                            <div className="grid grid-cols-3 gap-2 text-blue-800">
                              <div>Total: <span className="font-semibold">{gpuStatus.total_gpus}</span></div>
                              <div>Allocated: <span className="font-semibold">{gpuStatus.allocated_gpus}</span></div>
                              <div>Free: <span className="font-semibold text-green-700">{gpuStatus.free_gpus}</span></div>
                            </div>
                            {gpuStatus.gpu_types.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {gpuStatus.gpu_types.map((t, i) => (
                                  <div key={i} className="flex items-center justify-between text-xs text-blue-700">
                                    <span>{t.product}</span>
                                    <span>{t.free}/{t.count} free</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {gpuStatus.dra_available && (
                              <div className="mt-1 text-xs text-blue-600">
                                DRA {gpuStatus.dra_api_version} enabled
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-3 relative">
                          <label className="flex items-start gap-2 opacity-50 cursor-not-allowed">
                            <input
                              type="checkbox"
                              checked={false}
                              disabled
                              className="mt-0.5 rounded border-gray-300 text-gray-400 cursor-not-allowed"
                            />
                            <span className="text-sm text-gray-500">
                              <span className="font-medium">Enable isolation</span>
                            </span>
                          </label>
                          <div className="group inline-block ml-1 align-middle">
                            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-300 text-[10px] font-bold text-white cursor-help">?</span>
                            <div className="hidden group-hover:block absolute z-50 left-0 mt-1 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg">
                              <p className="font-semibold mb-1">Isolation is currently disabled</p>
                              <p>When enabled, this creates a dedicated Kubernetes namespace with a ResourceQuota to enforce GPU limits directly on the cluster, preventing workloads from exceeding the reserved GPU count.</p>
                              <p className="mt-1.5">This feature is intentionally disabled while the team evaluates its use in production. Reservations currently operate on a trust-based model.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Title *</label>
                      <input
                        type="text"
                        value={form.title}
                        onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                        placeholder="e.g., GPU Benchmark Testing"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Your Name *
                        </label>
                        <input
                          type="text"
                          value={form.user_name}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, user_name: e.target.value }))
                          }
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Team</label>
                        <input
                          type="text"
                          value={form.team}
                          onChange={(e) => setForm((prev) => ({ ...prev, team: e.target.value }))}
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                          placeholder="e.g., PSAP"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Start Time *
                        </label>
                        <input
                          type="datetime-local"
                          value={form.start_time}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, start_time: e.target.value }))
                          }
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">End Time *</label>
                        <input
                          type="datetime-local"
                          value={form.end_time}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, end_time: e.target.value }))
                          }
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Purpose</label>
                      <textarea
                        value={form.purpose}
                        onChange={(e) => setForm((prev) => ({ ...prev, purpose: e.target.value }))}
                        rows={2}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                        placeholder="What will you be using the cluster for?"
                      />
                    </div>

                    {selectedCluster && selectedClusterData && (
                      <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: selectedClusterData.color || '#3B82F6' }}
                          />
                          <span className="text-sm text-gray-600">
                            Reservation will use <strong>{selectedCluster.name}</strong>'s color
                          </span>
                        </div>
                        {(selectedClusterData.gpu_type || selectedClusterData.gpu_count) && (
                          <div className="text-xs text-gray-500 flex gap-3">
                            {selectedClusterData.gpu_type && (
                              <span>GPU: <strong>{selectedClusterData.gpu_type}</strong></span>
                            )}
                            {selectedClusterData.gpu_count && (
                              <span>Count: <strong>{selectedClusterData.gpu_count}</strong></span>
                            )}
                            {selectedClusterData.gpu_allocation_mode && (
                              <span>Mode: <strong>{selectedClusterData.gpu_allocation_mode}</strong></span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button onClick={() => setIsOpen(false)} className="btn-secondary">
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={createReservation.isPending}
                      className="btn-primary"
                    >
                      {createReservation.isPending ? 'Creating...' : 'Create Reservation'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  )
}
