import {
  type DayInterval,
  type EventAction,
  type SoftPolicyCode,
  can,
  editAction,
  hasHard,
  deniedStudios,
  hasUnscoped,
  nextState,
  softCodes,
  studiosFor,
  toIntervals,
} from "@studio/domain"
import { eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  equipmentClasses,
  equipmentLines,
  equipmentTypes,
  equipmentUnits,
  eventDays,
  eventParticipants,
  eventTypes,
  events,
  holds,
  policyOverrides,
  studios,
  users,
} from "../db/schema.ts"
import type { AppEnv, SessionUser } from "../env.ts"
import { requireUser } from "../lib/auth.ts"
import { audit } from "../lib/audit.ts"
import { now } from "../lib/clock.ts"
import { badRequest, conflict, forbidden } from "../lib/errors.ts"
import { eventAudience, notify } from "../lib/notify.ts"
import type { DraftInput } from "../services/booking.ts"
import { v } from "../lib/validate.ts"
import {
  checkDraft,
  draftOf,
  hasActiveHold,
  participantIds,
} from "../services/booking.ts"
import {
  type EventRow,
  allowed,
  canCompleteStage,
  canViewEvent,
  cancelOpenStages,
  cancelScheduledReminders,
  daysOf,
  getEvent,
  isRequester,
  issuesConflict,
  moveEvent,
  nextActionFor,
  notifyTasksOpened,
  outstandingQty,
  packageOf,
  planEventStages,
  recordsOf,
  stagesOf,
  typeOf,
  visibleEvent,
} from "../services/lifecycle.ts"

// F-006 event booking and approval. Stage, checkout and results rules live in their own route files.

const EDITABLE: readonly EventRow["state"][] = [
  "Draft",
  "Submitted",
  "SponsorApproved",
  "Confirmed",
]
const CANCELLABLE: readonly EventRow["state"][] = [
  "Submitted",
  "SponsorApproved",
  "Confirmed",
]

const dayInput = z.object({
  day: z.string(),
  startTime: z.string(),
  endTime: z.string(),
})
const lineInput = z.object({
  equipmentTypeId: z.string(),
  qty: z.number().int().min(0),
})
const draftBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(""),
  eventTypeId: z.string(),
  studioId: z.string(),
  sponsorId: z.string().nullable(),
  participantIds: z.array(z.string()).default([]),
  days: z.array(dayInput),
  lines: z.array(lineInput).default([]),
})
const editBody = draftBody.extend({ justification: z.string().optional() })
const checkBody = z.object({
  eventTypeId: z.string(),
  studioId: z.string(),
  sponsorId: z.string().nullable().default(null),
  days: z.array(dayInput).default([]),
  lines: z.array(lineInput).default([]),
  excludeEventId: z.string().optional(),
})
const listQuery = z.object({
  scope: z.enum(["mine", "sponsoring", "studio", "all"]).default("mine"),
  state: z.string().optional(),
})
const submitBody = z.object({ justification: z.string().optional() })
const sponsorBody = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().default(""),
})
const staffBody = z.object({
  decision: z.enum(["approve", "confirm", "reject"]),
  note: z.string().default(""),
  overrideReason: z.string().optional(),
})
const reasonBody = z.object({ reason: z.string().default("") })

type DraftBody = z.infer<typeof draftBody>

// ── Helpers ───────────────────────────────────────────────────────────

function requireState(
  ev: EventRow,
  states: readonly EventRow["state"][]
): void {
  if (!states.includes(ev.state))
    throw conflict(
      "INVALID_STATE",
      `This action is not available while the event is ${ev.state}.`
    )
}

