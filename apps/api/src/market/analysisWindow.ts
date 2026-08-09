export type WallClockHm = { hour: number; minute: number }

export type AnalysisWindowOptions = {
  timeZone: string
  start: WallClockHm
  end: WallClockHm
}

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function minutesOfDay(hm: WallClockHm): number {
  return hm.hour * 60 + hm.minute
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const parts = dtf.formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value
    return value == null ? 0 : Number(value)
  }
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  }
}

/**
 * Convert a wall-clock local time in `timeZone` to a UTC epoch ms.
 * Iteratively corrects for the zone offset (works with DST).
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 4; i++) {
    const parts = zonedParts(guess, timeZone)
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0)
    const delta = wanted - asUtc
    if (delta === 0) break
    guess += delta
  }
  return guess
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays))
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  }
}

/** True when `ms` falls in [start, end) in the given zone (overnight wrap OK). */
export function isWithinAnalysisWindow(
  ms: number,
  options: AnalysisWindowOptions,
): boolean {
  const parts = zonedParts(ms, options.timeZone)
  const nowMin = parts.hour * 60 + parts.minute
  const startMin = minutesOfDay(options.start)
  const endMin = minutesOfDay(options.end)

  if (startMin === endMin) {
    // Degenerate full-day window.
    return true
  }

  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin
  }

  // Overnight: e.g. 17:00 → 01:00
  return nowMin >= startMin || nowMin < endMin
}

/**
 * Next window-open instant at-or-after `ms`.
 * If `ms` is already inside the window, returns the current window's start
 * only when `ms` equals that start; otherwise still returns the open of the
 * *current* session for overnight (used only when outside via clamp).
 *
 * When outside, returns the upcoming `start` wall-clock in `timeZone`.
 */
export function nextAnalysisWindowOpen(
  ms: number,
  options: AnalysisWindowOptions,
): number {
  const parts = zonedParts(ms, options.timeZone)
  const nowMin = parts.hour * 60 + parts.minute
  const startMin = minutesOfDay(options.start)
  const endMin = minutesOfDay(options.end)

  if (startMin === endMin) {
    return ms
  }

  const startToday = zonedTimeToUtc(
    parts.year,
    parts.month,
    parts.day,
    options.start.hour,
    options.start.minute,
    options.timeZone,
  )

  if (startMin < endMin) {
    // Same-day window: before start → today start; at/after end → tomorrow start.
    if (nowMin < startMin) return startToday
    const tomorrow = addCalendarDays(parts.year, parts.month, parts.day, 1)
    return zonedTimeToUtc(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      options.start.hour,
      options.start.minute,
      options.timeZone,
    )
  }

  // Overnight: outside is [end, start) on the same calendar day.
  if (nowMin < startMin && nowMin >= endMin) {
    return startToday
  }

  // Inside the overnight window after midnight → next open is today's start
  // only if somehow called while inside before start... we're past midnight
  // so "today's start" is later today. If inside evening (nowMin >= start),
  // next open after this session is tomorrow's start.
  if (nowMin >= startMin) {
    const tomorrow = addCalendarDays(parts.year, parts.month, parts.day, 1)
    return zonedTimeToUtc(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      options.start.hour,
      options.start.minute,
      options.timeZone,
    )
  }

  // Inside overnight window before end (after midnight, before end):
  // next open is later today at start.
  return startToday
}

/** Keep `atMs` if inside the window; otherwise bump to the next window open. */
export function clampToAnalysisWindow(
  atMs: number,
  options: AnalysisWindowOptions,
): number {
  if (isWithinAnalysisWindow(atMs, options)) return atMs
  return nextAnalysisWindowOpen(atMs, options)
}
