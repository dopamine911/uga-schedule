import type { StageAnchor, StageKind, StageStatus } from "./enums.ts"
import { type Interval, addMinutesIso, localToUtc, utcToLocal } from "./time.ts"

// F-005 §5 stage scheduling.

export interface StageTemplateLike {
  id: string
  seq: number
  kind: StageKind
  anchor: StageAnchor
  offsetMinutes: number
}

export interface PlannedStage {
  templateId: string
  /** Index into the event's days for each_day_start stages; null otherwise. */
  dayIndex: number | null
  dueAt: string
  status: StageStatus
}

export interface QuietHours {
  start: string // "22:00"
  end: string // "07:00"
}

/**
 * Moves a reminder falling inside quiet hours to the end of quiet hours (BR-005-10),
 * unless that would push it past the event start.
 */
export function applyQuietHours(dueAt: string, eventStart: string, tz: string, quiet: QuietHours): string {
  const local = utcToLocal(dueAt, tz)
  const [qs, qe] = [quiet.start, quiet.end]
  const inQuiet = qs > qe ? local.time >= qs || local.time < qe : local.time >= qs && local.time < qe
  if (!inQuiet) return dueAt
  // Quiet period that crosses midnight: times after `start` move to the next morning.
  let targetDay = local.day
  if (qs > qe && local.time >= qs) {
    const d = new Date(`${local.day}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    targetDay = d.toISOString().slice(0, 10)
  }
  const moved = localToUtc(targetDay, qe, tz)
  return Date.parse(moved) < Date.parse(eventStart) ? moved : dueAt
}

/** Creates stage instances when an event is confirmed (BR-005-01, BR-005-04). Days must be sorted. */
export function planStages(
  templates: readonly StageTemplateLike[],
  days: readonly Interval[],
  now: string,
  tz: string,
  quiet: QuietHours,
): PlannedStage[] {
  if (days.length === 0) return []
  const eventStart = days[0]!.start
  const eventEnd = days[days.length - 1]!.end
  const firstSeq = Math.min(...templates.map((t) => t.seq))
  const out: PlannedStage[] = []

  for (const t of [...templates].sort((a, b) => a.seq - b.seq)) {
    const anchors: { at: string; dayIndex: number | null }[] =
      t.anchor === "each_day_start"
        ? days.map((d, i) => ({ at: d.start, dayIndex: i }))
        : [{ at: t.anchor === "event_start" ? eventStart : eventEnd, dayIndex: null }]

    for (const a of anchors) {
      let dueAt = addMinutesIso(a.at, t.offsetMinutes)
      if (t.kind === "task") {
        out.push({ templateId: t.id, dayIndex: a.dayIndex, dueAt, status: "open" })
        continue
      }
      dueAt = applyQuietHours(dueAt, eventStart, tz, quiet)
      if (Date.parse(dueAt) <= Date.parse(now)) {
        // The first stage is the booking confirmation summary: always sent (BR-005-04).
        out.push({ templateId: t.id, dayIndex: a.dayIndex, dueAt: now, status: t.seq === firstSeq ? "scheduled" : "skipped" })
      } else {
        out.push({ templateId: t.id, dayIndex: a.dayIndex, dueAt, status: "scheduled" })
      }
    }
  }
  return out
}

/** Tasks blocking checkout: blocks_checkout and not done/overridden (BR-005-05). */
export function blockingTasks<T extends { kind: StageKind; blocksCheckout: boolean; status: StageStatus }>(
  stages: readonly T[],
): T[] {
  return stages.filter((s) => s.kind === "task" && s.blocksCheckout && s.status !== "done" && s.status !== "overridden" && s.status !== "cancelled")
}
