import { rmSync } from "node:fs"
import { resolve } from "node:path"
import {
  type EventAction,
  type HoldReason,
  type Issue,
  type Permission,
  type StageRecipient,
  type UnitStatus,
  addMinutesIso,
  can,
  hasUnscoped,
  nextState,
  planStages,
} from "@studio/domain"
import { and, asc, eq, inArray } from "drizzle-orm"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  bulkStock,
  checkoutRecords,
  equipmentLines,
  equipmentTypes,
  equipmentUnits,
  eventDays,
  eventTypes,
  events,
  holds,
  resultItems,
  resultPackages,
  stageInstances,
  stageTemplates,
  statusHistory,
  studios,
  users,
} from "../db/schema.ts"
import type { SessionUser } from "../env.ts"
import { audit } from "../lib/audit.ts"
import { now } from "../lib/clock.ts"
import { conflict, notFound } from "../lib/errors.ts"
import { eventAudience, notify } from "../lib/notify.ts"
import { eventAccess, participantIds } from "./booking.ts"
import { getPolicies } from "./policy.ts"
import { recheckEvents } from "./review.ts"

// Shared event lifecycle helpers (F-005 … F-008) used by routes and background jobs.

export type EventRow = typeof events.$inferSelect
export type StageRow = typeof stageInstances.$inferSelect
export type RecordRow = typeof checkoutRecords.$inferSelect
export type PackageRow = typeof resultPackages.$inferSelect
export type HoldRow = typeof holds.$inferSelect

const DAY_MS = 86_400_000

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString()
}

/** "Mon, Nov 30, 1:00 PM CST" in the campus time zone (BR-010-04). Used in notification and status text. */
export function localLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: config.tz,
    timeZoneName: "short",
  }).format(new Date(iso))
}

// ── Access (F-001) ────────────────────────────────────────────────────

/** A draft is visible to its requester and to unscoped viewers only; everything else follows event.view (F-001). */
export function canViewEvent(db: DB, user: SessionUser, ev: EventRow): boolean {
  if (ev.state === "Draft") return ev.requesterId === user.id || hasUnscoped(user.roles, "event.view")
  return can(user.roles, "event.view", eventAccess(user, ev, participantIds(db, ev.id)))
}

/** Loads an event the caller may see; 404 otherwise so existence is not leaked. */
export function visibleEvent(db: DB, user: SessionUser, id: string): EventRow {
  const ev = db.select().from(events).where(eq(events.id, id)).get()
  if (!ev || !canViewEvent(db, user, ev)) throw notFound("Event")
  return ev
}

/** Action permission on a visible record (403 when the caller sees it but may not act). */
export function allowed(user: SessionUser, perm: Permission, studioId: string | null, own = false): boolean {
  return can(user.roles, perm, { own, studioId })
}

export function isRequester(user: SessionUser, ev: EventRow): boolean {
  return ev.requesterId === user.id
}

export function getEvent(db: DB, id: string): EventRow | undefined {
  return db.select().from(events).where(eq(events.id, id)).get()
}

// ── Days, times ──────────────────────────────────────────────────────

export function daysOf(db: DB, eventId: string) {
  return db.select().from(eventDays).where(eq(eventDays.eventId, eventId)).orderBy(asc(eventDays.day)).all()
}

export function eventSpan(db: DB, eventId: string): { start: string; end: string; firstEnd: string } | null {
  const d = daysOf(db, eventId)
  if (d.length === 0) return null
  return { start: d[0]!.startsAt, end: d[d.length - 1]!.endsAt, firstEnd: d[0]!.endsAt }
}

export function typeOf(db: DB, eventTypeId: string) {
  const t = db.select().from(eventTypes).where(eq(eventTypes.id, eventTypeId)).get()
  if (!t) throw new Error(`event type ${eventTypeId} missing`)
  return t
}

/** Pickup opens this long before the first day starts (BR-007-01). */
export function pickupOpensAt(db: DB, ev: EventRow): string | null {
  const span = eventSpan(db, ev.id)
  if (!span) return null
  return addMinutesIso(span.start, -typeOf(db, ev.eventTypeId).pickupWindowMinutes)
}

