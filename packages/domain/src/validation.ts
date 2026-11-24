import { type GrantLike, firstUncoveredDay } from "./levels.ts"
import {
  type Interval,
  type LocalDate,
  type LocalTime,
  hoursBetween,
  isLocalDate,
  isLocalTime,
  isoWeekKey,
  localToUtc,
  minutesOf,
  nextDay,
  overlaps,
  weekdayOf,
} from "./time.ts"
import type { SoftPolicyCode } from "./enums.ts"

// F-006 §5 submission checks. Pure: the caller loads everything into the context.

export type IssueCode =
  | "HOLD_ACTIVE"
  | "NO_DAYS"
  | "DAY_INVALID"
  | "DAYS_NOT_CONSECUTIVE"
  | "TYPE_INACTIVE"
  | "TYPE_STUDIO_NOT_ALLOWED"
  | "TYPE_MAX_DAYS"
  | "TYPE_MAX_HOURS"
  | "STUDIO_INACTIVE"
  | "SLOT_GRANULARITY"
  | "OUTSIDE_HOURS"
  | "BLACKOUT"
  | "STUDIO_CONFLICT"
  | "DECISION_CUTOFF"
  | "IN_PAST"
  | "LEVEL_STUDIO"
  | "LEVEL_EQUIPMENT"
  | "EQUIPMENT_INACTIVE"
  | "EQUIPMENT_SHORTAGE"
  | "SPONSOR_REQUIRED"
  | "SPONSOR_INVALID"
  | "SPONSOR_SELF"
  | SoftPolicyCode

export interface Issue {
  code: IssueCode
  /** hard = cannot be overridden; soft = may be submitted with justification and approved by staff (BR-006-06). */
  severity: "hard" | "soft"
  message: string
}

export interface DayInput {
  day: LocalDate
  startTime: LocalTime
  endTime: LocalTime
}

export interface OpeningHoursLike {
  weekday: number
  opens: LocalTime
  closes: LocalTime
}

export interface PolicyValues {
  leadTimeHours: number
  advanceDays: number
  weeklyHours: number
  openCap: number
  decisionCutoffHours: number
}

export interface EquipmentLineInput {
  equipmentTypeId: string
  qty: number
  typeName: string
  typeActive: boolean
  classMinLevelRank: number
  classMinLevelName: string
  maxPerEvent: number | null
  /** Units bookable for this event's window after other reservations (computed by caller). */
  availableQty: number
}

export interface SubmissionContext {
  now: string
  tz: string
  requesterId: string
  requesterHasActiveHold: boolean
  sponsor: { id: string; active: boolean; isSponsor: boolean } | null
  eventType: {
    active: boolean
    maxDays: number
    maxHoursPerDay: number
    allowedStudioIds: readonly string[]
  }
  studio: {
    id: string
    active: boolean
    minLevelRank: number
    minLevelName: string
    turnaroundMinutes: number
    slotGranularityMinutes: number
    openingHours: readonly OpeningHoursLike[]
    blackouts: readonly Interval[]
  }
  /** Other events' day intervals holding this studio (exclude the event under test). */
  studioBusy: readonly Interval[]
  days: readonly DayInput[]
  grants: readonly GrantLike[]
  lines: readonly EquipmentLineInput[]
  policy: PolicyValues
  /** Requester's already-booked hours per ISO week key, excluding this event. */
  requesterWeeklyHours: Readonly<Record<string, number>>
  /** Requester's events in Submitted/SponsorApproved/Confirmed, excluding this event. */
  requesterOpenEvents: number
}

export interface DayInterval extends DayInput, Interval {}

/** Validates day shapes and converts to UTC intervals. Returns issues for malformed days. */
export function toIntervals(
  days: readonly DayInput[],
  tz: string
): { intervals: DayInterval[]; issues: Issue[] } {
  const issues: Issue[] = []
  const intervals: DayInterval[] = []
  for (const d of days) {
    if (
      !isLocalDate(d.day) ||
      !isLocalTime(d.startTime) ||
      !isLocalTime(d.endTime)
    ) {
      issues.push({
        code: "DAY_INVALID",
        severity: "hard",
        message: `Invalid date or time on ${d.day}.`,
      })
      continue
    }
    if (minutesOf(d.endTime) <= minutesOf(d.startTime)) {
      issues.push({
        code: "DAY_INVALID",
        severity: "hard",
        message: `${d.day}: end must be after start.`,
      })
      continue
    }
    intervals.push({
      ...d,
      start: localToUtc(d.day, d.startTime, tz),
      end: localToUtc(d.day, d.endTime, tz),
    })
  }
  intervals.sort((a, b) => a.day.localeCompare(b.day))
  return { intervals, issues }
}

