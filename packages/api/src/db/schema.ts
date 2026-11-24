import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core"
import type {
  CheckinCondition,
  EventState,
  HoldReason,
  PackageStatus,
  ReviewReason,
  Permission,
  RoleCode,
  SoftPolicyCode,
  StageAnchor,
  StageKind,
  StageRecipient,
  StageStatus,
  UnitStatus,
} from "@studio/domain"
import { now } from "../lib/clock.ts"

// Conventions: text UUID ids; instants are UTC ISO strings; calendar dates are "YYYY-MM-DD";
// wall-clock times are "HH:MM" in the campus time zone.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
const createdAt = () => text("created_at").notNull().$defaultFn(now)
const bool = (name: string) => integer(name, { mode: "boolean" })

// ── F-001 ──────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: id(),
  idpSubject: text("idp_subject").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  affiliation: text("affiliation")
    .$type<"student" | "faculty" | "staff" | "other">()
    .notNull(),
  status: text("status")
    .$type<"active" | "disabled">()
    .notNull()
    .default("active"),
  createdAt: createdAt(),
})

export const roleAssignments = sqliteTable(
  "role_assignments",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").$type<RoleCode>().notNull(),
    studioId: text("studio_id").references(() => studios.id),
    source: text("source")
      .$type<"auto" | "manual">()
      .notNull()
      .default("manual"),
    assignedBy: text("assigned_by").references(() => users.id),
    assignedAt: createdAt(),
  },
  (t) => [uniqueIndex("role_assignment_uq").on(t.userId, t.role, t.studioId)]
)

/**
 * Permissions removed from one user regardless of the roles that grant them: everywhere when
 * studioId is null (BR-001-14), or for one studio's records (BR-001-15).
 */
export const permissionDenials = sqliteTable(
  "permission_denials",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    permission: text("permission").$type<Permission>().notNull(),
    studioId: text("studio_id").references(() => studios.id),
    reason: text("reason").notNull(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  // NULL studio ids are distinct in SQLite unique indexes; the route checks duplicates explicitly.
  (t) => [
    uniqueIndex("permission_denial_uq").on(t.userId, t.permission, t.studioId),
  ]
)

// ── F-002 ──────────────────────────────────────────────────────────────
export const levels = sqliteTable("levels", {
  id: id(),
  name: text("name").notNull(),
  rank: integer("rank").notNull().unique(),
  description: text("description").notNull().default(""),
  active: bool("active").notNull().default(true),
})

export const courseOfferings = sqliteTable("course_offerings", {
  id: id(),
  courseCode: text("course_code").notNull(),
  section: text("section").notNull().default(""),
  term: text("term").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  levelId: text("level_id")
    .notNull()
    .references(() => levels.id),
})

export const enrollments = sqliteTable(
  "enrollments",
  {
    id: id(),
    courseOfferingId: text("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status")
      .$type<"enrolled" | "dropped">()
      .notNull()
      .default("enrolled"),
    droppedOn: text("dropped_on"),
  },
  (t) => [index("enrollment_course_idx").on(t.courseOfferingId)]
)

export const levelGrants = sqliteTable(
  "level_grants",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    levelId: text("level_id")
      .notNull()
      .references(() => levels.id),
    source: text("source").$type<"course" | "manual">().notNull(),
    enrollmentId: text("enrollment_id").references(() => enrollments.id),
    validFrom: text("valid_from").notNull(),
    validUntil: text("valid_until"),
    revokedOn: text("revoked_on"),
    revokedBy: text("revoked_by").references(() => users.id),
    revokeReason: text("revoke_reason"),
    reason: text("reason").notNull().default(""),
    grantedBy: text("granted_by").references(() => users.id),
    expiryWarnedAt: text("expiry_warned_at"),
    createdAt: createdAt(),
  },
  (t) => [index("grant_user_idx").on(t.userId)]
)

// ── F-003 ──────────────────────────────────────────────────────────────
export const equipmentClasses = sqliteTable("equipment_classes", {
  id: id(),
  name: text("name").notNull().unique(),
  minLevelId: text("min_level_id")
    .notNull()
    .references(() => levels.id),
  description: text("description").notNull().default(""),
})