/** Equipment due time: last day end + grace, or the first day's for daily-return types (BR-007-07). */
export function returnDueAt(db: DB, ev: EventRow): string {
  const span = eventSpan(db, ev.id)!
  const type = typeOf(db, ev.eventTypeId)
  return addMinutesIso(type.dailyEquipmentReturn ? span.firstEnd : span.end, type.checkinGraceMinutes)
}

// ── State machine ────────────────────────────────────────────────────

/**
 * Applies a state-machine action (F-006 §4), bumps `sequence` (F-009) and audits. Throws 409 on invalid transitions.
 */
export function moveEvent(
  db: DB,
  ev: EventRow,
  action: EventAction,
  actorId: string | null,
  patch: Partial<typeof events.$inferInsert> = {},
  reason = "",
): EventRow {
  const to = nextState(ev.state, action)
  if (!to) throw conflict("INVALID_TRANSITION", `Cannot ${action.replace("_", " ")} an event that is ${ev.state}.`)
  const updated = db
    .update(events)
    .set({ ...patch, state: to, sequence: ev.sequence + 1, updatedAt: now() })
    .where(eq(events.id, ev.id))
    .returning()
    .get()
  audit(db, {
    actorId,
    action: `event.${action}`,
    entityType: "event",
    entityId: ev.id,
    before: { state: ev.state },
    after: { state: to, ...patch },
    reason,
  })
  return updated
}

/** 409 carrying the full issue list; the code is the first issue's code (hard issues first). */
export function issuesConflict(issues: readonly Issue[]) {
  const first = issues.find((i) => i.severity === "hard") ?? issues[0]!
  return conflict(first.code, issues.map((i) => i.message).join(" "), { issues })
}

// ── Stages (F-005) ───────────────────────────────────────────────────

/** Fills BR-005-11 placeholders. */
export function renderMessage(db: DB, ev: EventRow, message: string, taskName = ""): string {
  const days = daysOf(db, ev.id)
  const studio = db.select().from(studios).where(eq(studios.id, ev.studioId)).get()
  const lines = db
    .select({ qty: equipmentLines.qty, name: equipmentTypes.name })
    .from(equipmentLines)
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipmentLines.equipmentTypeId))
    .where(eq(equipmentLines.eventId, ev.id))
    .all()
    .filter((l) => l.qty > 0)
  const first = days[0]
  const pickup = pickupOpensAt(db, ev)
  const values: Record<string, string> = {
    "event.title": ev.title,
    "studio.name": studio?.name ?? "",
    "event.first_day": first ? first.day : "",
    "event.days": days.map((d) => `${d.day} ${d.startTime}–${d.endTime}`).join(", "),
    "equipment.list": lines.length ? lines.map((l) => `${l.qty} × ${l.name}`).join(", ") : "no equipment",
    "pickup.window": pickup ? localLabel(pickup) : "",
    "links.event": `${config.publicBaseUrl}/events/${ev.id}`,
    "task.name": taskName,
  }
  return message.replace(/\{([a-z_.]+)\}/g, (m, k: string) => values[k] ?? m)
}

/** Audience of a stage: the assignee for tasks, otherwise its recipients (F-005 §2). */
export function stageAudience(db: DB, eventId: string, s: Pick<StageRow, "kind" | "recipients" | "assigneeRole">): string[] {
  const who: StageRecipient[] = s.kind === "task" && s.assigneeRole ? [s.assigneeRole] : s.recipients
  return eventAudience(db, eventId, who)
}

/**
 * Plans stage instances on confirmation (BR-005-01). On re-confirmation keeps done/overridden tasks and sent reminders
 * and replaces the rest (BR-005-02). Returns the tasks opened by this planning run.
 */