/** Validates references and normalises days, participants and equipment (merging duplicate types). */
function normalise(db: DB, body: DraftBody, requesterId: string) {
  const { intervals, issues } = toIntervals(body.days, config.tz)
  if (issues.length)
    throw badRequest("DAY_INVALID", issues.map((i) => i.message).join(" "), {
      issues,
    })

  const qtyByType = new Map<string, number>()
  for (const l of body.lines)
    qtyByType.set(
      l.equipmentTypeId,
      (qtyByType.get(l.equipmentTypeId) ?? 0) + l.qty
    )
  const lines = [...qtyByType]
    .filter(([, qty]) => qty > 0)
    .map(([equipmentTypeId, qty]) => ({ equipmentTypeId, qty }))
  const participants = [...new Set(body.participantIds)].filter(
    (id) => id !== requesterId && id !== body.sponsorId
  )

  if (
    !db
      .select({ id: eventTypes.id })
      .from(eventTypes)
      .where(eq(eventTypes.id, body.eventTypeId))
      .get()
  )
    throw badRequest("UNKNOWN_EVENT_TYPE", "Unknown event type.")
  if (
    !db
      .select({ id: studios.id })
      .from(studios)
      .where(eq(studios.id, body.studioId))
      .get()
  )
    throw badRequest("UNKNOWN_STUDIO", "Unknown studio.")
  if (
    body.sponsorId &&
    !db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, body.sponsorId))
      .get()
  )
    throw badRequest("UNKNOWN_SPONSOR", "Unknown sponsor.")
  if (participants.length) {
    const found = db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, participants))
      .all()
    if (found.length !== participants.length)
      throw badRequest("UNKNOWN_PARTICIPANT", "Unknown participant.")
  }
  if (lines.length) {
    const found = db
      .select({ id: equipmentTypes.id })
      .from(equipmentTypes)
      .where(
        inArray(
          equipmentTypes.id,
          lines.map((l) => l.equipmentTypeId)
        )
      )
      .all()
    if (found.length !== lines.length)
      throw badRequest("UNKNOWN_EQUIPMENT", "Unknown equipment type.")
  }
  return { intervals, lines, participants }
}

function draftInput(
  requesterId: string,
  body: DraftBody,
  lines: { equipmentTypeId: string; qty: number }[]
): DraftInput {
  return {
    requesterId,
    sponsorId: body.sponsorId,
    eventTypeId: body.eventTypeId,
    studioId: body.studioId,
    days: body.days,
    lines,
  }
}

/**
 * Replaces days, equipment lines and participants (F-006 §6). Day rows are reused in date order so
 * their ids, and the calendar UIDs built from them, survive an edit (BR-009-01).
 */
function writeRows(
  db: DB,
  eventId: string,
  intervals: readonly DayInterval[],
  lines: readonly { equipmentTypeId: string; qty: number }[],
  participants: readonly string[]
): void {
  const existing = daysOf(db, eventId)
  const wanted = [...intervals].sort((a, b) => a.day.localeCompare(b.day))
  wanted.forEach((d, i) => {
    const row = {
      day: d.day,
      startTime: d.startTime,
      endTime: d.endTime,
      startsAt: d.start,
      endsAt: d.end,
    }
    const keep = existing[i]
    if (keep)
      db.update(eventDays).set(row).where(eq(eventDays.id, keep.id)).run()
    else
      db.insert(eventDays)
        .values({ ...row, eventId })
        .run()
  })
  const surplus = existing.slice(wanted.length).map((d) => d.id)
  if (surplus.length)
    db.delete(eventDays).where(inArray(eventDays.id, surplus)).run()
  db.delete(equipmentLines).where(eq(equipmentLines.eventId, eventId)).run()
  db.delete(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId))
    .run()
  if (lines.length)
    db.insert(equipmentLines)
      .values(lines.map((l) => ({ ...l, eventId })))
      .run()
  if (participants.length)
    db.insert(eventParticipants)
      .values(participants.map((userId) => ({ eventId, userId })))
      .run()
}

function dayKey(
  days: readonly { day: string; startTime: string; endTime: string }[]
): string {
  return days.map((d) => `${d.day} ${d.startTime}-${d.endTime}`).join("|")
}

interface Lookups {
  users: Map<string, { id: string; displayName: string }>
  studios: Map<string, { id: string; name: string }>
  types: Map<string, { id: string; name: string }>
}

function lookupsOf(db: DB): Lookups {
  return {
    users: new Map(
      db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .all()
        .map((u) => [u.id, u])
    ),
    studios: new Map(
      db
        .select({ id: studios.id, name: studios.name })
        .from(studios)
        .all()
        .map((s) => [s.id, s])
    ),
    types: new Map(
      db
        .select({ id: eventTypes.id, name: eventTypes.name })
        .from(eventTypes)
        .all()
        .map((t) => [t.id, t])
    ),
  }
}

