import {
  type DayInput,
  type EventState,
  type GrantLike,
  HOLDS_STOCK,
  HOLDS_STUDIO,
  type Interval,
  type Issue,
  OPEN_END,
  type PermissionContext,
  type Reservation,
  type SubmissionContext,
  bulkCapacity,
  eventWindow,
  hoursBetween,
  isoWeekKey,
  reservedQty,
  serializedCapacity,
  toIntervals,
  validateSubmission,
} from "@studio/domain"
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  blackouts,
  bulkStock,
  checkoutRecords,
  equipmentClasses,
  equipmentLines,
  equipmentTypes,
  equipmentUnits,
  eventDays,
  eventParticipants,
  eventTypeStudios,
  eventTypes,
  events,
  holds,
  levelGrants,
  levels,
  openingHours,
  roleAssignments,
  studios,
  users,
} from "../db/schema.ts"
import type { SessionUser } from "../env.ts"
import { now } from "../lib/clock.ts"
import { badRequest } from "../lib/errors.ts"
import { getPolicies } from "./policy.ts"

// Loads everything the pure domain checks (packages/domain/src/validation.ts) need.

export interface DraftInput {
  requesterId: string
  sponsorId: string | null
  eventTypeId: string
  studioId: string
  days: DayInput[]
  lines: { equipmentTypeId: string; qty: number }[]
}

/** Permission context for an event (F-001): own = requester, sponsor, or participant. */
export function eventAccess(
  user: SessionUser,
  ev: { requesterId: string; sponsorId: string | null; studioId: string },
  participantIds: readonly string[]
): PermissionContext {
  return {
    own:
      ev.requesterId === user.id ||
      ev.sponsorId === user.id ||
      participantIds.includes(user.id),
    studioId: ev.studioId,
  }
}

export async function grantsFor(db: DB, userId: string): Promise<GrantLike[]> {
  return db
    .select({
      levelRank: levels.rank,
      validFrom: levelGrants.validFrom,
      validUntil: levelGrants.validUntil,
      revokedOn: levelGrants.revokedOn,
    })
    .from(levelGrants)
    .innerJoin(levels, eq(levels.id, levelGrants.levelId))
    .where(eq(levelGrants.userId, userId))
    .all()
}

export async function hasActiveHold(db: DB, userId: string): Promise<boolean> {
  return !!(await db
    .select({ id: holds.id })
    .from(holds)
    .where(and(eq(holds.userId, userId), eq(holds.status, "active")))
    .get())
}

async function daysByEvent(
  db: DB,
  eventIds: string[]
): Promise<Map<string, Interval[]>> {
  const out = new Map<string, Interval[]>()
  if (eventIds.length === 0) return out
  const rows = await db
    .select()
    .from(eventDays)
    .where(inArray(eventDays.eventId, eventIds))
    .orderBy(eventDays.day)
    .all()
  for (const r of rows) {
    const list = out.get(r.eventId) ?? []
    list.push({ start: r.startsAt, end: r.endsAt })
    out.set(r.eventId, list)
  }
  return out
}

/**
 * Equipment reservations (F-003 §4): lines of events holding stock, plus items still out after an event ended
 * (late returns), which block the type until returned.
 */
export async function reservationsFor(
  db: DB,
  typeIds: readonly string[],
  opts: { excludeEventId?: string; createdBefore?: string } = {}
): Promise<Reservation[]> {
  if (typeIds.length === 0) return []
  const lineRows = (
    await db
      .select({
        eventId: events.id,
        createdAt: events.createdAt,
        typeId: equipmentLines.equipmentTypeId,
        qty: equipmentLines.qty,
        daily: eventTypes.dailyEquipmentReturn,
      })
      .from(equipmentLines)
      .innerJoin(events, eq(events.id, equipmentLines.eventId))
      .innerJoin(eventTypes, eq(eventTypes.id, events.eventTypeId))
      .where(
        and(
          inArray(equipmentLines.equipmentTypeId, [...typeIds]),
          inArray(events.state, [...HOLDS_STOCK])
        )
      )
      .all()
  ).filter(
    (r) =>
      r.eventId !== opts.excludeEventId &&
      (opts.createdBefore === undefined || r.createdAt < opts.createdBefore)
  )
  const days = await daysByEvent(db, [
    ...new Set(lineRows.map((r) => r.eventId)),
  ])
  const out: Reservation[] = []
  for (const r of lineRows) {
    const d = days.get(r.eventId)
    if (!d || d.length === 0) continue
    const windows = r.daily ? d : [eventWindow(d)]
    for (const window of windows)
      out.push({
        equipmentTypeId: r.typeId,
        qty: r.qty,
        window,
        eventId: r.eventId,
      })
  }

  // Outstanding checkouts of events that already ended.
  const outstanding = await db
    .select({
      eventId: checkoutRecords.eventId,
      typeId: checkoutRecords.equipmentTypeId,
      qty: checkoutRecords.qty,
      outAt: checkoutRecords.outAt,
    })
    .from(checkoutRecords)
    .innerJoin(events, eq(events.id, checkoutRecords.eventId))
    .where(
      and(
        inArray(checkoutRecords.equipmentTypeId, [...typeIds]),
        isNull(checkoutRecords.inAt),
        eq(events.state, "PostEvent")
      )
    )
    .all()
  for (const r of outstanding) {
    if (r.eventId === opts.excludeEventId) continue
    out.push({
      equipmentTypeId: r.typeId,
      qty: r.qty,
      window: { start: r.outAt, end: OPEN_END },
      eventId: r.eventId,
    })
  }
  return out
}

