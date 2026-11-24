// Shared vocabulary. Values match the specs in specs/*.md.

export const ROLES = ["STUDENT", "SPONSOR", "STUDIO_STAFF", "EQUIPMENT_MANAGER", "ADMIN"] as const
export type RoleCode = (typeof ROLES)[number]
export const STUDIO_SCOPED_ROLES: readonly RoleCode[] = ["STUDIO_STAFF"]

export const EVENT_STATES = [
  "Draft",
  "Submitted",
  "SponsorApproved",
  "Confirmed",
  "InProgress",
  "PostEvent",
  "Closed",
  "Rejected",
  "Expired",
  "Cancelled",
  "NoShow",
] as const
export type EventState = (typeof EVENT_STATES)[number]

/** States that hold studio time (F-006 §4). */
export const HOLDS_STUDIO: readonly EventState[] = ["Submitted", "SponsorApproved", "Confirmed", "InProgress"]
/** States whose equipment lines count as reservations (F-006 §4). PostEvent is handled via outstanding checkouts. */
export const HOLDS_STOCK: readonly EventState[] = ["Submitted", "SponsorApproved", "Confirmed", "InProgress"]
/** States in which needs_review can be raised and eligibility is re-checked. */
export const REVIEWABLE: readonly EventState[] = ["Submitted", "SponsorApproved", "Confirmed"]
export const TERMINAL: readonly EventState[] = ["Closed", "Rejected", "Expired", "Cancelled", "NoShow"]

export const UNIT_STATUSES = ["available", "in_use", "damaged", "in_repair", "lost", "retired"] as const
export type UnitStatus = (typeof UNIT_STATUSES)[number]

export const REVIEW_REASONS = [
  "ELIGIBILITY_LOST",
  "EQUIPMENT_SHORTAGE",
  "STUDIO_BLACKOUT",
  "OUTSIDE_HOURS",
  "SPONSOR_INACTIVE",
  "HOLD_ACTIVE",
] as const
export type ReviewReason = (typeof REVIEW_REASONS)[number]

export const SOFT_POLICIES = ["LEAD_TIME", "ADVANCE", "WEEKLY_HOURS", "OPEN_CAP", "MAX_PER_EVENT"] as const
export type SoftPolicyCode = (typeof SOFT_POLICIES)[number]

export const HOLD_REASONS = ["LATE_RETURN", "DAMAGE", "LOSS", "MANUAL"] as const
export type HoldReason = (typeof HOLD_REASONS)[number]

export const STAGE_KINDS = ["reminder", "task"] as const
export type StageKind = (typeof STAGE_KINDS)[number]
export const STAGE_ANCHORS = ["event_start", "event_end", "each_day_start"] as const
export type StageAnchor = (typeof STAGE_ANCHORS)[number]
export const STAGE_RECIPIENTS = ["requester", "participants", "sponsor", "studio_staff"] as const
export type StageRecipient = (typeof STAGE_RECIPIENTS)[number]
export const STAGE_STATUSES = [
  "scheduled",
  "sent",
  "skipped",
  "open",
  "done",
  "overdue",
  "overridden",
  "cancelled",
] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

export const CHECKIN_CONDITIONS = ["ok", "damaged", "missing"] as const
export type CheckinCondition = (typeof CHECKIN_CONDITIONS)[number]

export const PACKAGE_STATUSES = ["collecting", "published", "expired"] as const
export type PackageStatus = (typeof PACKAGE_STATUSES)[number]