export const equipmentTypes = sqliteTable("equipment_types", {
  id: id(),
  classId: text("class_id")
    .notNull()
    .references(() => equipmentClasses.id),
  name: text("name").notNull(),
  manufacturer: text("manufacturer").notNull().default(""),
  model: text("model").notNull().default(""),
  tracking: text("tracking").$type<"serialized" | "bulk">().notNull(),
  status: text("status")
    .$type<"active" | "inactive">()
    .notNull()
    .default("active"),
  maxPerEvent: integer("max_per_event"),
  description: text("description").notNull().default(""),
})

export const equipmentUnits = sqliteTable("equipment_units", {
  id: id(),
  typeId: text("type_id")
    .notNull()
    .references(() => equipmentTypes.id),
  assetTag: text("asset_tag").notNull().unique(),
  serialNumber: text("serial_number").notNull().default(""),
  status: text("status").$type<UnitStatus>().notNull().default("available"),
  expectedBack: text("expected_back"),
  notes: text("notes").notNull().default(""),
})

export const bulkStock = sqliteTable("bulk_stock", {
  typeId: text("type_id")
    .primaryKey()
    .references(() => equipmentTypes.id),
  qtyAvailable: integer("qty_available").notNull().default(0),
  qtyInUse: integer("qty_in_use").notNull().default(0),
  qtyDamaged: integer("qty_damaged").notNull().default(0),
  qtyInRepair: integer("qty_in_repair").notNull().default(0),
  qtyLost: integer("qty_lost").notNull().default(0),
})

export const statusHistory = sqliteTable("status_history", {
  id: id(),
  unitId: text("unit_id").references(() => equipmentUnits.id),
  typeId: text("type_id")
    .notNull()
    .references(() => equipmentTypes.id),
  fromStatus: text("from_status").$type<UnitStatus>(),
  toStatus: text("to_status").$type<UnitStatus>().notNull(),
  qty: integer("qty").notNull().default(1),
  actorId: text("actor_id").references(() => users.id),
  eventId: text("event_id").references(() => events.id),
  reason: text("reason").notNull().default(""),
  at: createdAt(),
})

// ── F-004 ──────────────────────────────────────────────────────────────
export const studios = sqliteTable("studios", {
  id: id(),
  name: text("name").notNull().unique(),
  location: text("location").notNull().default(""),
  capacityPeople: integer("capacity_people").notNull().default(1),
  minLevelId: text("min_level_id")
    .notNull()
    .references(() => levels.id),
  turnaroundMinutes: integer("turnaround_minutes").notNull().default(30),
  slotGranularityMinutes: integer("slot_granularity_minutes")
    .notNull()
    .default(30),
  status: text("status")
    .$type<"active" | "inactive">()
    .notNull()
    .default("active"),
})

export const openingHours = sqliteTable("opening_hours", {
  id: id(),
  studioId: text("studio_id")
    .notNull()
    .references(() => studios.id),
  weekday: integer("weekday").notNull(),
  opens: text("opens").notNull(),
  closes: text("closes").notNull(),
})

export const blackouts = sqliteTable("blackouts", {
  id: id(),
  /** null = all studios */
  studioId: text("studio_id").references(() => studios.id),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  reason: text("reason").notNull().default(""),
})

// ── F-005 ──────────────────────────────────────────────────────────────
export const eventTypes = sqliteTable("event_types", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  status: text("status")
    .$type<"active" | "inactive">()
    .notNull()
    .default("active"),
  maxDays: integer("max_days").notNull().default(1),
  maxHoursPerDay: integer("max_hours_per_day").notNull().default(8),
  dailyEquipmentReturn: bool("daily_equipment_return").notNull().default(false),
  pickupWindowMinutes: integer("pickup_window_minutes").notNull().default(60),
  checkinGraceMinutes: integer("checkin_grace_minutes").notNull().default(60),
  requiresResults: bool("requires_results").notNull().default(false),
  resultsDueDays: integer("results_due_days").notNull().default(7),
  requesterCanUpload: bool("requester_can_upload").notNull().default(false),
  requiresSponsorSignoff: bool("requires_sponsor_signoff")
    .notNull()
    .default(false),
})

export const eventTypeStudios = sqliteTable(
  "event_type_studios",
  {
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventTypes.id),
    studioId: text("studio_id")
      .notNull()
      .references(() => studios.id),
  },
  (t) => [primaryKey({ columns: [t.eventTypeId, t.studioId] })]
)

