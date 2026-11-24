import { can, deniedStudios, hasUnscoped, studiosFor } from "@studio/domain"
import { and, desc, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { events, holds, users } from "../db/schema.ts"
import type { AppEnv, SessionUser } from "../env.ts"
import { requireUser } from "../lib/auth.ts"
import { forbidden, notFound, conflict } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"
import { clearHold, placeHold, visibleEvent } from "../services/lifecycle.ts"
import type { DB } from "../db/client.ts"

// F-007 §5 account holds.

const createBody = z.object({
  userId: z.string(),
  note: z.string().trim().min(1),
  eventId: z.string().nullable().default(null),
})
const clearBody = z.object({ reason: z.string().trim().min(1) })

/** Holds visible to a viewer: own holds, or holds of requesters of studios they staff (hold.view). */
function holdRows(db: DB, rows: (typeof holds.$inferSelect)[]) {
  const userIds = [...new Set(rows.map((h) => h.userId))]
  const eventIds = [...new Set(rows.map((h) => h.eventId).filter((x): x is string => !!x))]
  const names = new Map(
    userIds.length
      ? db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, userIds)).all().map((u) => [u.id, u.displayName])
      : [],
  )
  const titles = new Map(
    eventIds.length
      ? db.select({ id: events.id, title: events.title }).from(events).where(inArray(events.id, eventIds)).all().map((e) => [e.id, e.title])
      : [],
  )
  return rows.map((h) => ({
    id: h.id,
    userId: h.userId,
    userName: names.get(h.userId) ?? "",
    reason: h.reason,
    status: h.status,
    source: h.source,
    eventId: h.eventId,
    eventTitle: h.eventId ? (titles.get(h.eventId) ?? null) : null,
    note: h.note,
    autoClearAt: h.autoClearAt,
    createdAt: h.createdAt,
    clearedAt: h.clearedAt,
    clearedReason: h.clearedReason,
  }))
}

function studioStaffRequesterIds(db: DB, user: SessionUser): string[] | null {
  if (hasUnscoped(user, "hold.view")) return null
  const studioIds = studiosFor(user, "hold.view")
  if (studioIds.length === 0) throw forbidden()
  return [
    ...new Set(
      db
        .select({ requesterId: events.requesterId })
        .from(events)
        .where(inArray(events.studioId, studioIds))
        .all()
        .map((r) => r.requesterId),
    ),
  ]
}

export const routes = new Hono<AppEnv>()
  .get("/", v("query", z.object({ scope: z.enum(["mine", "all"]).default("mine") })), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const { scope } = c.req.valid("query")
    if (scope === "mine") {
      return c.json(holdRows(db, db.select().from(holds).where(eq(holds.userId, user.id)).orderBy(desc(holds.createdAt)).all()))
    }
    const scoped = studioStaffRequesterIds(db, user)
    let rows = db.select().from(holds).orderBy(desc(holds.createdAt)).all()
    // Unscoped viewers with a studio removed (BR-001-15) don't see holds raised on that studio's events.
    const excluded = scoped ? [] : deniedStudios(user, "hold.view")
    if (excluded.length) {
      const hidden = new Set(
        db
          .select({ id: events.id })
          .from(events)
          .where(inArray(events.studioId, excluded))
          .all()
          .map((e) => e.id),
      )
      rows = rows.filter((h) => !h.eventId || !hidden.has(h.eventId))
    }
    return c.json(holdRows(db, scoped ? rows.filter((h) => scoped.includes(h.userId)) : rows))
  })
  .post("/", v("json", createBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const target = db.select({ id: users.id }).from(users).where(eq(users.id, body.userId)).get()
    const ev = body.eventId ? visibleEvent(db, user, body.eventId) : null
    if (ev && ev.requesterId !== body.userId) throw conflict("NOT_REQUESTER", "That person did not request this event.")
    if (!can(user, "hold.clear")) {
      // Studio staff may hold only people who have requested one of their studios.
      const studioIds = studiosFor(user, "checkout.perform")
      const theirs =
        studioIds.length > 0 &&
        db
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.requesterId, body.userId), inArray(events.studioId, studioIds)))
          .get()
      if (!theirs) throw forbidden()
    }
    if (!target) throw notFound("User")
    const hold = db.transaction(() =>
      placeHold(db, {
        userId: body.userId,
        reason: "MANUAL",
        eventId: body.eventId,
        source: "staff",
        note: body.note,
        actorId: user.id,
      }),
    )
    return c.json(holdRows(db, [hold!])[0]!, 201)
  })
  .post("/:id/clear", v("json", clearBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    if (!can(user, "hold.clear")) throw forbidden()
    const hold = db.select().from(holds).where(eq(holds.id, c.req.param("id"))).get()
    if (!hold) throw notFound("Hold")
    if (hold.status !== "active") throw conflict("NOT_ACTIVE", "This hold is already cleared.")
    const body = c.req.valid("json")
    db.transaction(() => clearHold(db, hold, user.id, body.reason))
    return c.json(holdRows(db, [db.select().from(holds).where(eq(holds.id, hold.id)).get()!])[0]!)
  })
