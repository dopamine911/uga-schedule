import type { EventState } from "./enums.ts"

const HOUR_MS = 3_600_000

/** The policy values that decide when an undecided request expires (BR-006-07). */
export interface DecisionPolicy {
  /** A request must be decided this many hours before its first day starts. */
  decisionCutoffHours: number
  /** The sponsor has this many hours from submission. */
  sponsorSlaHours: number
  /** Studio staff have this many hours from the sponsor's approval. */
  staffSlaHours: number
}

/** The request fields the deadline depends on. */
export interface DecisionTimes {
  state: EventState
  submittedAt: string | null
  sponsorDecidedAt: string | null
}

/**
 * When an undecided request expires, as UTC ISO instants. `cutoffAt` is the decision cutoff before the first
 * day; `slaAt` is the time limit for whoever must decide now (sponsor while Submitted, staff while
 * SponsorApproved). `at` is the earlier of the two: the moment the request expires if nobody acts.
 *
 * Shared by the expiry job and the API, so the deadline shown to users is exactly when the job expires the
 * request. All three are null when the request is not waiting on a decision.
 */
export function decisionDeadlines(
  request: DecisionTimes,
  firstDayStartsAt: string | null,
  policy: DecisionPolicy
): { at: string | null; cutoffAt: string | null; slaAt: string | null } {
  if (request.state !== "Submitted" && request.state !== "SponsorApproved")
    return { at: null, cutoffAt: null, slaAt: null }

  const cutoffAt =
    firstDayStartsAt === null
      ? null
      : new Date(
          Date.parse(firstDayStartsAt) - policy.decisionCutoffHours * HOUR_MS
        ).toISOString()

  const since =
    request.state === "Submitted"
      ? request.submittedAt
      : request.sponsorDecidedAt
  const slaHours =
    request.state === "Submitted"
      ? policy.sponsorSlaHours
      : policy.staffSlaHours
  const slaAt =
    since === null
      ? null
      : new Date(Date.parse(since) + slaHours * HOUR_MS).toISOString()

  const candidates = [cutoffAt, slaAt].filter(
    (instant): instant is string => instant !== null
  )
  const at = candidates.length
    ? candidates.reduce((earliest, instant) =>
        Date.parse(instant) < Date.parse(earliest) ? instant : earliest
      )
    : null
  return { at, cutoffAt, slaAt }
}