export function planEventStages(db: DB, ev: EventRow): StageRow[] {
  const templates = db
    .select()
    .from(stageTemplates)
    .where(and(eq(stageTemplates.eventTypeId, ev.eventTypeId), eq(stageTemplates.archived, false)))
    .all()
  const days = daysOf(db, ev.id).map((d) => ({ start: d.startsAt, end: d.endsAt }))
  const existing = db.select().from(stageInstances).where(eq(stageInstances.eventId, ev.id)).all()
  const kept = existing.filter((s) => s.status === "done" || s.status === "overridden" || s.status === "sent")
  const replaced = existing.filter((s) => !kept.includes(s)).map((s) => s.id)
  if (replaced.length) db.delete(stageInstances).where(inArray(stageInstances.id, replaced)).run()

  const planned = planStages(templates, days, now(), config.tz, config.quietHours)
  const opened: StageRow[] = []
  for (const p of planned) {
    if (kept.some((k) => k.stageTemplateId === p.templateId && k.dayIndex === p.dayIndex)) continue
    const tpl = templates.find((t) => t.id === p.templateId)!
    const row = db
      .insert(stageInstances)
      .values({
        eventId: ev.id,
        stageTemplateId: tpl.id,
        dayIndex: p.dayIndex,
        name: tpl.name,
        kind: tpl.kind,
        recipients: tpl.recipients,
        assigneeRole: tpl.assigneeRole,
        blocksCheckout: tpl.blocksCheckout,
        message: tpl.message,
        dueAt: p.dueAt,
        status: p.status,
      })
      .returning()
      .get()
    if (row.status === "open") opened.push(row)
  }
  return opened
}

/** Notifies assignees of newly opened tasks (F-005 §4). */
export function notifyTasksOpened(db: DB, ev: EventRow, opened: readonly StageRow[]): void {
  for (const s of opened) {
    notify(db, {
      code: "TASK_OPENED",
      to: stageAudience(db, ev.id, s),
      eventId: ev.id,
      subject: `Task: ${s.name}`,
      body: renderMessage(db, ev, s.message, s.name),
      key: `TASK_OPENED:${s.id}`,
    })
  }
}

/** BR-005-03: cancelling an event cancels every stage instance that is still open. */
export function cancelOpenStages(db: DB, eventId: string): void {
  db.update(stageInstances)
    .set({ status: "cancelled" })
    .where(and(eq(stageInstances.eventId, eventId), inArray(stageInstances.status, ["scheduled", "open", "overdue"])))
    .run()
}

/** Leaving Confirmed cancels unsent reminders; they are re-planned on re-confirmation (BR-005-02). */
export function cancelScheduledReminders(db: DB, eventId: string): void {
  db.update(stageInstances)
    .set({ status: "cancelled" })
    .where(
      and(eq(stageInstances.eventId, eventId), eq(stageInstances.kind, "reminder"), eq(stageInstances.status, "scheduled")),
    )
    .run()
}

export function stagesOf(db: DB, eventId: string): StageRow[] {
  return db.select().from(stageInstances).where(eq(stageInstances.eventId, eventId)).orderBy(asc(stageInstances.dueAt)).all()
}

// ── Equipment movements (F-003) ──────────────────────────────────────

export function setUnitStatus(
  db: DB,
  unit: { id: string; typeId: string; status: UnitStatus },
  to: UnitStatus,
  actorId: string | null,
  eventId: string | null,
  reason: string,
): void {
  db.update(equipmentUnits).set({ status: to }).where(eq(equipmentUnits.id, unit.id)).run()
  db.insert(statusHistory)
    .values({ unitId: unit.id, typeId: unit.typeId, fromStatus: unit.status, toStatus: to, qty: 1, actorId, eventId, reason })
    .run()
}

export type BulkBucket = "qtyAvailable" | "qtyInUse" | "qtyDamaged" | "qtyLost"
const BUCKET_STATUS: Record<BulkBucket, UnitStatus> = {
  qtyAvailable: "available",
  qtyInUse: "in_use",
  qtyDamaged: "damaged",
  qtyLost: "lost",
}

export function moveBulk(
  db: DB,
  typeId: string,
  from: BulkBucket,
  to: BulkBucket,
  qty: number,
  actorId: string | null,
  eventId: string | null,
  reason: string,
): void {
  if (qty <= 0) return
  const s = db.select().from(bulkStock).where(eq(bulkStock.typeId, typeId)).get()
  if (!s) throw new Error(`bulk stock for ${typeId} missing`)
  db.update(bulkStock)
    .set({ [from]: s[from] - qty, [to]: s[to] + qty })
    .where(eq(bulkStock.typeId, typeId))
    .run()
  db.insert(statusHistory)
    .values({ typeId, fromStatus: BUCKET_STATUS[from], toStatus: BUCKET_STATUS[to], qty, actorId, eventId, reason })
    .run()
}

