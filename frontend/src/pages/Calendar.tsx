import { useState, useMemo, useCallback } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer, View, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth, addMonths } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useCalendarEvents } from '../hooks/useReservations'
import { useClusters } from '../hooks/useClusters'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const locales = { 'en-US': enUS }

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
})

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<View>(Views.MONTH)
  const [selectedCluster, setSelectedCluster] = useState<string>('')

  const start = startOfMonth(addMonths(currentDate, -1))
  const end = endOfMonth(addMonths(currentDate, 1))

  const { data: events, isLoading } = useCalendarEvents(
    start.toISOString(),
    end.toISOString(),
    selectedCluster || undefined
  )
  const { data: clustersData } = useClusters()

  const clusters = clustersData?.clusters || []

  const calendarEvents = useMemo(() => {
    if (!events) return []
    return events.map((event) => {
      const title = `${event.title} (${event.cluster_name})`
      return {
        id: event.id,
        title,
        start: new Date(event.start),
        end: new Date(event.end),
        resource: event,
      }
    })
  }, [events])

  const eventStyleGetter = useCallback((event: { resource: { color: string; status: string } }) => {
    const backgroundColor = event.resource.color || '#3B82F6'
    const opacity = event.resource.status === 'cancelled' ? 0.5 : 1

    return {
      style: {
        backgroundColor,
        borderRadius: '6px',
        opacity,
        color: 'white',
        border: 'none',
        padding: '2px 6px',
      },
    }
  }, [])

  const handleNavigate = useCallback((action: 'PREV' | 'NEXT' | 'TODAY') => {
    setCurrentDate((current) => {
      if (action === 'TODAY') return new Date()
      const increment = action === 'NEXT' ? 1 : -1
      if (view === Views.MONTH) return addMonths(current, increment)
      if (view === Views.WEEK) {
        const newDate = new Date(current)
        newDate.setDate(newDate.getDate() + increment * 7)
        return newDate
      }
      const newDate = new Date(current)
      newDate.setDate(newDate.getDate() + increment)
      return newDate
    })
  }, [view])

  const CustomToolbar = () => (
    <div className="flex items-center justify-between mb-4 px-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleNavigate('TODAY')}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Today
        </button>
        <div className="flex items-center border border-gray-300 rounded-md">
          <button
            onClick={() => handleNavigate('PREV')}
            className="p-1.5 hover:bg-gray-50 rounded-l-md"
          >
            <ChevronLeftIcon className="h-5 w-5 text-gray-500" />
          </button>
          <button
            onClick={() => handleNavigate('NEXT')}
            className="p-1.5 hover:bg-gray-50 rounded-r-md"
          >
            <ChevronRightIcon className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 ml-2">
          {format(currentDate, view === Views.DAY ? 'MMMM d, yyyy' : 'MMMM yyyy')}
        </h2>
      </div>
      <div className="flex items-center gap-4">
        <select
          value={selectedCluster}
          onChange={(e) => setSelectedCluster(e.target.value)}
          className="rounded-md border-gray-300 text-sm focus:border-primary-500 focus:ring-primary-500"
        >
          <option value="">All Clusters</option>
          {clusters.map((cluster) => (
            <option key={cluster.id} value={cluster.id}>
              {cluster.name}
            </option>
          ))}
        </select>
        <div className="flex border border-gray-300 rounded-md">
          {[
            { key: Views.MONTH, label: 'Month' },
            { key: Views.WEEK, label: 'Week' },
            { key: Views.DAY, label: 'Day' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === key
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-700 hover:bg-gray-50'
              } ${key === Views.MONTH ? 'rounded-l-md' : ''} ${
                key === Views.DAY ? 'rounded-r-md' : ''
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
        <p className="mt-1 text-sm text-gray-500">
          View cluster reservations across all clusters
        </p>
      </div>

      <div className="card p-6">
        {isLoading ? (
          <div className="h-[600px] flex items-center justify-center text-gray-500">
            Loading calendar...
          </div>
        ) : (
          <>
            <CustomToolbar />
            <BigCalendar
              localizer={localizer}
              events={calendarEvents}
              startAccessor="start"
              endAccessor="end"
              style={{ height: 600 }}
              view={view}
              date={currentDate}
              onView={setView}
              onNavigate={setCurrentDate}
              eventPropGetter={eventStyleGetter}
              toolbar={false}
              popup
              tooltipAccessor={(event) => {
                const e = event.resource
                return `${e.title}\nCluster: ${e.cluster_name}\nUser: ${e.user_name}${
                  e.team ? `\nTeam: ${e.team}` : ''
                }\n${format(new Date(e.start), 'MMM d, h:mm a')} - ${format(
                  new Date(e.end),
                  'h:mm a'
                )}`
              }}
            />
          </>
        )}
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Legend</h2>
        <div className="flex flex-wrap gap-4">
          {clusters.map((cluster) => (
            <div key={cluster.id} className="flex items-center gap-2">
              <div
                className="h-4 w-4 rounded"
                style={{ backgroundColor: cluster.color || '#3B82F6' }}
              />
              <span className="text-sm text-gray-700">{cluster.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