/** Row shape for the event list (BR-006-16). */
function summaryOf(db: DB, ev: EventRow, look: Lookups) {
  const requester = look.users.get(ev.requesterId)!
  const sponsor = ev.sponsorId ? look.users.get(ev.sponsorId)! : null
  return {
    id: ev.id,
    title: ev.title,
    state: ev.state,
    needsReview: ev.needsReview,
    reviewReasons: ev.reviewReasons,
    overrideRequested: ev.overrideRequested,
    eventType: {
      id: ev.eventTypeId,
      name: look.types.get(ev.eventTypeId)?.name ?? "",
    },
    studio: {
      id: ev.studioId,
      name: look.studios.get(ev.studioId)?.name ?? "",
    },
    requester: { id: requester.id, displayName: requester.displayName },
    sponsor: sponsor
      ? { id: sponsor.id, displayName: sponsor.displayName }
      : null,
    days: daysOf(db, ev.id).map((d) => ({
      day: d.day,
      startTime: d.startTime,
      endTime: d.endTime,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
    })),
    nextAction: nextActionFor(db, ev),
  }
}

/** Full detail for an event the caller may see, with the UI permission flags (`can`). */
function detailOf(db: DB, user: SessionUser, ev: EventRow) {
  const look = lookupsOf(db)
  const type = typeOf(db, ev.eventTypeId)
  const studio = db
    .select()
    .from(studios)
    .where(eq(studios.id, ev.studioId))
    .get()!
  const pkg = packageOf(db, ev.id)
  const stages = stagesOf(db, ev.id)
  const records = recordsOf(db, ev.id)
  const mine = isRequester(user, ev)
  const isSponsor = ev.sponsorId === user.id

  const lines = db
    .select({
      id: equipmentLines.id,
      equipmentTypeId: equipmentLines.equipmentTypeId,
      typeName: equipmentTypes.name,
      tracking: equipmentTypes.tracking,
      className: equipmentClasses.name,
      qty: equipmentLines.qty,
      note: equipmentLines.note,
    })
    .from(equipmentLines)
    .innerJoin(
      equipmentTypes,
      eq(equipmentTypes.id, equipmentLines.equipmentTypeId)
    )
    .innerJoin(
      equipmentClasses,
      eq(equipmentClasses.id, equipmentTypes.classId)
    )
    .where(eq(equipmentLines.eventId, ev.id))
    .all()
  const typeNames = new Map(lines.map((l) => [l.equipmentTypeId, l.typeName]))
  // Asset tags are for the desk and inventory staff only (F-001 §3 note 3).
  const seesTags =
    can(user, "checkout.perform", { studioId: ev.studioId }) ||
    can(user, "inventory.manage")
  const unitIds = seesTags
    ? records.flatMap((r) => (r.unitId ? [r.unitId] : []))
    : []
  const assetTags = new Map(
    unitIds.length
      ? db
          .select({ id: equipmentUnits.id, assetTag: equipmentUnits.assetTag })
          .from(equipmentUnits)
          .where(inArray(equipmentUnits.id, unitIds))
          .all()
          .map((u) => [u.id, u.assetTag])
      : []
  )

  const holdRows = can(user, "hold.view", { own: mine, studioId: ev.studioId })
    ? db.select().from(holds).where(eq(holds.eventId, ev.id)).all()
    : []
  const overrides = can(user, "event.override_policy", {
    studioId: ev.studioId,
  })
    ? db
        .select()
        .from(policyOverrides)
        .where(eq(policyOverrides.eventId, ev.id))
        .all()
    : []
  const outstanding = records.filter((r) => outstandingQty(r) > 0)
  const collecting = pkg?.status === "collecting"

  return {
    id: ev.id,
    title: ev.title,
    description: ev.description,
    state: ev.state,
    sequence: ev.sequence,
    needsReview: ev.needsReview,
    reviewReasons: ev.reviewReasons,
    overrideRequested: ev.overrideRequested,
    overrideJustification: ev.overrideJustification,
    decisionNote: ev.decisionNote,
    cancelReason: ev.cancelReason,
    submittedAt: ev.submittedAt,
    sponsorDecidedAt: ev.sponsorDecidedAt,
    staffDecidedAt: ev.staffDecidedAt,
    eventType: {
      id: type.id,
      name: type.name,
      pickupWindowMinutes: type.pickupWindowMinutes,
      checkinGraceMinutes: type.checkinGraceMinutes,
      requiresResults: type.requiresResults,
      requiresSponsorSignoff: type.requiresSponsorSignoff,
      requesterCanUpload: type.requesterCanUpload,
    },
    studio: { id: studio.id, name: studio.name, location: studio.location },
    requester: look.users.get(ev.requesterId)!,
    sponsor: ev.sponsorId ? look.users.get(ev.sponsorId)! : null,
    participants: participantIds(db, ev.id)
      .map((id) => look.users.get(id))
      .filter((u): u is { id: string; displayName: string } => !!u),
    days: daysOf(db, ev.id).map((d) => ({
      day: d.day,
      startTime: d.startTime,
      endTime: d.endTime,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
    })),
    lines: lines.map((l) => ({
      id: l.id,
      equipmentTypeId: l.equipmentTypeId,
      typeName: l.typeName,
      tracking: l.tracking,
      className: l.className,
      qty: l.qty,
      note: l.note,
    })),
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      dueAt: s.dueAt,
      status: s.status,
      blocksCheckout: s.blocksCheckout,
      assigneeRole: s.assigneeRole,
      completedAt: s.completedAt,
      overrideReason: s.overrideReason,
    })),
    checkouts: records.map((r) => ({
      id: r.id,
      equipmentLineId: r.equipmentLineId,
      typeName: typeNames.get(r.equipmentTypeId) ?? "",
      unitId: r.unitId,
      assetTag: r.unitId ? (assetTags.get(r.unitId) ?? null) : null,
      qty: r.qty,
      outAt: r.outAt,
      dueAt: r.dueAt,
      inAt: r.inAt,
      conditionIn: r.conditionIn,
      qtyOk: r.qtyOk,
      qtyDamaged: r.qtyDamaged,
      qtyMissing: r.qtyMissing,
      qtyLost: r.qtyLost,
      outstanding: outstandingQty(r),
      late: r.late,
    })),
    holds: holdRows.map((h) => ({
      id: h.id,
      userId: h.userId,
      reason: h.reason,
      status: h.status,
      note: h.note,
      autoClearAt: h.autoClearAt,
      createdAt: h.createdAt,
    })),
    policyOverrides: overrides.map((o) => ({
      id: o.id,
      ruleCode: o.ruleCode,
      actorId: o.actorId,
      reason: o.reason,
      at: o.at,
    })),
    resultPackage: pkg ? { id: pkg.id, status: pkg.status } : null,
    nextAction: nextActionFor(db, ev),
    can: {
      edit:
        EDITABLE.includes(ev.state) &&
        allowed(user, "event.edit", ev.studioId, mine),
      submit: ev.state === "Draft" && mine,
      cancel:
        CANCELLABLE.includes(ev.state) &&
        allowed(user, "event.cancel", ev.studioId, mine || isSponsor),
      sponsorDecide:
        ev.state === "Submitted" &&
        isSponsor &&
        !mine &&
        allowed(user, "event.sponsor_decide", ev.studioId, true),
      staffDecide:
        ev.state === "SponsorApproved" &&
        !mine &&
        allowed(user, "event.staff_decide", ev.studioId),
      resolveReview:
        ev.needsReview &&
        !mine &&
        allowed(user, "event.staff_decide", ev.studioId),
      checkout:
        ev.state === "Confirmed" &&
        allowed(user, "checkout.perform", ev.studioId),
      checkin:
        (ev.state === "InProgress" || ev.state === "PostEvent") &&
        outstanding.length > 0 &&
        allowed(user, "checkout.perform", ev.studioId),
      uploadResults:
        collecting &&
        (allowed(user, "results.upload", ev.studioId) ||
          (mine && type.requesterCanUpload)),
      publishResults:
        collecting && allowed(user, "results.upload", ev.studioId),
      signoff:
        pkg?.sponsorSignoff === "pending" &&
        isSponsor &&
        type.requiresSponsorSignoff,
      completeTask: stages
        .filter((s) => canCompleteStage(user, ev, s))
        .map((s) => s.id),
      overrideTask: stages
        .filter(
          (s) =>
            s.kind === "task" &&
            s.blocksCheckout &&
            (s.status === "open" || s.status === "overdue") &&
            allowed(user, "stage.override_block", ev.studioId)
        )
        .map((s) => s.id),
    },
  }
}

