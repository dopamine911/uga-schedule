import { type DayInput, isLocalDate, isLocalTime, minutesOf } from "@studio/domain"

// Form model for the event request page. Dates/times stay as calendar strings; the API resolves them in campus tz.

export interface PersonRef {
  id: string
  displayName: string
}

export interface DayTimes {
  startTime: string
  endTime: string
}

export interface DraftForm {
  title: string
  description: string
  eventTypeId: string
  studioId: string
  /** "" = not chosen yet. */
  sponsorId: string
  participants: PersonRef[]
  /** "" until a first day is chosen. */
  firstDay: string
  /** One entry per consecutive day; its length is the number of days. */
  times: DayTimes[]
  /** Equipment type id → requested quantity. */
  lines: Record<string, number>
}

export const DEFAULT_TIMES: DayTimes = { startTime: "10:00", endTime: "12:00" }

export const EMPTY_FORM: DraftForm = {
  title: "",
  description: "",
  eventTypeId: "",
  studioId: "",
  sponsorId: "",
  participants: [],
  firstDay: "",
  times: [DEFAULT_TIMES],
  lines: {},
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Resizes the per-day time rows, copying the last row's times into new days. */
export function withNumDays(form: DraftForm, n: number): DraftForm {
  const last = form.times[form.times.length - 1] ?? DEFAULT_TIMES
  const times = Array.from({ length: n }, (_, i) => form.times[i] ?? { ...last })
  return { ...form, times }
}

export function isScheduleComplete(form: DraftForm): boolean {
  return (
    isLocalDate(form.firstDay) &&
    form.times.length > 0 &&
    form.times.every((t) => isLocalTime(t.startTime) && isLocalTime(t.endTime) && minutesOf(t.endTime) > minutesOf(t.startTime))
  )
}

/** Calendar days of the request, or [] while the schedule is incomplete. */
export function daysOf(form: DraftForm): DayInput[] {
  if (!isScheduleComplete(form)) return []
  return form.times.map((t, i) => ({ day: addDays(form.firstDay, i), startTime: t.startTime, endTime: t.endTime }))
}

export function linesOf(form: DraftForm): { equipmentTypeId: string; qty: number }[] {
  return Object.entries(form.lines)
    .filter(([, qty]) => qty > 0)
    .map(([equipmentTypeId, qty]) => ({ equipmentTypeId, qty }))
}

/** Body shared by POST/PUT /events. */
export function draftPayload(form: DraftForm, sponsorId: string | null) {
  return {
    title: form.title.trim(),
    description: form.description,
    eventTypeId: form.eventTypeId,
    studioId: form.studioId,
    sponsorId,
    participantIds: form.participants.map((p) => p.id),
    days: daysOf(form),
    lines: linesOf(form),
  }
}
