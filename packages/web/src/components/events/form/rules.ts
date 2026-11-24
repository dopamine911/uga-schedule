import { isLocalDate, localToUtc, minutesOf, weekdayOf } from "@studio/domain"
import type { InferResponseType } from "hono/client"
import {
  addDays,
  type DraftForm,
  daysOf,
  isScheduleComplete,
  linesOf,
  withNumDays,
} from "@/components/events/draft"
import type { EventDetail } from "@/components/events/shared"
import type { api } from "@/lib/api"
import { humanize } from "@/lib/format"

// Pure rules of the request form (F-006 §1-6): what can be picked, what is flagged, and why submit is blocked.

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export type CheckJson = Parameters<typeof api.events.check.$post>[0]["json"]
export type EventTypeRow = InferResponseType<
  (typeof api)["event-types"]["$get"]
>[number]
export type StudioRow = InferResponseType<typeof api.studios.$get>[number]
export type Hold = InferResponseType<(typeof api.holds)["$get"]>[number]
export type SaveMode = "save" | "submit"

/** The notice policies the date rules read. */
export interface NoticePolicy {
  DECISION_CUTOFF_HOURS: number
  LEAD_TIME_HOURS: number
  ADVANCE_DAYS: number
}

/** What submit depends on besides the form itself. */
export interface SubmitState {
  form: DraftForm
  /** The live check has a complete payload. */
  ready: boolean
  checking: boolean
  hard: boolean
  soft: boolean
  hasHold: boolean
  justification: string
}

/** A request that is already past draft: its edit rules apply. */
export function isInProgressOf(detail: EventDetail | undefined): boolean {
  return detail !== undefined && detail.state !== "Draft"
}

export function headerDescriptionOf(detail: EventDetail | undefined): string {
  if (detail && detail.state !== "Draft")
    return `This request is ${humanize(detail.state)}.`
  return "Pick a studio, the days and equipment. Checks run as you go."
}

/** Holds and notice rules apply to the requester's own request; staff editing someone else's keep the full range. */
export function isOwnRequest(
  detail: EventDetail | undefined,
  userId: string
): boolean {
  return detail ? detail.requester.id === userId : true
}

export function maxDaysOf(type: EventTypeRow | undefined): number {
  return type?.maxDays ?? 31
}

export function granularityOf(studio: StudioRow | undefined): number {
  return studio?.slotGranularityMinutes ?? 15
}

export function turnaroundOf(studio: StudioRow | undefined): number {
  return studio?.turnaroundMinutes ?? 0
}

export function maxHoursOf(type: EventTypeRow | undefined): number {
  return type?.maxHoursPerDay ?? 24
}

/** Hard rule (decision cutoff): a day whose last start falls inside the cutoff cannot be submitted, so it is greyed out. */
export function isDayDisabled(
  day: string,
  studio: StudioRow | undefined,
  notice: NoticePolicy | undefined,
  nowMs: number,
  tz: string
): boolean {
  const closed =
    studio !== undefined &&
    !studio.openingHours.some((h) => h.weekday === weekdayOf(day))
  const tooLate =
    notice !== undefined &&
    Date.parse(localToUtc(day, "23:59", tz)) <
      nowMs + notice.DECISION_CUTOFF_HOURS * HOUR_MS
  return closed || tooLate
}

/** Soft rules (lead time, advance window): the day stays selectable but is marked; submitting needs a justification. */
export function isOutsideNotice(
  day: string,
  notice: NoticePolicy | undefined,
  nowMs: number,
  tz: string
): boolean {
  if (notice === undefined) return false
  const lastStart = Date.parse(localToUtc(day, "23:59", tz))
  const firstStart = Date.parse(localToUtc(day, "00:00", tz))
  return (
    lastStart < nowMs + notice.LEAD_TIME_HOURS * HOUR_MS ||
    firstStart > nowMs + notice.ADVANCE_DAYS * DAY_MS
  )
}

export function flaggedHintOf(
  notice: NoticePolicy | undefined
): string | undefined {
  return notice
    ? `Marked days fall outside the ${notice.LEAD_TIME_HOURS}-hour lead time or the ${notice.ADVANCE_DAYS}-day booking window and need a justification.`
    : undefined
}

export function dayCountHintOf(
  type: { name: string } | undefined,
  maxDays: number
): string {
  return type
    ? `${type.name} allows up to ${maxDays} consecutive ${maxDays === 1 ? "day" : "days"}.`
    : "Consecutive days."
}

/** Calendar date of the i-th day, or undefined before a first day is chosen. */
export function dayAt(form: DraftForm, i: number): string | undefined {
  return isLocalDate(form.firstDay) ? addDays(form.firstDay, i) : undefined
}

