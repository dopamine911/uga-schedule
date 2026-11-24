import {
  HOLDS_STUDIO,
  REVIEWABLE,
  can,
  effectiveLevel,
  isLocalDate,
  isLocalTime,
  localToUtc,
  minutesOf,
  nextDay,
  weekdayOf,
} from "@studio/domain"
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  lt,
  gt,
} from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  blackouts,
  eventDays,
  eventParticipants,
  events,
  levels,
  openingHours,
  roleAssignments,
  studios,
  users,
} from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { audit } from "../lib/audit.ts"
import { authorize, requireUser } from "../lib/auth.ts"
import { badRequest, notFound } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"
import { grantsFor } from "../services/booking.ts"
import { recheckEvents } from "../services/review.ts"
import { isStaff, today } from "./users.ts"

// F-004: studios, opening hours, blackouts and the availability view.

const MAX_SCHEDULE_DAYS = 31

type StudioRow = typeof studios.$inferSelect
type LevelRow = typeof levels.$inferSelect

async function hoursOf(
  db: DB,
  studioIds: readonly string[]
): Promise<Map<string, { weekday: number; opens: string; closes: string }[]>> {
  const out = new Map<
    string,
    { weekday: number; opens: string; closes: string }[]
  >()
  if (studioIds.length === 0) return out
  const rows = await db
    .select()
    .from(openingHours)
    .where(inArray(openingHours.studioId, [...studioIds]))
    .orderBy(asc(openingHours.weekday), asc(openingHours.opens))
    .all()
  for (const h of rows) {
    const list = out.get(h.studioId) ?? []
    list.push({ weekday: h.weekday, opens: h.opens, closes: h.closes })
    out.set(h.studioId, list)
  }
  return out
}

async function staffOf(
  db: DB,
  studioIds: readonly string[]
): Promise<Map<string, { id: string; displayName: string }[]>> {
  const out = new Map<string, { id: string; displayName: string }[]>()
  if (studioIds.length === 0) return out
  const rows = await db
    .select({
      studioId: roleAssignments.studioId,
      id: users.id,
      displayName: users.displayName,
    })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(
      and(
        eq(roleAssignments.role, "STUDIO_STAFF"),
        eq(users.status, "active"),
        inArray(roleAssignments.studioId, [...studioIds])
      )
    )
    .orderBy(asc(users.displayName))
    .all()
  for (const r of rows) {
    if (!r.studioId) continue
    const list = out.get(r.studioId) ?? []
    list.push({ id: r.id, displayName: r.displayName })
    out.set(r.studioId, list)
  }
  return out
}

function blackoutView(b: typeof blackouts.$inferSelect) {
  return {
    id: b.id,
    studioId: b.studioId,
    start: b.startsAt,
    end: b.endsAt,
    reason: b.reason,
  }
}

/** Studios with the caller's eligibility; students and sponsors see active studios only (F-004 §4). */
async function loadStudios(
  db: DB,
  userId: string,
  staff: boolean,
  id?: string
) {
  const day = today()
  const rows = await db
    .select({ s: studios, level: levels })
    .from(studios)
    .innerJoin(levels, eq(levels.id, studios.minLevelId))
    .where(
      and(
        id ? eq(studios.id, id) : undefined,
        staff ? undefined : eq(studios.status, "active")
      )
    )
    .orderBy(asc(studios.name))
    .all()
  const rank = effectiveLevel(await grantsFor(db, userId), day)
  const ids = rows.map((r) => r.s.id)
  const hours = await hoursOf(db, ids)
  const staffMap = await staffOf(db, ids)
  return rows.map((r) => ({
    id: r.s.id,
    name: r.s.name,
    location: r.s.location,
    capacityPeople: r.s.capacityPeople,
    turnaroundMinutes: r.s.turnaroundMinutes,
    slotGranularityMinutes: r.s.slotGranularityMinutes,
    status: r.s.status,
    minLevel: { id: r.level.id, name: r.level.name, rank: r.level.rank },
    eligibleToday: rank >= r.level.rank,
    openingHours: hours.get(r.s.id) ?? [],
    staff: staffMap.get(r.s.id) ?? [],
  }))
}