// ── Check-in state (F-007) ───────────────────────────────────────────

/** Quantity of a record still physically out: not returned (ok/damaged) and not written off as lost. */
export function outstandingQty(r: Pick<RecordRow, "qty" | "qtyOk" | "qtyDamaged" | "qtyLost">): number {
  return Math.max(0, r.qty - r.qtyOk - r.qtyDamaged - r.qtyLost)
}

export function recordsOf(db: DB, eventId: string): RecordRow[] {
  return db.select().from(checkoutRecords).where(eq(checkoutRecords.eventId, eventId)).all()
}

/** Check-in is complete when every record is fully accounted for (BR-007-14). */
export function checkinComplete(db: DB, eventId: string): boolean {
  return recordsOf(db, eventId).every((r) => outstandingQty(r) === 0)
}

export interface CheckinReportItem {
  recordId: string
  typeName: string
  assetTag: string | null
  qty: number
  outAt: string
  outBy: string
  conditionOut: string
  dueAt: string
  inAt: string | null
  inBy: string | null
  conditionIn: string | null
  qtyOk: number
  qtyDamaged: number
  qtyMissing: number
  qtyLost: number
  late: boolean
  notes: string
}
export interface CheckinReport {
  generatedAt: string
  items: CheckinReportItem[]
  holds: { reason: string; status: string; placedAt: string }[]
}

export function buildCheckinReport(db: DB, eventId: string): CheckinReport {
  const names = new Map(db.select({ id: users.id, n: users.displayName }).from(users).all().map((u) => [u.id, u.n]))
  const rows = db
    .select({ r: checkoutRecords, typeName: equipmentTypes.name, assetTag: equipmentUnits.assetTag })
    .from(checkoutRecords)
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, checkoutRecords.equipmentTypeId))
    .leftJoin(equipmentUnits, eq(equipmentUnits.id, checkoutRecords.unitId))
    .where(eq(checkoutRecords.eventId, eventId))
    .all()
  return {
    generatedAt: now(),
    items: rows.map(({ r, typeName, assetTag }) => ({
      recordId: r.id,
      typeName,
      assetTag,
      qty: r.qty,
      outAt: r.outAt,
      outBy: names.get(r.outBy) ?? r.outBy,
      conditionOut: r.conditionOut,
      dueAt: r.dueAt,
      inAt: r.inAt,
      inBy: r.inBy ? (names.get(r.inBy) ?? r.inBy) : null,
      conditionIn: r.conditionIn,
      qtyOk: r.qtyOk,
      qtyDamaged: r.qtyDamaged,
      qtyMissing: r.qtyMissing,
      qtyLost: r.qtyLost,
      late: r.late,
      notes: r.notes,
    })),
    holds: db
      .select()
      .from(holds)
      .where(eq(holds.eventId, eventId))
      .all()
      .map((h) => ({ reason: h.reason, status: h.status, placedAt: h.createdAt })),
  }
}

// ── Holds (F-007 §5) ─────────────────────────────────────────────────

/**
 * Places a hold: one per system reason per event (BR-007-10); re-evaluates the student's open events (BR-007-11)
 * and notifies the student and sponsor (BR-007-12). Returns the new hold, or null when a system hold already exists.
 */
export function placeHold(
  db: DB,
  h: {
    userId: string
    reason: HoldReason
    eventId: string | null
    source: "system" | "staff"
    note: string
    autoClearAt?: string | null
    actorId: string | null
  },
): HoldRow | null {
  if (h.eventId && h.reason !== "MANUAL") {
    const existing = db
      .select()
      .from(holds)
      .where(and(eq(holds.userId, h.userId), eq(holds.eventId, h.eventId), eq(holds.reason, h.reason), eq(holds.status, "active")))
      .get()
    if (existing) {
      // LATE_RETURN clears N days after the last late item comes back: extend, never shorten.
      if (existing.status === "active" && h.autoClearAt && (!existing.autoClearAt || existing.autoClearAt < h.autoClearAt))
        db.update(holds).set({ autoClearAt: h.autoClearAt }).where(eq(holds.id, existing.id)).run()
      return null
    }
  }
  const row = db
    .insert(holds)
    .values({
      userId: h.userId,
      reason: h.reason,
      eventId: h.eventId,
      source: h.source,
      note: h.note,
      autoClearAt: h.autoClearAt ?? null,
    })
    .returning()
    .get()
  audit(db, { actorId: h.actorId, action: "hold.place", entityType: "hold", entityId: row.id, after: row, reason: h.note })
  recheckEvents(db, { requesterId: h.userId })
  const ev = h.eventId ? getEvent(db, h.eventId) : undefined
  notify(db, {
    code: "HOLD_PLACED",
    to: [h.userId, ...(ev?.sponsorId ? [ev.sponsorId] : [])],
    eventId: h.eventId,
    subject: `Account hold: ${h.reason.replace("_", " ").toLowerCase()}`,
    body: `${ev ? `Event: ${ev.title}\n` : ""}${h.note}\nNew bookings are blocked until the hold is cleared by the equipment office.`,
    key: `HOLD_PLACED:${row.id}`,
  })
  return row
}