/** Body of the live check (F-006 §5), or null until type, studio and schedule are chosen. */
export function checkPayloadOf(
  form: DraftForm,
  currentId: string | undefined
): CheckJson | null {
  return form.eventTypeId && form.studioId && isScheduleComplete(form)
    ? {
        eventTypeId: form.eventTypeId,
        studioId: form.studioId,
        sponsorId: form.sponsorId || null,
        days: daysOf(form),
        lines: linesOf(form),
        excludeEventId: currentId,
      }
    : null
}

/** Form after a type change: drop a studio the type doesn't allow; keep the day count within the type limit. */
export function formAfterTypeChange(
  form: DraftForm,
  types: EventTypeRow[] | undefined,
  eventTypeId: string
): DraftForm {
  const next = types?.find((t) => t.id === eventTypeId)
  const allowed = next?.allowedStudios.some((s) => s.id === form.studioId)
  const limit = maxDaysOf(next)
  return {
    ...withNumDays(form, Math.min(form.times.length, limit)),
    eventTypeId,
    studioId: allowed ? form.studioId : "",
  }
}

/** Why an event type cannot be chosen: every studio it allows needs a level the requester does not have. */
export function lockReasonOf(
  type: { allowedStudios: { id: string }[] },
  studios:
    | {
        id: string
        eligibleToday: boolean
        minLevel: { name: string; rank: number }
      }[]
    | undefined
): string | null {
  const rules = type.allowedStudios.map((s) =>
    studios?.find((x) => x.id === s.id)
  )
  const known = rules.filter((r) => r !== undefined)
  if (known.length === 0 || known.length < rules.length) return null
  if (known.some((r) => r.eligibleToday)) return null
  const lowest = known.reduce((a, b) =>
    b.minLevel.rank < a.minLevel.rank ? b : a
  )
  return `Needs ${lowest.minLevel.name}`
}

/** A studio whose minimum level the requester does not hold today. */
export function isStudioLocked(rule: StudioRow | undefined): boolean {
  return rule !== undefined && !rule.eligibleToday
}

/** Level note shown after a studio's name in the list, once its rule is known. */
export function studioRuleSuffix(
  rule: StudioRow | undefined
): string | undefined {
  return (
    rule &&
    (isStudioLocked(rule)
      ? ` · Requires ${rule.minLevel.name}`
      : ` · min level ${rule.minLevel.name}`)
  )
}

/** Plain-language schedule problems the API would otherwise only report on submit. */
export function scheduleProblemsOf(
  form: DraftForm,
  granularity: number
): string[] {
  const out: string[] = []
  form.times.forEach((t, i) => {
    if (minutesOf(t.endTime) <= minutesOf(t.startTime)) return
    const start = minutesOf(t.startTime)
    const end = minutesOf(t.endTime)
    if (start % granularity !== 0 || end % granularity !== 0)
      out.push(
        `Day ${i + 1} must start and end on a ${granularity}-minute boundary.`
      )
  })
  return out
}

/** Requested equipment with its name, for the summary. */
export function selectedLinesOf(
  form: DraftForm,
  equipmentTypes: { id: string; name: string }[] | undefined
): { id: string; qty: number; name: string }[] {
  return Object.entries(form.lines)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({
      id,
      qty,
      name: equipmentTypes?.find((t) => t.id === id)?.name ?? "…",
    }))
}

export function canSaveOf(form: DraftForm): boolean {
  return (
    form.title.trim() !== "" && form.eventTypeId !== "" && form.studioId !== ""
  )
}

/** Submit needs no hard issues, and soft issues need a justification (BR-006-06). */
export function canSubmitOf(s: SubmitState): boolean {
  return (
    canSaveOf(s.form) &&
    s.form.sponsorId !== "" &&
    isScheduleComplete(s.form) &&
    s.ready &&
    !s.checking &&
    !s.hard &&
    !s.hasHold &&
    (!s.soft || s.justification.trim() !== "")
  )
}

/** The first thing that keeps a draft from being submitted, in plain language. */
export function submitHintOf(s: SubmitState): string {
  if (s.hasHold)
    return "Your account has an active hold. Clear it before you submit."
  if (!canSaveOf(s.form)) return "Add a title, event type and studio to save."
  if (!s.form.sponsorId) return "Choose a sponsor to submit."
  if (!isScheduleComplete(s.form)) return "Complete the schedule to submit."
  if (s.hard) return "Fix the issues above to submit."
  if (s.soft && !s.justification.trim()) return "Add a justification to submit."
  return "Checking…"
}

export function savedMessageOf(mode: SaveMode, editing: boolean): string {
  if (mode === "submit") return "Request submitted for sponsor approval"
  return editing ? "Changes saved" : "Draft saved"
}