export function validateSubmission(ctx: SubmissionContext): Issue[] {
  const issues: Issue[] = []
  const hard = (code: IssueCode, message: string) =>
    issues.push({ code, severity: "hard", message })
  const soft = (code: IssueCode, message: string) =>
    issues.push({ code, severity: "soft", message })

  if (ctx.requesterHasActiveHold)
    hard(
      "HOLD_ACTIVE",
      "You have an active hold on your account. Contact the equipment office."
    )

  // Days
  if (ctx.days.length === 0) {
    hard("NO_DAYS", "Add at least one day.")
    return issues
  }
  const { intervals, issues: dayIssues } = toIntervals(ctx.days, ctx.tz)
  issues.push(...dayIssues)
  if (dayIssues.length) return issues

  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i]!.day !== nextDay(intervals[i - 1]!.day)) {
      hard("DAYS_NOT_CONSECUTIVE", "Days must be consecutive.")
      break
    }
  }

  const first = intervals[0]!
  if (Date.parse(first.start) <= Date.parse(ctx.now))
    hard("IN_PAST", "The event cannot start in the past.")

  // Event type limits
  const t = ctx.eventType
  if (!t.active)
    hard("TYPE_INACTIVE", "This event type is no longer available.")
  if (!t.allowedStudioIds.includes(ctx.studio.id))
    hard(
      "TYPE_STUDIO_NOT_ALLOWED",
      "This event type cannot use the selected studio."
    )
  if (intervals.length > t.maxDays)
    hard("TYPE_MAX_DAYS", `This event type allows at most ${t.maxDays} day(s).`)
  for (const d of intervals) {
    if (hoursBetween(d.start, d.end) > t.maxHoursPerDay)
      hard(
        "TYPE_MAX_HOURS",
        `${d.day}: at most ${t.maxHoursPerDay} hours per day for this event type.`
      )
  }

  // Policies (soft, BR-006-06)
  const hoursUntilStart = hoursBetween(ctx.now, first.start)
  const p = ctx.policy
  if (hoursUntilStart < p.decisionCutoffHours)
    hard(
      "DECISION_CUTOFF",
      `Requests must be made at least ${p.decisionCutoffHours} hours before the event so they can be approved.`
    )
  else if (hoursUntilStart < p.leadTimeHours)
    soft(
      "LEAD_TIME",
      `Requests should be made at least ${p.leadTimeHours} hours ahead.`
    )
  if (hoursUntilStart > p.advanceDays * 24)
    soft("ADVANCE", `Events can be booked at most ${p.advanceDays} days ahead.`)
  const weekly: Record<string, number> = { ...ctx.requesterWeeklyHours }
  for (const d of intervals) {
    const k = isoWeekKey(d.day)
    weekly[k] = (weekly[k] ?? 0) + hoursBetween(d.start, d.end)
  }
  for (const [week, hours] of Object.entries(weekly)) {
    if (
      hours > p.weeklyHours &&
      intervals.some((d) => isoWeekKey(d.day) === week)
    )
      soft(
        "WEEKLY_HOURS",
        `Week ${week}: ${hours.toFixed(1)} h booked, limit is ${p.weeklyHours} h.`
      )
  }
  if (ctx.requesterOpenEvents + 1 > p.openCap)
    soft("OPEN_CAP", `You may have at most ${p.openCap} open requests.`)

  // Studio
  const s = ctx.studio
  if (!s.active)
    hard("STUDIO_INACTIVE", "This studio is not accepting bookings.")
  for (const d of intervals) {
    const startM = minutesOf(d.startTime)
    const endM = minutesOf(d.endTime)
    if (startM % s.slotGranularityMinutes || endM % s.slotGranularityMinutes)
      hard(
        "SLOT_GRANULARITY",
        `${d.day}: times must be on ${s.slotGranularityMinutes}-minute boundaries.`
      )
    const wd = weekdayOf(d.day)
    const fits = s.openingHours.some(
      (h) =>
        h.weekday === wd &&
        minutesOf(h.opens) <= startM &&
        endM <= minutesOf(h.closes)
    )
    if (!fits)
      hard("OUTSIDE_HOURS", `${d.day}: outside the studio's opening hours.`)
    if (s.blackouts.some((b) => overlaps(b, d)))
      hard("BLACKOUT", `${d.day}: the studio is closed.`)
    if (ctx.studioBusy.some((b) => overlaps(b, d, s.turnaroundMinutes)))
      hard(
        "STUDIO_CONFLICT",
        `${d.day}: the studio is already booked (including ${s.turnaroundMinutes} min turnaround).`
      )
  }

  // Levels (F-002)
  const dayList = intervals.map((d) => d.day)
  const studioGap = firstUncoveredDay(ctx.grants, dayList, s.minLevelRank)
  if (studioGap)
    hard(
      "LEVEL_STUDIO",
      `${s.minLevelName} is required for this studio; you are not covered on ${studioGap}.`
    )

  // Equipment
  for (const l of ctx.lines) {
    if (l.qty <= 0) continue
    if (!l.typeActive)
      hard("EQUIPMENT_INACTIVE", `${l.typeName} is no longer bookable.`)
    const gap = firstUncoveredDay(ctx.grants, dayList, l.classMinLevelRank)
    if (gap)
      hard(
        "LEVEL_EQUIPMENT",
        `${l.typeName} requires ${l.classMinLevelName}; you are not covered on ${gap}.`
      )
    if (l.qty > l.availableQty)
      hard(
        "EQUIPMENT_SHORTAGE",
        `${l.typeName}: ${l.qty} requested, ${Math.max(0, l.availableQty)} available.`
      )
    if (l.maxPerEvent !== null && l.qty > l.maxPerEvent)
      soft(
        "MAX_PER_EVENT",
        `${l.typeName}: at most ${l.maxPerEvent} per event.`
      )
  }

  // Sponsor
  if (!ctx.sponsor) hard("SPONSOR_REQUIRED", "Choose a sponsor.")
  else if (ctx.sponsor.id === ctx.requesterId)
    hard("SPONSOR_SELF", "You cannot sponsor your own event.")
  else if (!ctx.sponsor.active || !ctx.sponsor.isSponsor)
    hard("SPONSOR_INVALID", "The chosen sponsor cannot approve events.")

  return issues
}

export function softCodes(issues: readonly Issue[]): SoftPolicyCode[] {
  return [
    ...new Set(
      issues
        .filter((i) => i.severity === "soft")
        .map((i) => i.code as SoftPolicyCode)
    ),
  ]
}

export function hasHard(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === "hard")
}
