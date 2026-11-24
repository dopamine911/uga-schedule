// Display helpers. All dates/times render in the campus time zone (BR-010-04).

// Formatters are built once: constructing an Intl formatter loads locale data, and these run per table cell.
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})
const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" })
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" })

const noonUtc = (day: string) => new Date(`${day}T12:00:00Z`)

/** "Tue, Apr 6, 2027" for a "YYYY-MM-DD" calendar date (time-zone independent). */
export function fmtDay(day: string): string {
  return DAY_FORMAT.format(noonUtc(day))
}

/** "Mon" for a "YYYY-MM-DD" calendar date. */
export function fmtWeekday(day: string): string {
  return WEEKDAY_FORMAT.format(noonUtc(day))
}

/** "Apr" for a "YYYY-MM-DD" calendar date. */
export function fmtMonth(day: string): string {
  return MONTH_FORMAT.format(noonUtc(day))
}

/** "2:00 PM" for an "HH:MM" wall-clock time. */
export function fmtTime(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number)
  return TIME_FORMAT.format(new Date(Date.UTC(2000, 0, 1, h, m)))
}

/** "Apr 6, 2:00 PM CDT" for a UTC ISO instant, shown in the campus zone. */
export function fmtInstant(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(iso))
}

/** Event days summary: "Tue, Apr 6, 2027 · 2:00 PM–4:00 PM" or "Apr 10 – Apr 12 (3 days)". */
export function fmtDays(days: readonly { day: string; startTime: string; endTime: string }[]): string {
  if (days.length === 0) return "No days"
  const first = days[0]!
  if (days.length === 1) return `${fmtDay(first.day)} · ${fmtTime(first.startTime)}–${fmtTime(first.endTime)}`
  const last = days[days.length - 1]!
  return `${fmtDay(first.day)} – ${fmtDay(last.day)} (${days.length} days)`
}

/** "in 3 days" / "2 hours ago". */
export function fmtRelative(iso: string, nowMs = Date.now()): string {
  const diff = Date.parse(iso) - nowMs
  const rtf = RELATIVE_FORMAT
  const abs = Math.abs(diff)
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute")
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour")
  return rtf.format(Math.round(diff / 86_400_000), "day")
}

/** Human label for an enum-ish code: "SPONSOR_APPROVED" / "SponsorApproved" → "Sponsor approved". */
export function humanize(code: string): string {
  const s = code
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Titles that are not part of a person's name. */
const HONORIFIC = /^(?:(?:Prof|Dr|Mrs|Mr|Ms)\.?\s+)+/i

/** "Prof. Priya Patel" → "PP". */
export function initials(name: string): string {
  const parts = name.replace(HONORIFIC, "").split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase()
}

/** "Prof. Priya Patel" → "Priya" (honorifics are skipped). */
export function firstName(name: string): string {
  return name.trim().replace(HONORIFIC, "").split(/\s+/)[0] || name
}

/** "2:00 PM" for a UTC ISO instant, shown in the campus zone. */
export function fmtClock(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso))
}

/** "Mon 23" for a "YYYY-MM-DD" calendar date (compact column header). */
export function fmtDayShort(day: string): string {
  return `${fmtWeekday(day)} ${Number(day.slice(8, 10))}`
}