/** Clears a hold. Drops HOLD_ACTIVE review flags once none remain (BR-007-11) and tells the student (BR-007-12). */
export function clearHold(db: DB, hold: HoldRow, actorId: string | null, reason: string): void {
  const at = now()
  db.update(holds)
    .set({ status: "cleared", clearedBy: actorId, clearedReason: reason, clearedAt: at })
    .where(eq(holds.id, hold.id))
    .run()
  audit(db, {
    actorId,
    action: "hold.clear",
    entityType: "hold",
    entityId: hold.id,
    before: { status: "active" },
    after: { status: "cleared" },
    reason,
  })
  const remaining = db
    .select({ id: holds.id })
    .from(holds)
    .where(and(eq(holds.userId, hold.userId), eq(holds.status, "active")))
    .get()
  if (!remaining) {
    for (const ev of db.select().from(events).where(eq(events.requesterId, hold.userId)).all()) {
      if (!ev.reviewReasons.includes("HOLD_ACTIVE")) continue
      const reasons = ev.reviewReasons.filter((r) => r !== "HOLD_ACTIVE")
      db.update(events)
        .set({ reviewReasons: reasons, needsReview: reasons.length > 0, updatedAt: at })
        .where(eq(events.id, ev.id))
        .run()
    }
  }
  notify(db, {
    code: "HOLD_CLEARED",
    to: [hold.userId],
    eventId: hold.eventId,
    subject: "Your account hold was cleared",
    body: reason,
    key: `HOLD_CLEARED:${hold.id}`,
  })
}

// ── Post-event (F-008) ───────────────────────────────────────────────

export function packageOf(db: DB, eventId: string): PackageRow | undefined {
  return db.select().from(resultPackages).where(eq(resultPackages.eventId, eventId)).get()
}

/** BR-008-01: exactly one package per event, created when the event enters PostEvent. */
export function ensurePackage(db: DB, ev: EventRow): PackageRow {
  const existing = packageOf(db, ev.id)
  if (existing) return existing
  const type = typeOf(db, ev.eventTypeId)
  const span = eventSpan(db, ev.id)
  return db
    .insert(resultPackages)
    .values({
      eventId: ev.id,
      sponsorSignoff: type.requiresSponsorSignoff ? "pending" : "not_required",
      resultsDueAt: span && type.requiresResults ? addDaysIso(span.end, type.resultsDueDays) : null,
    })
    .returning()
    .get()
}

/** Publishes a package, notifies the audience and closes the event once check-in is complete (BR-008-08). */
export function publishPackage(db: DB, pkg: PackageRow, actorId: string | null, overrideReason: string | null): void {
  const at = now()
  const p = getPolicies(db)
  db.update(resultPackages)
    .set({
      status: "published",
      publishedAt: at,
      publishedBy: actorId,
      publishOverrideReason: overrideReason,
      retainUntil: addDaysIso(at, p.RESULTS_RETENTION_DAYS),
    })
    .where(eq(resultPackages.id, pkg.id))
    .run()
  audit(db, {
    actorId,
    action: "results.publish",
    entityType: "result_package",
    entityId: pkg.id,
    after: { status: "published" },
    reason: overrideReason ?? (actorId ? "" : "published automatically: no post-event steps required"),
  })
  const ev = getEvent(db, pkg.eventId)
  if (!ev) return
  notify(db, {
    code: "RESULTS_AVAILABLE",
    to: eventAudience(db, ev.id, ["requester", "participants", "sponsor"]),
    eventId: ev.id,
    subject: `Results available: ${ev.title}`,
    body: `${config.publicBaseUrl}/results/${ev.id}`,
    key: `RESULTS_AVAILABLE:${pkg.id}`,
  })
  if (ev.state === "PostEvent" && checkinComplete(db, ev.id)) moveEvent(db, ev, "close", actorId)
}

