import type { EventState } from "./enums.ts"

// F-006 §4 state machine.

export type EventAction =
  | "submit"
  | "sponsor_approve"
  | "sponsor_reject"
  | "staff_confirm"
  | "staff_reject"
  | "expire"
  | "cancel"
  | "start"
  | "no_show"
  | "end"
  | "close"
  /** Days / studio / equipment added or increased (BR-006-11). */
  | "change_material"
  /** Sponsor or event type changed (BR-006-11). */
  | "change_approval"

const T: Record<EventState, Partial<Record<EventAction, EventState>>> = {
  Draft: { submit: "Submitted" },
  Submitted: {
    sponsor_approve: "SponsorApproved",
    sponsor_reject: "Rejected",
    expire: "Expired",
    cancel: "Cancelled",
    change_material: "Submitted",
    change_approval: "Submitted",
  },
  SponsorApproved: {
    staff_confirm: "Confirmed",
    staff_reject: "Rejected",
    expire: "Expired",
    cancel: "Cancelled",
    change_material: "SponsorApproved",
    change_approval: "Submitted",
  },
  Confirmed: {
    start: "InProgress",
    no_show: "NoShow",
    cancel: "Cancelled",
    change_material: "SponsorApproved",
    change_approval: "Submitted",
  },
  InProgress: { end: "PostEvent" },
  PostEvent: { close: "Closed" },
  Closed: {},
  Rejected: {},
  Expired: {},
  Cancelled: {},
  NoShow: {},
}

export function nextState(state: EventState, action: EventAction): EventState | null {
  return T[state][action] ?? null
}

export class InvalidTransitionError extends Error {
  readonly state: EventState
  readonly action: EventAction
  constructor(state: EventState, action: EventAction) {
    super(`Cannot ${action.replace("_", " ")} an event that is ${state}.`)
    this.state = state
    this.action = action
  }
}

export function transition(state: EventState, action: EventAction): EventState {
  const n = nextState(state, action)
  if (!n) throw new InvalidTransitionError(state, action)
  return n
}

/** Classifies an edit to an event already past Draft (BR-006-11). */
export interface EventEditDiff {
  sponsorChanged: boolean
  typeChanged: boolean
  daysChanged: boolean
  studioChanged: boolean
  /** Any equipment line added or quantity increased. */
  equipmentIncreased: boolean
}

export function editAction(diff: EventEditDiff): EventAction | null {
  if (diff.sponsorChanged || diff.typeChanged) return "change_approval"
  if (diff.daysChanged || diff.studioChanged || diff.equipmentIncreased) return "change_material"
  return null
}