export const stageTemplates = sqliteTable("stage_templates", {
  id: id(),
  eventTypeId: text("event_type_id")
    .notNull()
    .references(() => eventTypes.id),
  seq: integer("seq").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<StageKind>().notNull(),
  anchor: text("anchor").$type<StageAnchor>().notNull(),
  offsetMinutes: integer("offset_minutes").notNull(),
  recipients: text("recipients", { mode: "json" })
    .$type<StageRecipient[]>()
    .notNull(),
  /** task only */
  assigneeRole: text("assignee_role").$type<
    "requester" | "sponsor" | "studio_staff"
  >(),
  blocksCheckout: bool("blocks_checkout").notNull().default(false),
  message: text("message").notNull().default(""),
  /** Soft-deleted templates keep existing instances valid (BR-005-07). */
  archived: bool("archived").notNull().default(false),
})

/** Admin-configurable numbers (BR-006-05). Keys: see services/policy.ts. */
export const policies = sqliteTable("policies", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
})

/** Dev-mode time travel offset (lib/clock.ts); one row, id 1. Stored so every function instance shares it. */
export const devClock = sqliteTable("dev_clock", {
  id: integer("id").primaryKey(),
  offsetMs: integer("offset_ms").notNull(),
})

// ── F-006 ──────────────────────────────────────────────────────────────
export const events = sqliteTable(
  "events",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventTypes.id),
    studioId: text("studio_id")
      .notNull()
      .references(() => studios.id),
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id),
    sponsorId: text("sponsor_id").references(() => users.id),
    state: text("state").$type<EventState>().notNull().default("Draft"),
    needsReview: bool("needs_review").notNull().default(false),
    reviewReasons: text("review_reasons", { mode: "json" })
      .$type<ReviewReason[]>()
      .notNull()
      .default([]),
    overrideRequested: text("override_requested", { mode: "json" })
      .$type<SoftPolicyCode[]>()
      .notNull()
      .default([]),
    overrideJustification: text("override_justification").notNull().default(""),
    submittedAt: text("submitted_at"),
    sponsorDecidedAt: text("sponsor_decided_at"),
    staffDecidedAt: text("staff_decided_at"),
    decisionNote: text("decision_note").notNull().default(""),
    cancelReason: text("cancel_reason").notNull().default(""),
    /** Bumped on every change; ICS SEQUENCE (F-009). */
    sequence: integer("sequence").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index("event_state_idx").on(t.state),
    index("event_studio_idx").on(t.studioId),
  ]
)

export const eventDays = sqliteTable(
  "event_days",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
  },
  (t) => [index("event_day_event_idx").on(t.eventId)]
)

export const eventParticipants = sqliteTable(
  "event_participants",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })]
)

export const equipmentLines = sqliteTable("equipment_lines", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  equipmentTypeId: text("equipment_type_id")
    .notNull()
    .references(() => equipmentTypes.id),
  qty: integer("qty").notNull(),
  note: text("note").notNull().default(""),
})

export const policyOverrides = sqliteTable("policy_overrides", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  ruleCode: text("rule_code").notNull(),
  actorId: text("actor_id")
    .notNull()
    .references(() => users.id),
  reason: text("reason").notNull(),
  at: createdAt(),
})

export const stageInstances = sqliteTable(
  "stage_instances",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    stageTemplateId: text("stage_template_id")
      .notNull()
      .references(() => stageTemplates.id),
    dayIndex: integer("day_index"),
    // Snapshot of the template (BR-005-07)
    name: text("name").notNull(),
    kind: text("kind").$type<StageKind>().notNull(),
    recipients: text("recipients", { mode: "json" })
      .$type<StageRecipient[]>()
      .notNull(),
    assigneeRole: text("assignee_role").$type<
      "requester" | "sponsor" | "studio_staff"
    >(),
    blocksCheckout: bool("blocks_checkout").notNull().default(false),
    message: text("message").notNull().default(""),
    dueAt: text("due_at").notNull(),
    status: text("status").$type<StageStatus>().notNull(),
    completedBy: text("completed_by").references(() => users.id),
    completedAt: text("completed_at"),
    overrideReason: text("override_reason"),
  },
  (t) => [index("stage_due_idx").on(t.status, t.dueAt)]
)