/** Bookable capacity of a type for a window starting on `windowStartDay` (F-003 §3 table). */
export async function capacityOf(
  db: DB,
  typeId: string,
  tracking: "serialized" | "bulk",
  windowStartDay: string
): Promise<number> {
  if (tracking === "bulk") {
    const s = await db
      .select()
      .from(bulkStock)
      .where(eq(bulkStock.typeId, typeId))
      .get()
    return s ? bulkCapacity(s) : 0
  }
  const units = await db
    .select({
      status: equipmentUnits.status,
      expectedBack: equipmentUnits.expectedBack,
    })
    .from(equipmentUnits)
    .where(eq(equipmentUnits.typeId, typeId))
    .all()
  return serializedCapacity(units, windowStartDay)
}

/** Units of each type still bookable for `window`, after other events' reservations. */
export async function availability(
  db: DB,
  typeIds: readonly string[],
  window: Interval,
  windowStartDay: string,
  opts: { excludeEventId?: string; createdBefore?: string } = {}
): Promise<Map<string, number>> {
  const types = typeIds.length
    ? await db
        .select()
        .from(equipmentTypes)
        .where(inArray(equipmentTypes.id, [...typeIds]))
        .all()
    : []
  const res = await reservationsFor(db, typeIds, opts)
  const out = new Map<string, number>()
  for (const t of types) {
    out.set(
      t.id,
      (await capacityOf(db, t.id, t.tracking, windowStartDay)) -
        reservedQty(res, t.id, window)
    )
  }
  return out
}