async function studioOf(db: DB, id: string): Promise<StudioRow> {
  const s = await db.select().from(studios).where(eq(studios.id, id)).get()
  if (!s) throw notFound("Studio")
  return s
}

async function levelOf(db: DB, id: string): Promise<LevelRow> {
  const l = await db.select().from(levels).where(eq(levels.id, id)).get()
  if (!l) throw badRequest("UNKNOWN_LEVEL", "Unknown level.")
  return l
}

/** Re-checks open events of one studio (BR-004-06/07), or of every open event for a global blackout. */
async function recheckStudio(
  db: DB,
  studioId: string | null
): Promise<string[]> {
  if (studioId) return recheckEvents(db, { studioId })
  const ids = (
    await db
      .select({ id: events.id })
      .from(events)
      .where(inArray(events.state, [...REVIEWABLE]))
      .all()
  ).map((r) => r.id)
  return recheckEvents(db, { eventIds: ids })
}

const isoDate = z.string().refine(isLocalDate, "Use YYYY-MM-DD.")
const localTime = z.string().refine(isLocalTime, "Use HH:MM.")
const studioBody = z.object({
  name: z.string().trim().min(1),
  location: z.string().optional(),
  capacityPeople: z.number().int().positive().optional(),
  minLevelId: z.string(),
  turnaroundMinutes: z.number().int().min(0).optional(),
  slotGranularityMinutes: z.number().int().positive().optional(),
  status: z.enum(["active", "inactive"]).optional(),
})
const studioPatch = studioBody.partial()
const hoursBody = z.array(
  z
    .object({
      weekday: z.number().int().min(0).max(6),
      opens: localTime,
      closes: localTime,
    })
    .refine(
      (h) => minutesOf(h.closes) > minutesOf(h.opens),
      "Closing time must be after opening time."
    )
)
const blackoutBody = z
  .object({
    studioId: z.string().nullable(),
    startDay: isoDate,
    startTime: localTime,
    endDay: isoDate,
    endTime: localTime,
    reason: z.string().trim().min(1, "A reason is required."),
  })
  .refine(
    (b) =>
      localToUtc(b.endDay, b.endTime, config.tz) >
      localToUtc(b.startDay, b.startTime, config.tz),
    {
      message: "The blackout must end after it starts.",
    }
  )
const scheduleQuery = z.object({ from: isoDate, to: isoDate })

