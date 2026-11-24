import type { STAGE_ANCHORS, STAGE_KINDS, STAGE_RECIPIENTS } from "@studio/domain"
import type { EventTypeDetail } from "@/components/admin/pickers"

// Form model for one stage in the event type editor (F-005), and its conversion to and from the API shape.

export type StageRow = EventTypeDetail["stages"][number]

export interface StageDraft {
  key: string
  name: string
  kind: (typeof STAGE_KINDS)[number]
  anchor: (typeof STAGE_ANCHORS)[number]
  amount: string
  unit: "minutes" | "hours" | "days"
  direction: "before" | "after"
  recipients: string[]
  assigneeRole: string
  blocksCheckout: boolean
  message: string
}

const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 } as const

let keySeq = 0
/** Local key for React lists; drafts have no server id until saved. */
function nextKey(): string {
  keySeq += 1
  return `stage-${keySeq}`
}

export function blankStage(): StageDraft {
  return {
    key: nextKey(),
    name: "",
    kind: "reminder",
    anchor: "event_start",
    amount: "1",
    unit: "days",
    direction: "before",
    recipients: ["requester"],
    assigneeRole: "",
    blocksCheckout: false,
    message: "",
  }
}

/** Splits a stored offset into the friendliest unit (days, then hours, then minutes). */
export function stageToDraft(s: StageRow): StageDraft {
  const abs = Math.abs(s.offsetMinutes)
  const unit =
    abs > 0 && abs % 1440 === 0
      ? "days"
      : abs > 0 && abs % 60 === 0
        ? "hours"
        : "minutes"
  return {
    key: nextKey(),
    name: s.name,
    kind: s.kind,
    anchor: s.anchor,
    amount: String(abs / UNIT_MINUTES[unit]),
    unit,
    direction: s.offsetMinutes < 0 ? "before" : "after",
    recipients: [...s.recipients],
    assigneeRole: s.assigneeRole ?? "",
    blocksCheckout: s.blocksCheckout,
    message: s.message,
  }
}

/** Payload for PUT /event-types/:id/stages. Reminders never block; tasks keep their assignee. */
export function draftToPayload(d: StageDraft) {
  const sign = d.direction === "before" ? -1 : 1
  const offsetMinutes =
    Math.round(Number(d.amount) * UNIT_MINUTES[d.unit]) * sign
  const task = d.kind === "task"
  return {
    name: d.name.trim(),
    kind: d.kind,
    anchor: d.anchor,
    offsetMinutes,
    recipients: d.recipients as (typeof STAGE_RECIPIENTS)[number][],
    assigneeRole:
      task && d.assigneeRole
        ? (d.assigneeRole as "requester" | "sponsor" | "studio_staff")
        : null,
    blocksCheckout: task && d.blocksCheckout,
    message: d.message,
  }
}
