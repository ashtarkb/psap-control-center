import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useClusterOverview, useHoldSlot, useReleaseSlot, useSlotHolds } from '../hooks/useFournos'
import { getUsername } from '../stores/authStore'
import { browserTimezone, buildUtcCron, isoToLocalParts, zonedWallTimeToUtcDate } from '../utils/timezone'
import { cronOccurrenceOnLocalDate, slotIndexFor, slotLabel, slotStart, SLOT_MINUTES, SLOTS_PER_DAY } from '../utils/cronOccurrences'
import type { ClusterOverview, JobScheduling } from '../types'

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function ymdKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function todayParts() {
  const now = new Date()
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay()
}

function utcIsoForSlot(y: number, m: number, d: number, hour: number, minute: number, tz: string): string {
  return zonedWallTimeToUtcDate(y, m, d, hour, minute, tz).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** "16:30 – 19:30" for a [loIdx, hiIdx] inclusive slot range — local wall-clock
 * labels only (no tz conversion needed since both ends are the same day). */
function formatSlotRange(loIdx: number, hiIdx: number): string {
  const lo = slotStart(loIdx)
  const endTotalMinutes = (hiIdx + 1) * SLOT_MINUTES
  const endHour = Math.floor(endTotalMinutes / 60) % 24
  const endMinute = endTotalMinutes % 60
  return `${pad2(lo.hour)}:${pad2(lo.minute)} \u2013 ${pad2(endHour)}:${pad2(endMinute)}`
}

interface SlotItem {
  kind: 'job' | 'recurring' | 'lock'
  label: string
  /** Multi-slot runs (currently only fixed-duration locks) render as one
   * continuous block spanning every row they overlap, instead of a chip
   * repeated on each one — these say whether this slot is the first/last
   * of that run so the day view knows where to cap it with rounded
   * corners vs. where to keep it flush to blend into the next/previous
   * row. Always [true, true] for inherently single-slot items (jobs,
   * recurring occurrences, indefinite/no-duration locks). */
  runStart: boolean
  runEnd: boolean
}

interface TimedItem {
  hour: number
  minute: number
  kind: SlotItem['kind']
}

/** Flat, time-sorted list of everything that happens on this local day —
 * used by the month view to show the next few items as text instead of
 * just a dot. */
function itemsForDaySorted(overview: ClusterOverview | undefined, y: number, m: number, d: number, tz: string): TimedItem[] {
  const dateKey = ymdKey(y, m, d)
  const items: TimedItem[] = []

  for (const job of overview?.current_jobs ?? []) {
    if (!job.scheduled_start_time) continue
    const { date, time } = isoToLocalParts(job.scheduled_start_time, tz)
    if (date !== dateKey) continue
    const [h, mi] = time.split(':').map(Number)
    items.push({ hour: h, minute: mi, kind: 'job' })
  }
  for (const r of overview?.recurring_jobs ?? []) {
    const occ = cronOccurrenceOnLocalDate(r.schedule, y, m, d, tz)
    if (!occ) continue
    items.push({ hour: occ.hour, minute: occ.minute, kind: 'recurring' })
  }
  for (const lock of overview?.locks ?? []) {
    if (lock.scheduled_start_time) {
      const { date, time } = isoToLocalParts(lock.scheduled_start_time, tz)
      if (date !== dateKey) continue
      const [h, mi] = time.split(':').map(Number)
      items.push({ hour: h, minute: mi, kind: 'lock' })
    } else {
      const t = todayParts()
      if (t.y === y && t.m === m && t.d === d) items.push({ hour: 0, minute: 0, kind: 'lock' })
    }
  }
  return items.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
}

function occupancyForDay(overview: ClusterOverview | undefined, y: number, m: number, d: number, tz: string): Map<number, SlotItem[]> {
  const map = new Map<number, SlotItem[]>()
  const add = (hour: number, minute: number, item: SlotItem) => {
    const idx = slotIndexFor(hour, minute)
    const list = map.get(idx) ?? []
    list.push(item)
    map.set(idx, list)
  }
  const dateKey = ymdKey(y, m, d)

  for (const job of overview?.current_jobs ?? []) {
    if (!job.scheduled_start_time) continue
    const { date, time } = isoToLocalParts(job.scheduled_start_time, tz)
    if (date !== dateKey) continue
    const [h, mi] = time.split(':').map(Number)
    add(h, mi, { kind: 'job', label: `${job.name} (${job.project})`, runStart: true, runEnd: true })
  }
  for (const r of overview?.recurring_jobs ?? []) {
    const occ = cronOccurrenceOnLocalDate(r.schedule, y, m, d, tz)
    if (!occ) continue
    add(occ.hour, occ.minute, { kind: 'recurring', label: `${r.name} (recurring, ${r.project})`, runStart: true, runEnd: true })
  }
  for (const lock of overview?.locks ?? []) {
    const label = `lock-${lock.owner || 'unknown'}-${lock.reason || lock.name}`
    const untilMs = lock.lock_until ? new Date(lock.lock_until).getTime() : null
    if (untilMs === null) {
      // No fixed end — held indefinitely, so just mark the single moment it
      // started (or "now" if it wasn't deferred) rather than painting the
      // rest of the calendar.
      if (lock.scheduled_start_time) {
        const { date, time } = isoToLocalParts(lock.scheduled_start_time, tz)
        if (date === dateKey) {
          const [h, mi] = time.split(':').map(Number)
          add(h, mi, { kind: 'lock', label, runStart: true, runEnd: true })
        }
      } else {
        const t = todayParts()
        if (t.y === y && t.m === m && t.d === d) add(0, 0, { kind: 'lock', label: `${label} (held now)`, runStart: true, runEnd: true })
      }
      continue
    }
    // Fixed-duration lock (has a start and a lockUntil) — paint every slot
    // it overlaps on this calendar day as one continuous run. runStart/
    // runEnd are only true where the lock's real boundary actually falls
    // *within* this day, so a lock spanning midnight renders with a flat
    // (non-rounded) edge on the day(s) it merely continues through.
    const startMs = lock.scheduled_start_time
      ? new Date(lock.scheduled_start_time).getTime()
      : new Date(lock.created_at).getTime()
    const dayStartMs = zonedWallTimeToUtcDate(y, m, d, 0, 0, tz).getTime()
    const dayEndMs = dayStartMs + 24 * 3600_000

    let firstIdx = -1
    let lastIdx = -1
    for (let idx = 0; idx < SLOTS_PER_DAY; idx++) {
      const { hour, minute } = slotStart(idx)
      const slotStartMs = zonedWallTimeToUtcDate(y, m, d, hour, minute, tz).getTime()
      const slotEndMs = slotStartMs + SLOT_MINUTES * 60_000
      if (slotStartMs < untilMs && slotEndMs > startMs) {
        if (firstIdx === -1) firstIdx = idx
        lastIdx = idx
      }
    }
    if (firstIdx === -1) continue

    const trueStart = startMs >= dayStartMs
    const trueEnd = untilMs <= dayEndMs
    // One combined label — time range, reason, owner — shown once at the
    // run's start row instead of repeating (or splitting across) every
    // slot it spans.
    const rangeLabel = `${formatSlotRange(firstIdx, lastIdx)} \u00b7 ${lock.reason || lock.name} \u00b7 ${lock.owner || 'unknown'}`
    for (let idx = firstIdx; idx <= lastIdx; idx++) {
      const { hour, minute } = slotStart(idx)
      add(hour, minute, {
        kind: 'lock',
        label: rangeLabel,
        runStart: idx === firstIdx && trueStart,
        runEnd: idx === lastIdx && trueEnd,
      })
    }
  }
  return map
}

const KIND_STYLES: Record<SlotItem['kind'], string> = {
  job: 'bg-blue-50 text-blue-700 border-blue-200',
  recurring: 'bg-teal-50 text-teal-700 border-teal-200',
  lock: 'bg-red-50 text-red-700 border-red-200',
}

/** Same palette as KIND_STYLES, but as a full-row fill (border only on the
 * left/right by default) for multi-slot runs — see isMultiSlotRun in
 * DayView, which adds the top/bottom border + rounding only at the run's
 * actual start/end row so consecutive rows blend into one block. */
const KIND_FILL_STYLES: Record<SlotItem['kind'], string> = {
  job: 'bg-blue-50 text-blue-700 border-blue-200 border-l border-r',
  recurring: 'bg-teal-50 text-teal-700 border-teal-200 border-l border-r',
  lock: 'bg-red-50 text-red-700 border-red-200 border-l border-r',
}

const DOT_STYLES: Record<SlotItem['kind'], string> = {
  job: 'bg-blue-500',
  recurring: 'bg-teal-500',
  lock: 'bg-red-500',
}

const HEARTBEAT_MS = 45_000

interface SelectedSlot {
  y: number
  m: number
  d: number
  hour: number
  minute: number
}

export interface LockChoice {
  /** null = start immediately, no calendar pick. */
  startUtc: string | null
  /** null = held indefinitely, until manually released. */
  untilUtc: string | null
  label: string
}

interface BaseProps {
  cluster: string
  /** Read-only "what's happening on this cluster" preview — no slot
   * selection/holding, no action buttons. Used e.g. right under the
   * cluster picker on the submit wizard's Basics step, so a user sees at a
   * glance whether something is currently running, scheduled, or locked
   * before they go any further. Reuses the exact same month/day calendar
   * as the interactive submit/lock variants.
   */
  readOnly?: boolean
  /** Which view to open on first render. Defaults to 'month'; read-only
   * previews default the caller to 'day' so "select a cluster -> see
   * today" doesn't need an extra click.
   */
  initialView?: 'month' | 'day'
}

interface SubmitProps extends BaseProps {
  variant?: 'submit'
  onApply: (choice: JobScheduling) => void
}

interface LockProps extends BaseProps {
  variant: 'lock'
  onApplyLock: (choice: LockChoice) => void
}

export default function SchedulingCalendar(props: SubmitProps | LockProps) {
  const { cluster, readOnly = false } = props
  const isLock = props.variant === 'lock'
  const nowLabel = isLock ? 'Lock Immediately Instead' : 'Run Immediately Instead'
  const tz = useMemo(() => browserTimezone(), [])
  const username = getUsername() ?? 'you'

  const { data: overview } = useClusterOverview(cluster)
  const { data: holds } = useSlotHolds(cluster)
  const holdSlot = useHoldSlot()
  const releaseSlot = useReleaseSlot()

  const [view, setView] = useState<'month' | 'day'>(props.initialView || 'month')
  const t0 = todayParts()
  const [focusYear, setFocusYear] = useState(t0.y)
  const [focusMonth, setFocusMonth] = useState(t0.m) // 1-12
  const [focusDay, setFocusDay] = useState(t0.d)

  // `selected` is the anchor (where the mouse went down — this is the only
  // slot we soft-hold against other users). `rangeEndSlot` is where the
  // drag currently ends; for the submit variant it always mirrors
  // `selected` (no drag), for the lock variant it lets the user drag out a
  // lockUntil duration, Google-Calendar-style.
  const [selected, setSelected] = useState<SelectedSlot | null>(null)
  const [rangeEndSlot, setRangeEndSlot] = useState<{ hour: number; minute: number } | null>(null)
  const [holdErrorMsg, setHoldErrorMsg] = useState<string | null>(null)
  const isDraggingRef = useRef(false)

  const selectedRef = useRef<SelectedSlot | null>(null)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  // Best-effort release of whatever's currently held when this picker goes
  // away (modal closed, slot changed, etc.) — the server-side TTL is the
  // real safety net if this never fires (tab closed, crash, ...).
  useEffect(() => {
    return () => {
      const s = selectedRef.current
      if (s) releaseSlot.mutate({ cluster, startTime: utcIsoForSlot(s.y, s.m, s.d, s.hour, s.minute, tz) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster])

  useEffect(() => {
    if (!selected) return
    const iso = utcIsoForSlot(selected.y, selected.m, selected.d, selected.hour, selected.minute, tz)
    const heartbeat = setInterval(() => {
      holdSlot.mutate(
        { cluster, startTime: iso },
        { onError: () => { setSelected(null); setRangeEndSlot(null); setHoldErrorMsg('Your hold on this slot expired and was taken by someone else.') } }
      )
    }, HEARTBEAT_MS)
    return () => clearInterval(heartbeat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, cluster, tz])

  // Global mouseup so a drag ends even if the button is released outside
  // the slot list (e.g. over the action buttons, or off the calendar).
  useEffect(() => {
    const onUp = () => { isDraggingRef.current = false }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  const heldByOther = useMemo(() => {
    const map = new Map<string, string>() // startTime -> held_by
    for (const h of holds ?? []) {
      if (h.held_by !== username) map.set(h.start_time, h.held_by)
    }
    return map
  }, [holds, username])

  const beginSelect = async (y: number, m: number, d: number, hour: number, minute: number) => {
    if (readOnly) return
    setHoldErrorMsg(null)
    const iso = utcIsoForSlot(y, m, d, hour, minute, tz)
    if (heldByOther.has(iso)) {
      setHoldErrorMsg(`This time slot is currently being booked by ${heldByOther.get(iso)}. Try another slot.`)
      return
    }
    const prev = selectedRef.current
    if (prev) {
      releaseSlot.mutate({ cluster, startTime: utcIsoForSlot(prev.y, prev.m, prev.d, prev.hour, prev.minute, tz) })
    }
    try {
      await holdSlot.mutateAsync({ cluster, startTime: iso })
      setSelected({ y, m, d, hour, minute })
      setRangeEndSlot({ hour, minute })
      if (isLock) isDraggingRef.current = true
    } catch {
      setHoldErrorMsg('This slot was just claimed by someone else. Try another slot.')
    }
  }

  const extendSelect = (hour: number, minute: number) => {
    if (!isLock || !isDraggingRef.current || !selectedRef.current) return
    setRangeEndSlot({ hour, minute })
  }

  const cancelSelection = () => {
    const s = selectedRef.current
    if (s) releaseSlot.mutate({ cluster, startTime: utcIsoForSlot(s.y, s.m, s.d, s.hour, s.minute, tz) })
    setSelected(null)
    setRangeEndSlot(null)
  }

  const releaseAndClear = () => {
    const s = selectedRef.current
    if (s) releaseSlot.mutate({ cluster, startTime: utcIsoForSlot(s.y, s.m, s.d, s.hour, s.minute, tz) })
    setSelected(null)
    setRangeEndSlot(null)
  }

  const runNow = () => {
    releaseAndClear()
    if (props.variant === 'lock') {
      props.onApplyLock({ startUtc: null, untilUtc: null, label: 'Now' })
    } else {
      props.onApply({ mode: 'now' })
    }
  }

  /** Action-bar equivalent of "Run Now" once a slot is actually selected —
   * distinct from runNow() above (which skips the calendar entirely and
   * means "right this second"). This one submits a one-off deferred job
   * (mode: 'defer') for the exact slot the user picked, so the button next
   * to it can honestly say "Run at <time>" instead of the misleading
   * "Run Now" that used to fire regardless of the selected slot. */
  const runAtSelected = () => {
    if (!selected || props.variant === 'lock') return
    const startDate = zonedWallTimeToUtcDate(selected.y, selected.m, selected.d, selected.hour, selected.minute, tz)
    const startUtc = startDate.toISOString().replace(/\.\d{3}Z$/, 'Z')
    const time = `${pad2(selected.hour)}:${pad2(selected.minute)}`
    const label = `${time} (${tz})`
    releaseAndClear()
    props.onApply({ mode: 'defer', scheduledStartTimeUtc: startUtc, label })
  }

  const setRecurring = () => {
    if (!selected || props.variant === 'lock') return
    const time = `${pad2(selected.hour)}:${pad2(selected.minute)}`
    const cron = buildUtcCron(time, [], tz) // [] = daily, see buildUtcCron
    const label = `Daily at ${time} (${tz})`
    releaseAndClear()
    props.onApply({ mode: 'recurring', scheduleUtc: cron, label })
  }

  const createLock = () => {
    if (!selected || !rangeEndSlot || props.variant !== 'lock') return
    const loIdx = Math.min(slotIndexFor(selected.hour, selected.minute), slotIndexFor(rangeEndSlot.hour, rangeEndSlot.minute))
    const hiIdx = Math.max(slotIndexFor(selected.hour, selected.minute), slotIndexFor(rangeEndSlot.hour, rangeEndSlot.minute))
    const loStart = slotStart(loIdx)
    const startDate = zonedWallTimeToUtcDate(selected.y, selected.m, selected.d, loStart.hour, loStart.minute, tz)
    const startUtc = startDate.toISOString().replace(/\.\d{3}Z$/, 'Z')
    // Always an explicit start + end — even a plain click (no drag) locks
    // just that one 30-minute slot, rather than "held indefinitely".
    const slotCount = hiIdx - loIdx + 1
    const untilUtc = new Date(startDate.getTime() + slotCount * SLOT_MINUTES * 60_000)
      .toISOString().replace(/\.\d{3}Z$/, 'Z')
    const label = `${formatSlotRange(loIdx, hiIdx)} (${tz})`
    releaseAndClear()
    props.onApplyLock({ startUtc, untilUtc, label })
  }

  const goToDay = (y: number, m: number, d: number) => {
    setFocusYear(y)
    setFocusMonth(m)
    setFocusDay(d)
    setView('day')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Times shown in your local timezone ({tz}).</p>
        {!readOnly && (
          <button
            type="button"
            onClick={runNow}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <PlayIcon className="h-3.5 w-3.5" /> {nowLabel}
          </button>
        )}
      </div>

      {holdErrorMsg && (
        <div className="flex items-center justify-between rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          {holdErrorMsg}
          <button type="button" onClick={() => setHoldErrorMsg(null)} className="text-amber-500 hover:text-amber-700">
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {view === 'month' ? (
        <MonthView
          overview={overview}
          tz={tz}
          year={focusYear}
          month={focusMonth}
          onPrev={() => {
            if (focusMonth === 1) { setFocusYear((y) => y - 1); setFocusMonth(12) } else { setFocusMonth((m) => m - 1) }
          }}
          onNext={() => {
            if (focusMonth === 12) { setFocusYear((y) => y + 1); setFocusMonth(1) } else { setFocusMonth((m) => m + 1) }
          }}
          onToday={() => { setFocusYear(t0.y); setFocusMonth(t0.m); setFocusDay(t0.d) }}
          onSelectDay={(d) => goToDay(focusYear, focusMonth, d)}
        />
      ) : (
        <DayView
          overview={overview}
          tz={tz}
          year={focusYear}
          month={focusMonth}
          day={focusDay}
          variant={isLock ? 'lock' : 'submit'}
          readOnly={readOnly}
          selected={selected}
          rangeEndSlot={rangeEndSlot}
          heldByOther={heldByOther}
          onBackToMonth={() => setView('month')}
          onPrevDay={() => {
            const d = new Date(focusYear, focusMonth - 1, focusDay - 1)
            setFocusYear(d.getFullYear()); setFocusMonth(d.getMonth() + 1); setFocusDay(d.getDate())
          }}
          onNextDay={() => {
            const d = new Date(focusYear, focusMonth - 1, focusDay + 1)
            setFocusYear(d.getFullYear()); setFocusMonth(d.getMonth() + 1); setFocusDay(d.getDate())
          }}
          onToday={() => { setFocusYear(t0.y); setFocusMonth(t0.m); setFocusDay(t0.d) }}
          onSlotMouseDown={(hour, minute) => beginSelect(focusYear, focusMonth, focusDay, hour, minute)}
          onSlotMouseEnter={extendSelect}
          onCancelSelection={cancelSelection}
          onRunAtSelected={runAtSelected}
          onSetRecurring={setRecurring}
          onCreateLock={createLock}
        />
      )}
    </div>
  )
}

function MonthView({
  overview,
  tz,
  year,
  month,
  onPrev,
  onNext,
  onToday,
  onSelectDay,
}: {
  overview: ClusterOverview | undefined
  tz: string
  year: number
  month: number
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSelectDay: (day: number) => void
}) {
  const total = daysInMonth(year, month)
  const leading = firstWeekdayOfMonth(year, month)
  const t = todayParts()
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const cells: (number | null)[] = [...Array(leading).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={onPrev} className="p-1 rounded hover:bg-gray-100"><ChevronLeftIcon className="h-4 w-4 text-gray-500" /></button>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-gray-800">{monthLabel}</h4>
          <button type="button" onClick={onToday} className="text-xs text-indigo-600 hover:text-indigo-800">Today</button>
        </div>
        <button type="button" onClick={onNext} className="p-1 rounded hover:bg-gray-100"><ChevronRightIcon className="h-4 w-4 text-gray-500" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-1">
        {WEEKDAY_HEADERS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} className="min-h-[6.5rem]" />
          const isToday = t.y === year && t.m === month && t.d === day
          const items = itemsForDaySorted(overview, year, month, day, tz)
          const shown = items.slice(0, 3)
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              className={clsx(
                'min-h-[6.5rem] rounded-md border p-1.5 text-left text-xs flex flex-col gap-1 hover:border-indigo-400 hover:bg-indigo-50/40',
                isToday ? 'border-indigo-400 bg-indigo-50/60' : 'border-gray-200'
              )}
            >
              <span className={clsx('font-medium', isToday ? 'text-indigo-700' : 'text-gray-700')}>{day}</span>
              {shown.length > 0 && (
                <div className="flex-1 space-y-0.5 overflow-hidden">
                  {shown.map((it, i2) => (
                    <div key={i2} className={clsx('truncate rounded px-1 py-0.5 text-[10px] font-medium', KIND_STYLES[it.kind])}>
                      {it.kind} {pad2(it.hour)}:{pad2(it.minute)}
                    </div>
                  ))}
                  {items.length > shown.length && (
                    <div className="text-[10px] text-gray-400">+{items.length - shown.length} more</div>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Scheduled job</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Recurring</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Lock</span>
      </div>
    </div>
  )
}

function DayView({
  overview,
  tz,
  year,
  month,
  day,
  variant,
  readOnly = false,
  selected,
  rangeEndSlot,
  heldByOther,
  onBackToMonth,
  onPrevDay,
  onNextDay,
  onToday,
  onSlotMouseDown,
  onSlotMouseEnter,
  onCancelSelection,
  onRunAtSelected,
  onSetRecurring,
  onCreateLock,
}: {
  overview: ClusterOverview | undefined
  tz: string
  year: number
  month: number
  day: number
  variant: 'submit' | 'lock'
  readOnly?: boolean
  selected: SelectedSlot | null
  rangeEndSlot: { hour: number; minute: number } | null
  heldByOther: Map<string, string>
  onBackToMonth: () => void
  onPrevDay: () => void
  onNextDay: () => void
  onToday: () => void
  onSlotMouseDown: (hour: number, minute: number) => void
  onSlotMouseEnter: (hour: number, minute: number) => void
  onCancelSelection: () => void
  onRunAtSelected: () => void
  onSetRecurring: () => void
  onCreateLock: () => void
}) {
  const occupancy = useMemo(() => occupancyForDay(overview, year, month, day, tz), [overview, year, month, day, tz])
  const dateLabel = new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const isPast = (hour: number, minute: number) => zonedWallTimeToUtcDate(year, month, day, hour, minute, tz).getTime() < Date.now()

  const onThisDay = !!selected && selected.y === year && selected.m === month && selected.d === day
  const loIdx = onThisDay && rangeEndSlot ? Math.min(slotIndexFor(selected!.hour, selected!.minute), slotIndexFor(rangeEndSlot.hour, rangeEndSlot.minute)) : -1
  const hiIdx = onThisDay && rangeEndSlot ? Math.max(slotIndexFor(selected!.hour, selected!.minute), slotIndexFor(rangeEndSlot.hour, rangeEndSlot.minute)) : -1

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={onBackToMonth} className="text-xs text-indigo-600 hover:text-indigo-800">← Month view</button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onPrevDay} className="p-1 rounded hover:bg-gray-100"><ChevronLeftIcon className="h-4 w-4 text-gray-500" /></button>
          <h4 className="text-lg font-semibold text-gray-900">{dateLabel}</h4>
          <button type="button" onClick={onNextDay} className="p-1 rounded hover:bg-gray-100"><ChevronRightIcon className="h-4 w-4 text-gray-500" /></button>
        </div>
        <button type="button" onClick={onToday} className="text-xs text-indigo-600 hover:text-indigo-800">Today</button>
      </div>

      {!readOnly && variant === 'lock' && (
        <p className="mb-2 text-xs text-gray-400">Click a slot to lock starting there, or click-and-drag down to set how long the lock lasts.</p>
      )}

      <div className={clsx('max-h-96 overflow-y-auto rounded-md border border-gray-100 divide-y divide-gray-50', !readOnly && 'select-none')}>
        {Array.from({ length: SLOTS_PER_DAY }, (_, idx) => {
          const { hour, minute } = slotStart(idx)
          const items = occupancy.get(idx) ?? []
          const iso = utcIsoForSlot(year, month, day, hour, minute, tz)
          const heldBy = heldByOther.get(iso)
          const inRange = onThisDay && idx >= loIdx && idx <= hiIdx
          const past = isPast(hour, minute)
          // A multi-slot run (i.e. not both runStart and runEnd — currently
          // only fixed-duration locks) renders as a full-row color fill
          // instead of a boxed chip, so consecutive rows blend into one
          // continuous block — see KIND_FILL_STYLES. This is picked out of
          // `items` regardless of what else happens to land in the same
          // slot (e.g. a job starting at the exact same time the lock's
          // run continues through), so the run's block never gets chopped
          // up into a boxed chip just because it shares a row with
          // something else. Any other, inherently single-slot items in
          // this row still render as their own small chips below.
          const runItem = items.find((it) => !(it.runStart && it.runEnd)) ?? null
          const otherItems = runItem ? items.filter((it) => it !== runItem) : items
          const isMultiSlotRun = !!runItem

          return (
            <div
              key={idx}
              onMouseDown={() => { if (!readOnly && !heldBy && !past) onSlotMouseDown(hour, minute) }}
              onMouseEnter={() => { if (!readOnly) onSlotMouseEnter(hour, minute) }}
              className={clsx(
                'px-2 py-1.5',
                readOnly ? 'cursor-default' : 'cursor-pointer',
                inRange
                  ? 'bg-indigo-50'
                  : isMultiSlotRun && [
                      KIND_FILL_STYLES[runItem!.kind],
                      runItem!.runStart && 'rounded-t-md border-t',
                      runItem!.runEnd && 'rounded-b-md border-b',
                    ]
              )}
            >
              <div className="flex items-center gap-2">
                <span className={clsx('w-14 shrink-0 font-mono text-sm', !isMultiSlotRun && 'text-gray-500')}>{slotLabel(idx)}</span>
                {isMultiSlotRun && runItem!.runStart && (
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                    <span className={clsx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', DOT_STYLES[runItem!.kind])} />
                    <span className="truncate">{runItem!.label}</span>
                  </span>
                )}
                <div className="flex-1" />
                {isMultiSlotRun ? null : readOnly ? null : heldBy ? (
                  <span className="shrink-0 text-[10px] text-gray-400 italic" title={`${heldBy} is currently booking this slot`}>booking…</span>
                ) : past ? (
                  <span className="shrink-0 text-[10px] text-gray-300">past</span>
                ) : !inRange ? (
                  <span className="shrink-0 text-xs font-medium text-indigo-600">
                    {variant === 'lock' ? 'Lock here' : 'Select'}
                  </span>
                ) : null}
              </div>
              {otherItems.length > 0 && (
                <div className="mt-1 space-y-1">
                  {otherItems.map((it, i) => (
                    <div key={i} className={clsx('w-full rounded-md border px-2 py-1 text-xs font-medium', KIND_STYLES[it.kind])}>
                      <span className={clsx('inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle', DOT_STYLES[it.kind])} />
                      {it.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Action bar for the active selection — pinned below the scrollable
          slot list (rather than inline at the range's last row) so it stays
          in one predictable place and visible regardless of where in a
          multi-slot drag the user's mouse ends up. Nothing is actually
          created/locked until "Submit"/"Run Now"/"Set Recurring" is
          pressed; "Undo" just releases the hold and clears the selection. */}
      {onThisDay && rangeEndSlot && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2.5">
          <p className="text-xs font-medium text-indigo-700">
            {variant === 'lock' ? <>Locking <span className="font-mono">{formatSlotRange(loIdx, hiIdx)}</span></> : <>Selected <span className="font-mono">{slotLabel(loIdx)}</span></>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {variant === 'lock' ? (
              <button
                type="button"
                onClick={onCreateLock}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                Submit ({formatSlotRange(loIdx, hiIdx)})
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onRunAtSelected}
                  className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  Run at {slotLabel(loIdx)}
                </button>
                <button
                  type="button"
                  onClick={onSetRecurring}
                  className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500"
                >
                  Set Recurring (daily)
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onCancelSelection}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