/** Builds the submission context for a draft (F-006 §5). */
export async function buildSubmissionContext(
  db: DB,
  input: DraftInput,
  opts: { excludeEventId?: string; createdBefore?: string } = {}
): Promise<SubmissionContext> {
  const p = await getPolicies(db)
  const type = await db
    .select()
    .from(eventTypes)
    .where(eq(eventTypes.id, input.eventTypeId))
    .get()
  if (!type) throw badRequest("UNKNOWN_EVENT_TYPE", "Unknown event type.")
  const studioRow = await db
    .select({ s: studios, level: levels })
    .from(studios)
    .innerJoin(levels, eq(levels.id, studios.minLevelId))
    .where(eq(studios.id, input.studioId))
    .get()
  if (!studioRow) throw badRequest("UNKNOWN_STUDIO", "Unknown studio.")
  const allowedStudioIds = (
    await db
      .select({ id: eventTypeStudios.studioId })
      .from(eventTypeStudios)
      .where(eq(eventTypeStudios.eventTypeId, type.id))
      .all()
  ).map((r) => r.id)

  const sponsor = input.sponsorId
    ? await db.select().from(users).where(eq(users.id, input.sponsorId)).get()
    : undefined
  const sponsorIsSponsor = sponsor
    ? !!(await db
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, sponsor.id),
            inArray(roleAssignments.role, ["SPONSOR", "ADMIN"])
          )
        )
        .get())
    : false

  // Other events holding this studio.
  const busyIds = (
    await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.studioId, input.studioId),
          inArray(events.state, [...HOLDS_STUDIO]),
          opts.excludeEventId ? ne(events.id, opts.excludeEventId) : undefined
        )
      )
      .all()
  ).map((r) => r.id)
  const studioBusy = [...(await daysByEvent(db, busyIds)).values()].flat()

  // Requester's other open events: weekly hours + open cap.
  const mine = await db
    .select({ id: events.id, state: events.state })
    .from(events)
    .where(
      and(
        eq(events.requesterId, input.requesterId),
        inArray(events.state, [...HOLDS_STUDIO]),
        opts.excludeEventId ? ne(events.id, opts.excludeEventId) : undefined
      )
    )
    .all()
  const weekly: Record<string, number> = {}
  if (mine.length) {
    for (const d of await db
      .select()
      .from(eventDays)
      .where(
        inArray(
          eventDays.eventId,
          mine.map((m) => m.id)
        )
      )
      .all()) {
      const k = isoWeekKey(d.day)
      weekly[k] = (weekly[k] ?? 0) + hoursBetween(d.startsAt, d.endsAt)
    }
  }
  const openStates: EventState[] = ["Submitted", "SponsorApproved", "Confirmed"]

  // Equipment lines with class level and availability for the event window.
  const { intervals } = toIntervals(input.days, config.tz)
  const typeIds = [...new Set(input.lines.map((l) => l.equipmentTypeId))]
  const typeRows = typeIds.length
    ? await db
        .select({ t: equipmentTypes, level: levels })
        .from(equipmentTypes)
        .innerJoin(
          equipmentClasses,
          eq(equipmentClasses.id, equipmentTypes.classId)
        )
        .innerJoin(levels, eq(levels.id, equipmentClasses.minLevelId))
        .where(inArray(equipmentTypes.id, typeIds))
        .all()
    : []
  if (typeRows.length !== typeIds.length)
    throw badRequest("UNKNOWN_EQUIPMENT", "Unknown equipment type.")
  const avail =
    intervals.length > 0
      ? await availability(
          db,
          typeIds,
          eventWindow(intervals),
          intervals[0]!.day,
          opts
        )
      : new Map<string, number>()

  const studioBlackouts = await db
    .select({ start: blackouts.startsAt, end: blackouts.endsAt })
    .from(blackouts)
    .where(
      or(eq(blackouts.studioId, input.studioId), isNull(blackouts.studioId))
    )
    .all()

  return {
    now: now(),
    tz: config.tz,
    requesterId: input.requesterId,
    requesterHasActiveHold: await hasActiveHold(db, input.requesterId),
    sponsor: sponsor
      ? {
          id: sponsor.id,
          active: sponsor.status === "active",
          isSponsor: sponsorIsSponsor,
        }
      : null,
    eventType: {
      active: type.status === "active",
      maxDays: type.maxDays,
      maxHoursPerDay: type.maxHoursPerDay,
      allowedStudioIds,
    },
    studio: {
      id: studioRow.s.id,
      active: studioRow.s.status === "active",
      minLevelRank: studioRow.level.rank,
      minLevelName: studioRow.level.name,
      turnaroundMinutes: studioRow.s.turnaroundMinutes,
      slotGranularityMinutes: studioRow.s.slotGranularityMinutes,
      openingHours: await db
        .select()
        .from(openingHours)
        .where(eq(openingHours.studioId, input.studioId))
        .all(),
      blackouts: studioBlackouts,
    },
    studioBusy,
    days: input.days,
    grants: await grantsFor(db, input.requesterId),
    lines: input.lines.map((l) => {
      const row = typeRows.find((r) => r.t.id === l.equipmentTypeId)!
      return {
        equipmentTypeId: l.equipmentTypeId,
        qty: l.qty,
        typeName: row.t.name,
        typeActive: row.t.status === "active",
        classMinLevelRank: row.level.rank,
        classMinLevelName: row.level.name,
        maxPerEvent: row.t.maxPerEvent,
        availableQty: avail.get(l.equipmentTypeId) ?? 0,
      }
    }),
    policy: {
      leadTimeHours: p.LEAD_TIME_HOURS,
      advanceDays: p.ADVANCE_DAYS,
      weeklyHours: p.WEEKLY_HOURS,
      openCap: p.OPEN_CAP,
      decisionCutoffHours: p.DECISION_CUTOFF_HOURS,
    },
    requesterWeeklyHours: weekly,
    requesterOpenEvents: mine.filter((m) => openStates.includes(m.state))
      .length,
  }
}

export async function checkDraft(
  db: DB,
  input: DraftInput,
  excludeEventId?: string
): Promise<Issue[]> {
  return validateSubmission(
    await buildSubmissionContext(db, input, { excludeEventId })
  )
}

/** Reads an existing event back into a DraftInput. */
export async function draftOf(
  db: DB,
  eventId: string
): Promise<DraftInput & { state: EventState; createdAt: string }> {
  const ev = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) throw badRequest("UNKNOWN_EVENT", "Unknown event.")
  return {
    requesterId: ev.requesterId,
    sponsorId: ev.sponsorId,
    eventTypeId: ev.eventTypeId,
    studioId: ev.studioId,
    state: ev.state,
    createdAt: ev.createdAt,
    days: await db
      .select({
        day: eventDays.day,
        startTime: eventDays.startTime,
        endTime: eventDays.endTime,
      })
      .from(eventDays)
      .where(eq(eventDays.eventId, eventId))
      .orderBy(eventDays.day)
      .all(),
    lines: await db
      .select({
        equipmentTypeId: equipmentLines.equipmentTypeId,
        qty: equipmentLines.qty,
      })
      .from(equipmentLines)
      .where(eq(equipmentLines.eventId, eventId))
      .all(),
  }
}

export async function participantIds(
  db: DB,
  eventId: string
): Promise<string[]> {
  return (
    await db
      .select({ id: eventParticipants.userId })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))
      .all()
  ).map((r) => r.id)
}
