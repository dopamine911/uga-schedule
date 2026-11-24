import { type LocalDate, nextDay, utcToLocal } from "@studio/domain"
import type { InferResponseType } from "hono/client"
import type { api } from "@/lib/api"
import { fmtDay } from "@/lib/format"

export const DAY_MIN = 24 * 60
export const DEFAULT_FROM = 8 * 60
export const DEFAULT_TO = 18 * 60

export type ScheduleView = InferResponseType<
  (typeof api.studios)[":id"]["schedule"]["$get"]
>
export type BusyView = ScheduleView["busy"][number]
export type DayView = ScheduleView["days"][number]

/** A span clipped to one campus day, in wall-clock minutes. */
export interface Seg {
  day: LocalDate
  start: number
  end: number
  key: string
  label: string
}

export interface BusySeg extends Seg {
  eventId?: string
  /** Event state when the viewer may see details (staff of the studio, managers, admins, own events). */
  state?: string
  turnaround: boolean
}

/** Splits an absolute span at campus midnights into day → [startMin, endMin] wall-clock minutes. */
export function splitByDay(
  start: string,
  end: string,
  tz: string
): Map<LocalDate, [number, number]> {
  const out = new Map<LocalDate, [number, number]>()
  const s = utcToLocal(start, tz)
  const e = utcToLocal(end, tz)
  for (let d = s.day; d <= e.day; d = nextDay(d)) {
    const from = d === s.day ? s.minutes : 0
    const to = d === e.day ? e.minutes : DAY_MIN
    if (to > from) out.set(d, [from, to])
  }
  return out
}

export function minutesOf(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/** Title and requester when the API returns them (staff view); otherwise a neutral "Booked". */
export function busyLabel(b: BusyView): string {
  if (!("title" in b) || !b.title) return "Booked"
  return b.requesterName ? `${b.title} (${b.requesterName})` : b.title
}

export function busyEventId(b: BusyView): string | undefined {
  return "eventId" in b ? b.eventId : undefined
}

export function busyState(b: BusyView): string | undefined {
  return "state" in b ? b.state : undefined
}

/**
 * Colour for a busy slot by the event's state, using the colour jobs in index.css:
 * blue while still waiting on sponsor or staff, teal once confirmed, green while live,
 * amber after the event. Slots whose details the viewer may not see stay solid black ("taken").
 */
export function busyToneClass(state: string | undefined): string {
  switch (state) {
    case "Submitted":
    case "SponsorApproved":
      return "border border-dashed border-info-foreground/40 bg-info text-info-foreground"
    case "Confirmed":
      return "bg-success text-success-foreground"
    case "InProgress":
      return "bg-live text-live-foreground"
    case "PostEvent":
      return "bg-warning text-warning-foreground"
    default:
      return "bg-primary text-primary-foreground"
  }
}

/** First and last day of the month containing `anchor` ("YYYY-MM-DD"); at most 31 days, the API's limit. */
export function monthRange(anchor: LocalDate): {
  first: LocalDate
  last: LocalDate
} {
  const first = `${anchor.slice(0, 8)}01`
  const year = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7))
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    first,
    last: `${anchor.slice(0, 8)}${String(lastDay).padStart(2, "0")}`,
  }
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})
export function monthLabel(anchor: LocalDate): string {
  return MONTH_LABEL.format(new Date(`${anchor.slice(0, 7)}-15T12:00:00Z`))
}

/**
 * Busy, turnaround and blackout spans, clipped to each campus day so they land in the right
 * column. `earliest`/`latest` widen the visible hours around every open, busy and blackout span.
 */
export function buildSegments(schedule: ScheduleView, tz: string) {
  const busySegs: BusySeg[] = []
  const blackoutSegs: Seg[] = []
  let earliest = DEFAULT_FROM
  let latest = DEFAULT_TO
  for (const d of schedule.days)
    for (const o of d.open) {
      earliest = Math.min(earliest, minutesOf(o.opens))
      latest = Math.max(latest, minutesOf(o.closes))
    }

  for (const b of schedule.busy) {
    const label = busyLabel(b)
    for (const [day, [start, end]] of splitByDay(b.start, b.end, tz)) {
      busySegs.push({
        day,
        start,
        end,
        key: `b-${b.start}-${day}`,
        label,
        eventId: busyEventId(b),
        state: busyState(b),
        turnaround: false,
      })
      earliest = Math.min(earliest, start)
      latest = Math.max(latest, end)
    }
    for (const [day, [start, end]] of splitByDay(b.end, b.turnaroundEnd, tz)) {
      busySegs.push({
        day,
        start,
        end,
        key: `t-${b.end}-${day}`,
        label: "Turnaround",
        turnaround: true,
      })
      latest = Math.max(latest, end)
    }
  }
  for (const bo of schedule.blackouts)
    for (const [day, [start, end]] of splitByDay(bo.start, bo.end, tz)) {
      blackoutSegs.push({
        day,
        start,
        end,
        key: `k-${bo.start}-${day}`,
        label: bo.reason || "Blackout",
      })
      earliest = Math.min(earliest, start)
      latest = Math.max(latest, end)
    }

  return { busySegs, blackoutSegs, earliest, latest }
}

/** On small screens only the anchor day is shown; otherwise every day of the week. */
export function visibleDays(
  days: DayView[],
  isMobile: boolean,
  anchor: LocalDate
): DayView[] {
  return isMobile ? days.filter((d) => d.day === anchor) : days
}

export function rangeLabel(
  isMobile: boolean,
  anchor: LocalDate,
  weekStart: LocalDate,
  weekEnd: LocalDate
): string {
  return isMobile ? fmtDay(anchor) : `${fmtDay(weekStart)} – ${fmtDay(weekEnd)}`
}
