import { minutesOf, timeOf } from "@studio/domain"
import { fmtTime } from "@/lib/format"

// Slot and timeline math for DayTimePicker. Pure: no React, no queries. Minutes are campus-local
// minutes from midnight.

export interface Span {
  start: number
  end: number
}

export interface BusySpan extends Span {
  /** End of the studio's turnaround buffer after this booking. */
  turnaroundEnd: number
  title?: string
}

/** What a studio allows on one day; `DayAvailability` from the picker satisfies this. */
export interface AvailabilityInput {
  open: Span[]
  busy: BusySpan[]
  blackouts: Span[]
}

/** Everything the slot checks need, resolved once per render. */
export interface DayRules {
  /** False until a studio and date are chosen (times can be picked first). */
  known: boolean
  /** Known, but the studio is closed this day. */
  closed: boolean
  open: Span[]
  busy: BusySpan[]
  blackouts: Span[]
  step: number
  turnaround: number
  maxHours: number
  dayMin: number
  dayMax: number
}

/** 6 AM–11 PM, used before the studio's real hours are known. */
export const GENERIC_OPEN: Span[] = [{ start: 6 * 60, end: 23 * 60 }]

const DURATION_CHOICES = [60, 120, 180, 240, 360, 480]

export function dayRules(
  input: AvailabilityInput | undefined,
  step: number,
  turnaround: number,
  maxHours: number
): DayRules {
  const known = input !== undefined
  const open = input?.open ?? GENERIC_OPEN
  return {
    known,
    closed: known && open.length === 0,
    open,
    busy: input?.busy ?? [],
    blackouts: input?.blackouts ?? [],
    step,
    turnaround,
    maxHours,
    dayMin: open.length ? Math.min(...open.map((o) => o.start)) : 8 * 60,
    dayMax: open.length ? Math.max(...open.map((o) => o.end)) : 22 * 60,
  }
}

/** Length choices that fit within the studio's maximum booking. */
export function durationOptions(maxHours: number): number[] {
  return DURATION_CHOICES.filter((d) => d <= maxHours * 60)
}

/** Length to keep or suggest: the current one, else 2 h. */
export function slotLength(duration: number | null): number {
  return duration && duration > 0 ? duration : 120
}

/** The opening window containing minute `t`, if any. */
export function windowOf(rules: DayRules, t: number): Span | undefined {
  return rules.open.find((o) => o.start <= t && t < o.end)
}

/** True when [a, b) overlaps a booking (with our turnaround) or a blackout. */
export function isBlocked(rules: DayRules, a: number, b: number): boolean {
  return (
    rules.busy.some(
      (x) => a < x.turnaroundEnd && x.start < b + rules.turnaround
    ) || rules.blackouts.some((x) => a < x.end && x.start < b)
  )
}

/** Why a start slot can't be chosen, or null when it is free. */
export function startReason(rules: DayRules, time: string): string | null {
  const t = minutesOf(time)
  const w = windowOf(rules, t)
  if (!w || t + rules.step > w.end) return "closed"
  if (rules.blackouts.some((x) => t < x.end && x.start < t + rules.step))
    return "closed"
  if (
    rules.busy.some(
      (x) => t < x.turnaroundEnd && x.start < t + rules.step + rules.turnaround
    )
  )
    return "booked"
  return null
}

/** Latest end for a start: window close, next booking minus our turnaround, max hours. */
export function latestEnd(rules: DayRules, s: number): number {
  const w = windowOf(rules, s)
  if (!w) return s
  let limit = Math.min(w.end, s + rules.maxHours * 60)
  for (const x of rules.busy)
    if (x.start >= s) limit = Math.min(limit, x.start - rules.turnaround)
  for (const x of rules.blackouts)
    if (x.start >= s) limit = Math.min(limit, x.start)
  return limit
}

/** Why an end time can't be chosen for the current start, or null when it is valid. */
export function endReason(
  rules: DayRules,
  start: number | null,
  time: string
): string | null {
  const t = minutesOf(time)
  if (start === null || t <= start) return "before start"
  if (t > latestEnd(rules, start))
    return t - start > rules.maxHours * 60
      ? `over ${rules.maxHours} h`
      : "unavailable"
  return null
}

/** Whether the chosen span overlaps something the studio won't allow. */
export function conflictOf(
  rules: DayRules,
  start: number | null,
  end: number | null
): boolean {
  return (
    start !== null &&
    end !== null &&
    end > start &&
    isBlocked(rules, start, end)
  )
}

/** The chosen span as a timeline selection; null until it is a real span. */
export function selectionOf(
  start: number | null,
  end: number | null
): Span | null {
  return start !== null && end !== null && end > start ? { start, end } : null
}

/**
 * Start-time change: keeps the chosen length when it still fits, otherwise trims to the latest
 * valid end.
 */
export function pickStart(
  rules: DayRules,
  s: string,
  duration: number | null
): { startTime: string; endTime: string } {
  const sm = minutesOf(s)
  const e = Math.min(sm + slotLength(duration), latestEnd(rules, sm))
  return { startTime: s, endTime: timeOf(e > sm ? e : sm + rules.step) }
}

/** Timeline click: the start slot under the clicked minute, or null when that slot is not free. */
export function slotAt(rules: DayRules, minute: number): string | null {
  const t = Math.floor(minute / rules.step) * rules.step
  return startReason(rules, timeOf(t)) === null ? timeOf(t) : null
}

/**
 * First free slot that fits the current length (or 2 h), searching forward from the current start,
 * then the whole day.
 */
export function suggestSlot(
  rules: DayRules,
  start: number | null,
  duration: number | null
): Span | null {
  const want = slotLength(duration)
  const fits = (t: number) =>
    startReason(rules, timeOf(t)) === null && t + want <= latestEnd(rules, t)
  for (const from of [start ?? rules.dayMin, rules.dayMin])
    for (let t = from; t + want <= rules.dayMax; t += rules.step)
      if (fits(t)) return { start: t, end: t + want }
  return null
}

/** Header text: what the studio is open for on this day. */
export function openHoursText(rules: DayRules): string {
  if (!rules.known) return "Pick a studio and date to see free and booked times"
  if (rules.closed) return "Studio closed this day"
  return rules.open
    .map((o) => `Open ${fmtTime(timeOf(o.start))}–${fmtTime(timeOf(o.end))}`)
    .join(", ")
}

/** Width of the timeline in minutes (at least an hour). */
function timelineSpan(min: number, max: number): number {
  return Math.max(60, max - min)
}

/** Left offset of minute `m` on the timeline, as a CSS percentage. */
export function barLeft(m: number, min: number, max: number): string {
  return `${((m - min) / timelineSpan(min, max)) * 100}%`
}

/** Left and width of a span on the timeline, clipped to the visible range. */
export function barPosition(s: Span, min: number, max: number) {
  const lo = Math.max(s.start, min)
  const hi = Math.min(s.end, max)
  return {
    left: barLeft(lo, min, max),
    width: `${((hi - lo) / timelineSpan(min, max)) * 100}%`,
  }
}

/** Whole-hour tick marks across the timeline (every 2 h on wide ranges). */
export function hourTicks(min: number, max: number): number[] {
  const step = timelineSpan(min, max) > 600 ? 120 : 60
  const hours: number[] = []
  for (let h = Math.ceil(min / 60) * 60; h <= max; h += step) hours.push(h)
  return hours
}