/** Notifies the whole event audience after a change (BR-006-11, F-010 EVENT_CHANGED). */
function notifyChanged(db: DB, ev: EventRow, before: EventRow["state"]): void {
  notify(db, {
    code: "EVENT_CHANGED",
    to: eventAudience(db, ev.id, [
      "requester",
      "participants",
      "sponsor",
      "studio_staff",
    ]),
    eventId: ev.id,
    subject: `Changed: ${ev.title}`,
    body:
      before === ev.state
        ? "The request was changed."
        : `The request was changed and is now ${ev.state}.`,
    key: `EVENT_CHANGED:${ev.id}:${ev.sequence}`,
  })
}

// ── Routes ────────────────────────────────────────────────────────────

export const routes = new Hono<AppEnv>()
  .get("/", v("query", listQuery), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const q = c.req.valid("query")
    let candidates: EventRow[]
    if (q.scope === "all") {
      if (!hasUnscoped(user, "event.view")) throw forbidden()
      const excluded = deniedStudios(user, "event.view")
      candidates = db
        .select()
        .from(events)
        .all()
        .filter((e) => !excluded.includes(e.studioId))
    } else if (q.scope === "sponsoring") {
      candidates = db
        .select()
        .from(events)
        .where(eq(events.sponsorId, user.id))
        .all()
    } else if (q.scope === "studio") {
      // Admins hold event.view everywhere, so their queue covers every studio (BR-006-09).
      const ids = studiosFor(user, "event.view")
      if (hasUnscoped(user, "event.view")) {
        const excluded = deniedStudios(user, "event.view")
        candidates = db
          .select()
          .from(events)
          .all()
          .filter((e) => !excluded.includes(e.studioId))
      } else
        candidates = ids.length
          ? db.select().from(events).where(inArray(events.studioId, ids)).all()
          : []
    } else {
      const partOf = new Set(
        db
          .select({ eventId: eventParticipants.eventId })
          .from(eventParticipants)
          .where(eq(eventParticipants.userId, user.id))
          .all()
          .map((r) => r.eventId)
      )
      candidates = db
        .select()
        .from(events)
        .all()
        .filter((e) => e.requesterId === user.id || partOf.has(e.id))
    }
    const look = lookupsOf(db)
    const rows = candidates
      .filter(
        (e) =>
          (q.state ? e.state === q.state : true) && canViewEvent(db, user, e)
      )
      .map((e) => summaryOf(db, e, look))
      .sort((a, b) =>
        (a.days[0]?.startsAt ?? "").localeCompare(b.days[0]?.startsAt ?? "")
      )
    return c.json(rows)
  })
  .post("/check", v("json", checkBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const requesterId = body.excludeEventId
      ? visibleEvent(db, user, body.excludeEventId).requesterId
      : user.id
    const issues = checkDraft(
      db,
      {
        requesterId,
        sponsorId: body.sponsorId,
        eventTypeId: body.eventTypeId,
        studioId: body.studioId,
        days: body.days,
        lines: body.lines.filter((l) => l.qty > 0),
      },
      body.excludeEventId
    )
    return c.json({ issues })
  })
  .post("/", v("json", draftBody), (c) => {
    const user = requireUser(c)
    if (!allowed(user, "event.create", null, true)) throw forbidden()
    const db = c.var.db
    const body = c.req.valid("json")
    const { intervals, lines, participants } = normalise(db, body, user.id)
    const id = db.transaction(() => {
      const ev = db
        .insert(events)
        .values({
          title: body.title,
          description: body.description,
          eventTypeId: body.eventTypeId,
          studioId: body.studioId,
          requesterId: user.id,
          sponsorId: body.sponsorId,
          state: "Draft",
        })
        .returning()
        .get()
      writeRows(db, ev.id, intervals, lines, participants)
      audit(db, {
        actorId: user.id,
        action: "event.create",
        entityType: "event",
        entityId: ev.id,
        after: { title: ev.title, state: "Draft" },
      })
      return ev.id
    })
    return c.json(detailOf(db, user, getEvent(db, id)!), 201)
  })
  .get("/:id", (c) => {
    const user = requireUser(c)
    const db = c.var.db
    return c.json(detailOf(db, user, visibleEvent(db, user, c.req.param("id"))))
  })
  .put("/:id", v("json", editBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const ev = visibleEvent(db, user, c.req.param("id"))
    if (!allowed(user, "event.edit", ev.studioId, isRequester(user, ev)))
      throw forbidden()
    requireState(ev, EDITABLE)
    // Staff may only move a request into a studio they also cover.
    if (
      body.studioId !== ev.studioId &&
      !allowed(user, "event.edit", body.studioId, isRequester(user, ev))
    )
      throw forbidden()
    const { intervals, lines, participants } = normalise(
      db,
      body,
      ev.requesterId
    )
    const patch = {
      title: body.title,
      description: body.description,
      eventTypeId: body.eventTypeId,
      studioId: body.studioId,
      sponsorId: body.sponsorId,
    }

    if (ev.state === "Draft") {
      const out = db.transaction(() => {
        db.update(events)
          .set({ ...patch, updatedAt: now() })
          .where(eq(events.id, ev.id))
          .run()
        writeRows(db, ev.id, intervals, lines, participants)
        audit(db, {
          actorId: user.id,
          action: "event.edit",
          entityType: "event",
          entityId: ev.id,
          before: { state: "Draft" },
        })
        return detailOf(db, user, getEvent(db, ev.id)!)
      })
      return c.json(out)
    }

    // BR-006-11: classify the change against the stored request.
    const old = draftOf(db, ev.id)
    const oldQty = new Map<string, number>()
    for (const l of old.lines)
      oldQty.set(
        l.equipmentTypeId,
        (oldQty.get(l.equipmentTypeId) ?? 0) + l.qty
      )
    const action: EventAction | null = editAction({
      sponsorChanged: (old.sponsorId ?? null) !== (body.sponsorId ?? null),
      typeChanged: old.eventTypeId !== body.eventTypeId,
      studioChanged: old.studioId !== body.studioId,
      daysChanged: dayKey(old.days) !== dayKey(intervals),
      equipmentIncreased: lines.some(
        (l) => l.qty > (oldQty.get(l.equipmentTypeId) ?? 0)
      ),
    })
    const target = action ? nextState(ev.state, action) : ev.state
    if (!target)
      throw conflict(
        "INVALID_TRANSITION",
        `Cannot change an event that is ${ev.state}.`
      )

    const out = db.transaction(() => {
      const issues = checkDraft(
        db,
        draftInput(ev.requesterId, body, lines),
        ev.id
      )
      if (hasHard(issues)) throw issuesConflict(issues)
      const soft = softCodes(issues)
      const justification = body.justification?.trim() ?? ""
      if (soft.length && !justification) throw issuesConflict(issues)
      // A request sent back for approval gets a fresh decision clock (BR-006-11); the staff clock runs from sponsorDecidedAt.
      const clock =
        action === "change_approval"
          ? { submittedAt: now(), sponsorDecidedAt: null }
          : action && target === "SponsorApproved"
            ? { sponsorDecidedAt: now() }
            : {}
      const fields = {
        ...patch,
        ...clock,
        overrideRequested: soft,
        overrideJustification: soft.length ? justification : "",
        needsReview: false,
        reviewReasons: [],
      }
      let updated: EventRow
      if (action)
        updated = moveEvent(db, ev, action, user.id, fields, "request changed")
      else {
        updated = db
          .update(events)
          .set({ ...fields, sequence: ev.sequence + 1, updatedAt: now() })
          .where(eq(events.id, ev.id))
          .returning()
          .get()
        audit(db, {
          actorId: user.id,
          action: "event.edit",
          entityType: "event",
          entityId: ev.id,
          before: { state: ev.state },
          after: { state: updated.state },
        })
      }
      writeRows(db, ev.id, intervals, lines, participants)
      if (ev.state === "Confirmed" && updated.state !== "Confirmed")
        cancelScheduledReminders(db, ev.id)
      notifyChanged(db, updated, ev.state)
      return detailOf(db, user, updated)
    })
    return c.json(out)
  })
  .delete("/:id", (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const ev = visibleEvent(db, user, c.req.param("id"))
    if (!isRequester(user, ev)) throw forbidden()
    requireState(ev, ["Draft"])
    db.transaction(() => {
      db.delete(events).where(eq(events.id, ev.id)).run()
      audit(db, {
        actorId: user.id,
        action: "event.delete",
        entityType: "event",
        entityId: ev.id,
        before: { title: ev.title },
      })
    })
    return c.json({ ok: true as const })
  })
  .post("/:id/submit", v("json", submitBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const ev = visibleEvent(db, user, c.req.param("id"))
    if (!isRequester(user, ev)) throw forbidden()
    const out = db.transaction(() => {
      // BR-006-04: the checks and the state change share one transaction.
      const current = getEvent(db, ev.id)!
      requireState(current, ["Draft"])
      const issues = checkDraft(db, draftOf(db, ev.id), ev.id)
      if (hasHard(issues)) throw issuesConflict(issues)
      const soft = softCodes(issues)
      const justification = body.justification?.trim() ?? ""
      if (soft.length && !justification) throw issuesConflict(issues)
      const updated = moveEvent(db, current, "submit", user.id, {
        submittedAt: now(),
        overrideRequested: soft,
        overrideJustification: soft.length ? justification : "",
      })
      notify(db, {
        code: "EVENT_SUBMITTED",
        to: [current.requesterId],
        eventId: current.id,
        subject: `Request submitted: ${current.title}`,
        body: "Your request has been sent to the sponsor for approval.",
        key: `EVENT_SUBMITTED:${current.id}:requester`,
      })
      notify(db, {
        code: "EVENT_SUBMITTED",
        to: current.sponsorId ? [current.sponsorId] : [],
        eventId: current.id,
        subject: `Approval needed: ${current.title}`,
        body: soft.length
          ? `Justification given for: ${soft.join(", ")}.\n${justification}`
          : "Please approve or reject this request.",
        key: `EVENT_SUBMITTED:${current.id}:sponsor`,
      })
      return detailOf(db, user, updated)
    })
    return c.json(out)
  })
  .post("/:id/sponsor-decision", v("json", sponsorBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const ev = visibleEvent(db, user, c.req.param("id"))
    if (ev.sponsorId !== user.id || isRequester(user, ev))
      throw forbidden("Only the sponsor can decide on this request.")
    if (!allowed(user, "event.sponsor_decide", ev.studioId, true))
      throw forbidden()
    const note = body.note.trim()
    const out = db.transaction(() => {
      const current = getEvent(db, ev.id)!
      requireState(current, ["Submitted"])
      if (body.decision === "approve") {
        // BR-006-03: hard checks run again on approval.
        const issues = checkDraft(db, draftOf(db, current.id), current.id)
        if (hasHard(issues)) throw issuesConflict(issues)
        const updated = moveEvent(db, current, "sponsor_approve", user.id, {
          sponsorDecidedAt: now(),
          decisionNote: note,
        })
        notify(db, {
          code: "EVENT_SPONSOR_APPROVED",
          to: eventAudience(db, current.id, ["requester"]),
          eventId: current.id,
          subject: `Sponsor approved: ${current.title}`,
          body: note || "Waiting for studio staff to confirm.",
          key: `EVENT_SPONSOR_APPROVED:${current.id}:requester`,
        })
        notify(db, {
          code: "EVENT_SPONSOR_APPROVED",
          to: eventAudience(db, current.id, ["studio_staff"]),
          eventId: current.id,
          subject: `Confirmation needed: ${current.title}`,
          body: "The sponsor has approved this request.",
          key: `EVENT_SPONSOR_APPROVED:${current.id}:staff`,
        })
        return detailOf(db, user, updated)
      }
      if (!note)
        throw badRequest(
          "NOTE_REQUIRED",
          "A reason is required to reject a request."
        )
      const updated = moveEvent(
        db,
        current,
        "sponsor_reject",
        user.id,
        { sponsorDecidedAt: now(), decisionNote: note },
        note
      )
      notify(db, {
        code: "EVENT_REJECTED",
        to: eventAudience(db, current.id, ["requester", "sponsor"]),
        eventId: current.id,
        subject: `Rejected: ${current.title}`,
        body: note,
        key: `EVENT_REJECTED:${current.id}`,
      })
      return detailOf(db, user, updated)
    })
    return c.json(out)
  })
  .post("/:id/staff-decision", v("json", staffBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const ev = visibleEvent(db, user, c.req.param("id"))
    if (isRequester(user, ev))
      throw forbidden("You cannot decide on your own request.")
    if (!allowed(user, "event.staff_decide", ev.studioId)) throw forbidden()
    const note = body.note.trim()
    const out = db.transaction(() => {
      const current = getEvent(db, ev.id)!
      requireState(current, ["SponsorApproved"])
      if (body.decision === "reject") {
        if (!note)
          throw badRequest(
            "NOTE_REQUIRED",
            "A reason is required to reject a request."
          )
        const updated = moveEvent(
          db,
          current,
          "staff_reject",
          user.id,
          { staffDecidedAt: now(), decisionNote: note },
          note
        )
        notify(db, {
          code: "EVENT_REJECTED",
          to: eventAudience(db, current.id, ["requester", "sponsor"]),
          eventId: current.id,
          subject: `Rejected: ${current.title}`,
          body: note,
          key: `EVENT_REJECTED:${current.id}`,
        })
        return detailOf(db, user, updated)
      }

      // BR-006-06: hard rules block; soft rules need a reason recorded as a policy override.
      const issues = checkDraft(db, draftOf(db, current.id), current.id)
      if (hasHard(issues)) throw issuesConflict(issues)
      const needed = [
        ...new Set<SoftPolicyCode>([
          ...current.overrideRequested,
          ...softCodes(issues),
        ]),
      ]
      const reason = body.overrideReason?.trim() ?? ""
      if (needed.length && !reason)
        throw conflict(
          "OVERRIDE_REASON_REQUIRED",
          "Give a reason to approve the requested policy overrides.",
          {
            codes: needed,
          }
        )
      for (const code of needed) {
        db.insert(policyOverrides)
          .values({
            eventId: current.id,
            ruleCode: code,
            actorId: user.id,
            reason,
          })
          .run()
        audit(db, {
          actorId: user.id,
          action: "policy.override",
          entityType: "event",
          entityId: current.id,
          after: { rule: code },
          reason,
        })
      }
      const updated = moveEvent(
        db,
        current,
        "staff_confirm",
        user.id,
        {
          staffDecidedAt: now(),
          decisionNote: note,
          needsReview: false,
          reviewReasons: [],
        },
        reason
      )
      notifyTasksOpened(db, updated, planEventStages(db, updated))
      notify(db, {
        code: "EVENT_CONFIRMED",
        to: eventAudience(db, current.id, [
          "requester",
          "participants",
          "sponsor",
        ]),
        eventId: current.id,
        subject: `Confirmed: ${current.title}`,
        body: note || "Your studio booking is confirmed.",
        key: `EVENT_CONFIRMED:${current.id}:${updated.sequence}`,
      })
      return detailOf(db, user, updated)
    })
    return c.json(out)
  })
  .post("/:id/cancel", v("json", reasonBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const ev = visibleEvent(db, user, c.req.param("id"))
    const own = isRequester(user, ev) || ev.sponsorId === user.id
    if (!allowed(user, "event.cancel", ev.studioId, own)) throw forbidden()
    const reason = body.reason.trim()
    if (!own && !reason)
      throw badRequest(
        "REASON_REQUIRED",
        "A reason is required to cancel as staff."
      )
    const out = db.transaction(() => {
      const current = getEvent(db, ev.id)!
      requireState(current, CANCELLABLE)
      const updated = moveEvent(
        db,
        current,
        "cancel",
        user.id,
        { cancelReason: reason },
        reason
      )
      cancelOpenStages(db, current.id)
      notify(db, {
        code: "EVENT_CANCELLED",
        to: eventAudience(db, current.id, [
          "requester",
          "participants",
          "sponsor",
          "studio_staff",
        ]),
        eventId: current.id,
        subject: `Cancelled: ${current.title}`,
        body: reason || "The request was cancelled.",
        key: `EVENT_CANCELLED:${current.id}`,
      })
      return detailOf(db, user, updated)
    })
    return c.json(out)
  })
  .post("/:id/resolve-review", v("json", reasonBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const ev = visibleEvent(db, user, c.req.param("id"))
    if (isRequester(user, ev))
      throw forbidden("You cannot resolve a review on your own request.")
    if (!allowed(user, "event.staff_decide", ev.studioId)) throw forbidden()
    if (!ev.needsReview)
      throw conflict("NOT_FLAGGED", "This request has no review flag.")
    const reason = body.reason.trim()
    if (!reason)
      throw badRequest(
        "REASON_REQUIRED",
        "A reason is required to accept the request as-is."
      )
    if (
      ev.reviewReasons.includes("HOLD_ACTIVE") &&
      hasActiveHold(db, ev.requesterId)
    )
      throw conflict(
        "HOLD_ACTIVE",
        "The requester still has an active hold. Clear the hold or cancel the request."
      )
    const out = db.transaction(() => {
      db.update(events)
        .set({ needsReview: false, reviewReasons: [], updatedAt: now() })
        .where(eq(events.id, ev.id))
        .run()
      audit(db, {
        actorId: user.id,
        action: "event.resolve_review",
        entityType: "event",
        entityId: ev.id,
        before: { reviewReasons: ev.reviewReasons },
        after: { reviewReasons: [] },
        reason,
      })
      return detailOf(db, user, getEvent(db, ev.id)!)
    })
    return c.json(out)
  })