// ── F-007 ──────────────────────────────────────────────────────────────
export const checkoutRecords = sqliteTable(
  "checkout_records",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    equipmentLineId: text("equipment_line_id")
      .notNull()
      .references(() => equipmentLines.id),
    equipmentTypeId: text("equipment_type_id")
      .notNull()
      .references(() => equipmentTypes.id),
    /** serialized only */
    unitId: text("unit_id").references(() => equipmentUnits.id),
    /** units for serialized (always 1); quantity for bulk */
    qty: integer("qty").notNull(),
    outAt: text("out_at").notNull(),
    outBy: text("out_by")
      .notNull()
      .references(() => users.id),
    conditionOut: text("condition_out").notNull().default("ok"),
    dueAt: text("due_at").notNull(),
    inAt: text("in_at"),
    inBy: text("in_by").references(() => users.id),
    conditionIn: text("condition_in").$type<CheckinCondition>(),
    qtyOk: integer("qty_ok").notNull().default(0),
    qtyDamaged: integer("qty_damaged").notNull().default(0),
    qtyMissing: integer("qty_missing").notNull().default(0),
    /** Missing quantity later marked lost (BR-003-07). */
    qtyLost: integer("qty_lost").notNull().default(0),
    notes: text("notes").notNull().default(""),
    late: bool("late").notNull().default(false),
    lastOverdueNoticeAt: text("last_overdue_notice_at"),
  },
  (t) => [index("checkout_event_idx").on(t.eventId)]
)

export const acknowledgements = sqliteTable("acknowledgements", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  termsVersion: text("terms_version").notNull(),
  at: createdAt(),
})

export const holds = sqliteTable(
  "holds",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").$type<HoldReason>().notNull(),
    eventId: text("event_id").references(() => events.id),
    status: text("status")
      .$type<"active" | "cleared">()
      .notNull()
      .default("active"),
    source: text("source").$type<"system" | "staff">().notNull(),
    note: text("note").notNull().default(""),
    autoClearAt: text("auto_clear_at"),
    clearedBy: text("cleared_by").references(() => users.id),
    clearedReason: text("cleared_reason"),
    clearedAt: text("cleared_at"),
    createdAt: createdAt(),
  },
  (t) => [index("hold_user_idx").on(t.userId, t.status)]
)

// ── F-008 ──────────────────────────────────────────────────────────────
export const resultPackages = sqliteTable("result_packages", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .unique()
    .references(() => events.id),
  status: text("status").$type<PackageStatus>().notNull().default("collecting"),
  resultsDueAt: text("results_due_at"),
  publishedAt: text("published_at"),
  publishedBy: text("published_by").references(() => users.id),
  publishOverrideReason: text("publish_override_reason"),
  retainUntil: text("retain_until"),
  sponsorSignoff: text("sponsor_signoff")
    .$type<"pending" | "accepted" | "not_required">()
    .notNull(),
  sponsorComment: text("sponsor_comment").notNull().default(""),
  signedOffAt: text("signed_off_at"),
  checkinReport: text("checkin_report", { mode: "json" }).$type<unknown>(),
  createdAt: createdAt(),
})

export const resultItems = sqliteTable("result_items", {
  id: id(),
  packageId: text("package_id")
    .notNull()
    .references(() => resultPackages.id),
  kind: text("kind").$type<"file" | "link">().notNull(),
  title: text("title").notNull(),
  storageKey: text("storage_key"),
  url: text("url"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: text("uploaded_by")
    .notNull()
    .references(() => users.id),
  uploadedAt: createdAt(),
})

export const resultAccessLog = sqliteTable("result_access_log", {
  id: id(),
  itemId: text("item_id")
    .notNull()
    .references(() => resultItems.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  at: createdAt(),
})

// ── F-009 / F-010 / 90 ─────────────────────────────────────────────────
export const icsFeeds = sqliteTable("ics_feeds", {
  id: id(),
  userId: text("user_id").references(() => users.id),
  studioId: text("studio_id").references(() => studios.id),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  revokedAt: text("revoked_at"),
})

export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    code: text("code").notNull(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => users.id),
    eventId: text("event_id").references(() => events.id),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** Idempotency (BR-010-02). */
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: createdAt(),
    readAt: text("read_at"),
  },
  (t) => [index("notification_recipient_idx").on(t.recipientId, t.readAt)]
)

export const auditLog = sqliteTable("audit_log", {
  id: id(),
  at: createdAt(),
  actorId: text("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  before: text("before", { mode: "json" }).$type<unknown>(),
  after: text("after", { mode: "json" }).$type<unknown>(),
  reason: text("reason").notNull().default(""),
})