/**
 * Advances a PostEvent event (F-008 §3): once check-in is complete, attaches the check-in report, auto-publishes when no
 * later step is required, and closes the event when its package is published.
 */
export function advancePostEvent(db: DB, eventId: string, actorId: string | null): void {
  const ev = getEvent(db, eventId)
  if (!ev || ev.state !== "PostEvent") return
  const pkg = ensurePackage(db, ev)
  if (!checkinComplete(db, ev.id)) return
  if (pkg.checkinReport == null)
    db.update(resultPackages)
      .set({ checkinReport: buildCheckinReport(db, ev.id) })
      .where(eq(resultPackages.id, pkg.id))
      .run()
  const latest = packageOf(db, ev.id)!
  if (latest.status === "collecting") {
    const type = typeOf(db, ev.eventTypeId)
    if (!type.requiresResults && !type.requiresSponsorSignoff) publishPackage(db, latest, actorId, null)
    return
  }
  if (latest.status === "published") moveEvent(db, ev, "close", actorId)
}

/** Deletes the stored files of a package (BR-008-09). */
export function deletePackageFiles(packageId: string): void {
  rmSync(resolve(config.uploadDir, packageId), { recursive: true, force: true })
}

export function itemsOf(db: DB, packageId: string) {
  return db.select().from(resultItems).where(eq(resultItems.packageId, packageId)).orderBy(asc(resultItems.uploadedAt)).all()
}

// ── Next action (BR-006-16) ──────────────────────────────────────────

export function nextActionFor(db: DB, ev: EventRow): string | null {
  switch (ev.state) {
    case "Draft":
      return "Submit your request"
    case "Submitted":
      return "Waiting for sponsor"
    case "SponsorApproved":
      return "Waiting for studio staff to confirm"
    case "Confirmed": {
      if (ev.needsReview) return "Waiting for studio staff to review"
      const task = stagesOf(db, ev.id).find(
        (s) => s.kind === "task" && (s.status === "open" || s.status === "overdue") && s.assigneeRole === "requester",
      )
      if (task) return `Complete: ${task.name}`
      const pickup = pickupOpensAt(db, ev)
      return pickup ? `Pick up equipment from ${localLabel(pickup)}` : null
    }
    case "InProgress":
    case "PostEvent": {
      const out = recordsOf(db, ev.id).filter((r) => outstandingQty(r) > 0)
      if (out.length) return `Return equipment by ${localLabel(out.map((r) => r.dueAt).sort()[0]!)}`
      if (ev.state === "InProgress") return "Event in progress"
      const pkg = packageOf(db, ev.id)
      if (!pkg) return null
      if (typeOf(db, ev.eventTypeId).requiresResults && itemsOf(db, pkg.id).length === 0) return "Upload results"
      if (pkg.sponsorSignoff === "pending") return "Waiting for sponsor sign-off"
      return "Waiting for studio staff to publish results"
    }
    default:
      return null
  }
}

// ── Task completion (BR-005-05/06) ───────────────────────────────────

/** Assignee role, studio staff for the event's studio, or an admin may complete an open task (BR-005-06). */
export function canCompleteStage(
  user: SessionUser,
  ev: Pick<EventRow, "studioId" | "requesterId" | "sponsorId">,
  s: Pick<StageRow, "kind" | "status" | "assigneeRole">,
): boolean {
  if (s.kind !== "task" || (s.status !== "open" && s.status !== "overdue")) return false
  if (allowed(user, "stage.complete_task", ev.studioId)) return true
  if (s.assigneeRole === "requester") return ev.requesterId === user.id
  if (s.assigneeRole === "sponsor") return ev.sponsorId === user.id
  return false
}
