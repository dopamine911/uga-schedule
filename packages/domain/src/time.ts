import { TZDate } from "@date-fns/tz"
import { addDays, getISOWeek, getISOWeekYear } from "date-fns"

/** "YYYY-MM-DD" calendar date in the campus time zone. */
export type LocalDate = string
/** "HH:MM" 24h wall-clock time in the campus time zone. */
export type LocalTime = string

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isLocalDate(s: string): boolean {
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}
export function isLocalTime(s: string): boolean {
  return TIME_RE.test(s)
}

export function minutesOf(time: LocalTime): number {
  const [h, m] = time.split(":").map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function timeOf(minutes: number): LocalTime {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** Campus wall-clock date+time → UTC ISO instant. DST-aware. */
export function localToUtc(
  day: LocalDate,
  time: LocalTime,
  tz: string
): string {
  const [y, mo, d] = day.split("-").map(Number)
  const [h, mi] = time.split(":").map(Number)
  const zoned = new TZDate(y!, mo! - 1, d!, h!, mi!, tz)
  return new Date(zoned.getTime()).toISOString()
}

export interface LocalParts {
  day: LocalDate
  time: LocalTime
  /** 0 = Monday … 6 = Sunday (F-004 OPENING_HOURS.weekday). */
  weekday: number
  minutes: number
}

/** UTC ISO instant → campus wall-clock parts. */
export function utcToLocal(iso: string, tz: string): LocalParts {
  const z = new TZDate(new Date(iso).getTime(), tz)
  const day = `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`
  const minutes = z.getHours() * 60 + z.getMinutes()
  return { day, time: timeOf(minutes), weekday: (z.getDay() + 6) % 7, minutes }
}

/** Weekday (0 = Monday) of a calendar date. Independent of time zone. */
export function weekdayOf(day: LocalDate): number {
  const d = new Date(`${day}T12:00:00Z`)
  return (d.getUTCDay() + 6) % 7
}

export function nextDay(day: LocalDate): LocalDate {
  return addDays(new Date(`${day}T12:00:00Z`), 1)
    .toISOString()
    .slice(0, 10)
}

/** ISO week key such as "2027-W14", used for the WEEKLY_HOURS policy. */
export function isoWeekKey(day: LocalDate): string {
  const d = new Date(`${day}T12:00:00`)
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`
}

export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString()
}

export function hoursBetween(startIso: string, endIso: string): number {
  return (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000
}

export interface Interval {
  start: string
  end: string
}

/** Half-open overlap test; `bufferMinutes` is appended to the end of `b` and `a` (turnaround). */
export function overlaps(a: Interval, b: Interval, bufferMinutes = 0): boolean {
  const pad = bufferMinutes * 60_000
  return (
    Date.parse(a.start) < Date.parse(b.end) + pad &&
    Date.parse(b.start) < Date.parse(a.end) + pad
  )
}
