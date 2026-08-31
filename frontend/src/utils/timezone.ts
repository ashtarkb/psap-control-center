// Timezone-aware scheduling helpers — converts a "wall clock" time the user
// picks in an arbitrary IANA zone into the UTC instant / UTC cron fields
// Fournos actually stores (spec.scheduledStartTime / spec.schedule are
// always UTC — see fournos/manifests/crd.yaml). No date library dependency;
// uses the standard two-pass Intl.DateTimeFormat trick so it stays correct
// across DST transitions.

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Converts a wall-clock date+time as observed in `tz` into a real UTC Date.
 * Standard two-pass Intl.DateTimeFormat technique: guess the instant by
 * treating the wall time as if it were already UTC, check what that guess
 * actually reads as in `tz`, then correct by the difference.
 */
export function zonedWallTimeToUtcDate(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0)

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(guessUtcMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const readHour = Number(parts.hour) % 24 // Intl can render midnight as "24"
  const asIfWallWasUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    readHour,
    Number(parts.minute),
    Number(parts.second)
  )
  const offsetMs = asIfWallWasUtcMs - guessUtcMs
  return new Date(guessUtcMs - offsetMs)
}

/** `datetime-local` input value ("YYYY-MM-DDTHH:mm") + IANA tz -> UTC ISO string ("...Z"). */
export function datetimeLocalToUtcIso(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const utc = zonedWallTimeToUtcDate(Number(y), Number(mo), Number(d), Number(h), Number(mi), tz)
  return utc.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Best-effort inverse of datetimeLocalToUtcIso, for prefilling a form from an existing UTC ISO value. */
export function isoToLocalParts(iso: string, tz: string): { date: string; time: string } {
  const d = new Date(iso)
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(d)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/**
 * Builds a UTC 5-field cron expression ("min hour * * dow") for a job that
 * should run at `time` (HH:mm) on the given local `weekdays` (0=Sun..6=Sat)
 * in `tz`. `weekdays` empty means "every day". Each selected local weekday
 * is converted independently (its UTC hour/minute/weekday derived from an
 * anchor date in the near future), then merged into one cron line — safe
 * because the UTC hour/minute is the same for every occurrence of a given
 * local weekday (DST-transition weeks are a rare, acceptable edge case).
 */
export function buildUtcCron(time: string, weekdays: number[], tz: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time)
  const [hh, mm] = m ? [Number(m[1]), Number(m[2])] : [0, 0]

  if (weekdays.length === 0) {
    // Daily: anchor on "today" in the given tz is enough; UTC hour/minute
    // is stable regardless of which day we pick.
    const now = new Date()
    const utc = zonedWallTimeToUtcDate(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      now.getUTCDate(),
      hh,
      mm,
      tz
    )
    return `${utc.getUTCMinutes()} ${utc.getUTCHours()} * * *`
  }

  const shortWeekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
  const SHORT_TO_DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

  const utcSlots = weekdays.map((localDow) => {
    // Find the next date (0-6 days out) that falls on localDow in `tz`.
    const base = new Date()
    for (let offset = 0; offset < 7; offset++) {
      const candidate = new Date(base.getTime() + offset * 86400000)
      const wallDow = SHORT_TO_DOW[shortWeekdayFmt.format(candidate)]
      if (wallDow === localDow) {
        // Re-derive this candidate's calendar date *as observed in tz*
        // (not UTC's) before combining with the desired wall-clock time.
        const { date } = isoToLocalParts(candidate.toISOString(), tz)
        const [y, mo, d] = date.split('-').map(Number)
        const utc = zonedWallTimeToUtcDate(y, mo, d, hh, mm, tz)
        return { minute: utc.getUTCMinutes(), hour: utc.getUTCHours(), dow: utc.getUTCDay() }
      }
    }
    return { minute: mm, hour: hh, dow: localDow }
  })

  // All slots share the same local time-of-day, so minute/hour should be
  // identical across them (only the resulting UTC weekday can shift near
  // midnight) — use the first for min/hour and collect the distinct dows.
  const { minute, hour } = utcSlots[0]
  const dows = Array.from(new Set(utcSlots.map((s) => s.dow))).sort((a, b) => a - b)
  return `${minute} ${hour} * * ${dows.join(',')}`
}