export const routes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const me = requireUser(c)
    return c.json(await loadStudios(c.var.db, me.id, isStaff(me)))
  })
  .get("/:id", async (c) => {
    const me = requireUser(c)
    const db = c.var.db
    const id = c.req.param("id")
    const [studio] = await loadStudios(db, me.id, isStaff(me), id)
    if (!studio) throw notFound("Studio")
    const hours = (await hoursOf(db, [id])).get(id) ?? []
    const list = await db
      .select()
      .from(blackouts)
      .where(or(eq(blackouts.studioId, id), isNull(blackouts.studioId)))
      .orderBy(asc(blackouts.startsAt))
      .all()
    return c.json({ ...studio, hours, blackouts: list.map(blackoutView) })
  })
  .post("/", v("json", studioBody), async (c) => {
    const me = authorize(c, "studio.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    await levelOf(db, body.minLevelId)
    const s = await db
      .insert(studios)
      .values({
        name: body.name,
        location: body.location ?? "",
        capacityPeople: body.capacityPeople ?? 1,
        minLevelId: body.minLevelId,
        turnaroundMinutes: body.turnaroundMinutes ?? 30,
        slotGranularityMinutes: body.slotGranularityMinutes ?? 30,
        status: body.status ?? "active",
      })
      .returning()
      .get()
    await audit(db, {
      actorId: me.id,
      action: "studio.create",
      entityType: "studio",
      entityId: s.id,
      after: s,
    })
    return c.json(s, 201)
  })
  .patch("/:id", v("json", studioPatch), async (c) => {
    const me = authorize(c, "studio.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = await studioOf(db, id)
    const body = c.req.valid("json")
    if (body.minLevelId) await levelOf(db, body.minLevelId)
    const after = await db
      .update(studios)
      .set({
        name: body.name ?? before.name,
        location: body.location ?? before.location,
        capacityPeople: body.capacityPeople ?? before.capacityPeople,
        minLevelId: body.minLevelId ?? before.minLevelId,
        turnaroundMinutes: body.turnaroundMinutes ?? before.turnaroundMinutes,
        slotGranularityMinutes:
          body.slotGranularityMinutes ?? before.slotGranularityMinutes,
        status: body.status ?? before.status,
      })
      .where(eq(studios.id, id))
      .returning()
      .get()
    await audit(db, {
      actorId: me.id,
      action: "studio.update",
      entityType: "studio",
      entityId: id,
      before,
      after,
    })
    // BR-004-07/08: a higher min level or a deactivated studio re-checks open events.
    const reviewable =
      body.minLevelId !== undefined && body.minLevelId !== before.minLevelId
    const deactivated =
      body.status !== undefined && body.status !== before.status
    const flaggedEvents =
      reviewable || deactivated ? await recheckEvents(db, { studioId: id }) : []
    const [updated] = await loadStudios(db, me.id, true, id)
    return c.json({ ...updated, flaggedEvents })
  })
  .put("/:id/hours", v("json", hoursBody), async (c) => {
    const me = authorize(c, "studio.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before =
      (await hoursOf(db, [(await studioOf(db, id)).id])).get(id) ?? []
    const rows = c.req.valid("json")
    await db.delete(openingHours).where(eq(openingHours.studioId, id)).run()
    if (rows.length)
      await db
        .insert(openingHours)
        .values(
          rows.map((r) => ({
            studioId: id,
            weekday: r.weekday,
            opens: r.opens,
            closes: r.closes,
          }))
        )
        .run()
    await audit(db, {
      actorId: me.id,
      action: "studio.hours",
      entityType: "studio",
      entityId: id,
      before,
      after: rows,
    })
    // BR-004-07: shortened hours re-check open events.
    const flaggedEvents = await recheckEvents(db, { studioId: id })
    return c.json({
      hours: (await hoursOf(db, [id])).get(id) ?? [],
      flaggedEvents,
    })
  })
  .post("/blackouts", v("json", blackoutBody), async (c) => {
    const me = authorize(c, "studio.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    if (body.studioId) await studioOf(db, body.studioId)
    const startsAt = localToUtc(body.startDay, body.startTime, config.tz)
    const endsAt = localToUtc(body.endDay, body.endTime, config.tz)
    const b = await db
      .insert(blackouts)
      .values({
        studioId: body.studioId,
        startsAt,
        endsAt,
        reason: body.reason,
      })
      .returning()
      .get()
    await audit(db, {
      actorId: me.id,
      action: "blackout.create",
      entityType: "blackout",
      entityId: b.id,
      after: blackoutView(b),
      reason: body.reason,
    })
    // US-004-02: events over the blackout are flagged, not cancelled.
    const flaggedEvents = await recheckStudio(db, body.studioId)
    return c.json({ ...blackoutView(b), flaggedEvents }, 201)
  })
  .delete("/blackouts/:id", async (c) => {
    const me = authorize(c, "studio.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const b = await db
      .select()
      .from(blackouts)
      .where(eq(blackouts.id, id))
      .get()
    if (!b) throw notFound("Blackout")
    await db.delete(blackouts).where(eq(blackouts.id, id)).run()
    await audit(db, {
      actorId: me.id,
      action: "blackout.delete",
      entityType: "blackout",
      entityId: id,
      before: blackoutView(b),
      reason: b.reason,
    })
    return c.json({ ok: true })
  })
  .get("/:id/schedule", v("query", scheduleQuery), async (c) => {
    const me = requireUser(c)
    const db = c.var.db
    const id = c.req.param("id")
    const studio = await studioOf(db, id)
    if (studio.status !== "active" && !isStaff(me)) throw notFound("Studio")
    const { from, to } = c.req.valid("query")
    if (to < from)
      throw badRequest(
        "INVALID_RANGE",
        "The end day must be on or after the start day."
      )
    const span =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 +
      1
    if (span > MAX_SCHEDULE_DAYS)
      throw badRequest(
        "RANGE_TOO_LONG",
        `Ask for at most ${MAX_SCHEDULE_DAYS} days at a time.`
      )

    // Opening hours for each calendar day in the range.
    const hours = (await hoursOf(db, [id])).get(id) ?? []
    const days: {
      day: string
      weekday: number
      open: { opens: string; closes: string }[]
    }[] = []
    for (let day = from; day <= to; day = nextDay(day)) {
      const weekday = weekdayOf(day)
      days.push({
        day,
        weekday,
        open: hours
          .filter((h) => h.weekday === weekday)
          .map((h) => ({ opens: h.opens, closes: h.closes })),
      })
    }

    const rangeStart = localToUtc(from, "00:00", config.tz)
    const rangeEnd = localToUtc(nextDay(to), "00:00", config.tz)
    const blackoutRows = await db
      .select()
      .from(blackouts)
      .where(
        and(
          or(eq(blackouts.studioId, id), isNull(blackouts.studioId)),
          lt(blackouts.startsAt, rangeEnd),
          gt(blackouts.endsAt, rangeStart)
        )
      )
      .orderBy(asc(blackouts.startsAt))
      .all()

    // Busy time: event days of events that hold this studio (F-006 §4), with turnaround.
    const busyRows = await db
      .select({
        dayStart: eventDays.startsAt,
        dayEnd: eventDays.endsAt,
        eventId: events.id,
        title: events.title,
        requesterId: events.requesterId,
        requesterName: users.displayName,
        sponsorId: events.sponsorId,
        state: events.state,
      })
      .from(eventDays)
      .innerJoin(events, eq(events.id, eventDays.eventId))
      .innerJoin(users, eq(users.id, events.requesterId))
      .where(
        and(
          eq(events.studioId, id),
          inArray(events.state, [...HOLDS_STUDIO]),
          gte(eventDays.day, from),
          lte(eventDays.day, to)
        )
      )
      .orderBy(asc(eventDays.startsAt))
      .all()
    const participants = new Map<string, Set<string>>()
    const eventIds = [...new Set(busyRows.map((b) => b.eventId))]
    if (eventIds.length)
      for (const p of await db
        .select({
          eventId: eventParticipants.eventId,
          userId: eventParticipants.userId,
        })
        .from(eventParticipants)
        .where(inArray(eventParticipants.eventId, eventIds))
        .all()) {
        const set = participants.get(p.eventId) ?? new Set<string>()
        set.add(p.userId)
        participants.set(p.eventId, set)
      }

    const turnaroundMs = studio.turnaroundMinutes * 60_000
    const busy = busyRows.map((b) => {
      const own =
        b.requesterId === me.id ||
        b.sponsorId === me.id ||
        (participants.get(b.eventId)?.has(me.id) ?? false)
      // F-001 matrix: staff of this studio, Equipment Managers and Admins see titles; others only their own.
      const canSeeDetails = can(me, "event.view", { own, studioId: id })
      const base = {
        start: b.dayStart,
        end: b.dayEnd,
        turnaroundEnd: new Date(
          Date.parse(b.dayEnd) + turnaroundMs
        ).toISOString(),
      }
      return canSeeDetails
        ? {
            ...base,
            eventId: b.eventId,
            title: b.title,
            requesterName: b.requesterName,
            state: b.state,
          }
        : base
    })

    return c.json({
      days,
      blackouts: blackoutRows.map((b) => ({
        start: b.startsAt,
        end: b.endsAt,
        reason: b.reason,
      })),
      busy,
    })
  })
