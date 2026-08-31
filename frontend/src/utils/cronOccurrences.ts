// Reverse of timezone.ts's buildUtcCron(): given a UTC 5-field cron string
// of the restricted shape it produces ("MIN HOUR * * *" or
// "MIN HOUR * * DOW[,DOW...]"), figures out whether/when it fires on a
// given LOCAL calendar date, for painting recurring schedules onto the
// scheduling calendar. Not a general-purpose cron parser — anything outside
// that shape (step values, ranges, multiple minutes, etc.) is treated as
// "can't render" and simply omitted from the calendar rather than guessed.

import { isoToLocalParts, zonedWallTimeToUtcDate } from './timezone'

export interface LocalOccurrence {
  hour: number
  minute: number
}

/** Does `cron` (UTC) fire at some point during the local calendar day
 * (year, month, day) as observed in `tz`? If so, at what local wall-clock
 * time? Returns null if it doesn't fire that day, or the cron can't be
 * parsed as one of our restricted shapes.
 */
export function cronOccurrenceOnLocalDate(
  cron: string,
  year: number,
  month: number,
  day: number,
  tz: string
): LocalOccurrence | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return null
  const cronMinute = Number(parts[0])
  const cronHour = Number(parts[1])
  const cronDowField = parts[4]
  if (!Number.isInteger(cronMinute) || !Number.isInteger(cronHour)) return null

  const dayStart = zonedWallTimeToUtcDate(year, month, day, 0, 0, tz)
  // Advance ~24h then re-derive the *next local calendar date* (handles
  // DST days that are 23 or 25 hours long) to get an exact [start, end).
  const roughNext = new Date(dayStart.getTime() + 24 * 3600_000)
  const { date: nextLocalDate } = isoToLocalParts(roughNext.toISOString(), tz)
  const [ny, nmo, nd] = nextLocalDate.split('-').map(Number)
  const dayEnd = zonedWallTimeToUtcDate(ny, nmo, nd, 0, 0, tz)

  const utcDateStrs = new Set([
    dayStart.toISOString().slice(0, 10),
    new Date(dayEnd.getTime() - 1).toISOString().slice(0, 10),
  ])

  for (const utcDateStr of utcDateStrs) {
    const [uy, umo, ud] = utcDateStr.split('-').map(Number)
    const candidate = new Date(Date.UTC(uy, umo - 1, ud, cronHour, cronMinute, 0))
    if (candidate.getTime() < dayStart.getTime() || candidate.getTime() >= dayEnd.getTime()) continue
    if (cronDowField !== '*') {
      const dowSet = cronDowField.split(',').map(Number)
      if (!dowSet.includes(candidate.getUTCDay())) continue
    }
    const { time } = isoToLocalParts(candidate.toISOString(), tz)
    const [h, m] = time.split(':').map(Number)
    return { hour: h, minute: m }
  }
  return null
}

// ─── 30-minute slot grid helpers ────────────────────────────────────────

export const SLOT_MINUTES = 30
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES

export function slotIndexFor(hour: number, minute: number): number {
  return Math.floor((hour * 60 + minute) / SLOT_MINUTES)
}

export function slotStart(index: number): { hour: number; minute: number } {
  const totalMinutes = index * SLOT_MINUTES
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 }
}

export function slotLabel(index: number): string {
  const { hour, minute } = slotStart(index)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Does `cron` (UTC, one of our restricted "MIN HOUR * * *"/"MIN HOUR * * DOW"
 * shapes) fire at least once during (from, from + withinMs]? Used to decide
 * whether a recurring job has an occurrence coming up soon — e.g. to gate
 * an "upcoming activity" prompt. Scans just the next 2 UTC calendar days,
 * which safely covers any `withinMs` up to ~24h. */
export function cronFiresWithin(cron: string, from: Date, withinMs: number): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return false
  const cronMinute = Number(parts[0])
  const cronHour = Number(parts[1])
  const cronDowField = parts[4]
  if (!Number.isInteger(cronMinute) || !Number.isInteger(cronHour)) return false

  const dowSet = cronDowField === '*' ? null : new Set(cronDowField.split(',').map(Number))
  const fromMs = from.getTime()
  const untilMs = fromMs + withinMs

  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const candidate = new Date(Date.UTC(
      from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + dayOffset, cronHour, cronMinute, 0
    ))
    if (dowSet && !dowSet.has(candidate.getUTCDay())) continue
    if (candidate.getTime() > fromMs && candidate.getTime() <= untilMs) return true
  }
  return false
}
