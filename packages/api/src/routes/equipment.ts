import {
  type Interval,
  UNIT_STATUSES,
  type UnitStatus,
  eventWindow,
  firstUncoveredDay,
  isLocalDate,
  toIntervals,
} from "@studio/domain"
import { type SQL, asc, count, desc, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  bulkStock,
  equipmentClasses,
  equipmentTypes,
  equipmentUnits,
  levels,
  statusHistory,
} from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { audit } from "../lib/audit.ts"
import { authorize, requireUser } from "../lib/auth.ts"
import { badRequest, conflict, notFound } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"
import { availability, grantsFor } from "../services/booking.ts"
import { recheckEvents } from "../services/review.ts"
import { isStaff } from "./users.ts"

// F-003: equipment classes, types, units and bulk stock.

export interface Counts {
  total: number
  available: number
  in_use: number
  damaged: number
  in_repair: number
  lost: number
}

const emptyCounts = (): Counts => ({
  total: 0,
  available: 0,
  in_use: 0,
  damaged: 0,
  in_repair: 0,
  lost: 0,
})

/** Per-type counts by status (retired units are excluded from every count). */
function countsByType(db: DB): Map<string, Counts> {
  const out = new Map<string, Counts>()
  const get = (typeId: string) => {
    let c = out.get(typeId)
    if (!c) {
      c = emptyCounts()
      out.set(typeId, c)
    }
    return c
  }
  const units = db
    .select({
      typeId: equipmentUnits.typeId,
      status: equipmentUnits.status,
      n: count(),
    })
    .from(equipmentUnits)
    .groupBy(equipmentUnits.typeId, equipmentUnits.status)
    .all()
  for (const r of units) {
    if (r.status === "retired") continue
    const c = get(r.typeId)
    c[r.status] += r.n
    c.total += r.n
  }
  for (const b of db.select().from(bulkStock).all()) {
    const c = get(b.typeId)
    c.available = b.qtyAvailable
    c.in_use = b.qtyInUse
    c.damaged = b.qtyDamaged
    c.in_repair = b.qtyInRepair
    c.lost = b.qtyLost
    c.total =
      b.qtyAvailable + b.qtyInUse + b.qtyDamaged + b.qtyInRepair + b.qtyLost
  }
  return out
}

/** Equipment type joined with its class and that class's minimum level. */
function loadTypes(db: DB, where?: SQL) {
  return db
    .select({ t: equipmentTypes, cls: equipmentClasses, level: levels })
    .from(equipmentTypes)
    .innerJoin(
      equipmentClasses,
      eq(equipmentClasses.id, equipmentTypes.classId)
    )
    .innerJoin(levels, eq(levels.id, equipmentClasses.minLevelId))
    .where(where)
    .orderBy(asc(equipmentTypes.name))
    .all()
}

/** Equipment type row joined with its class and that class's minimum level. */
export interface LoadedType {
  t: typeof equipmentTypes.$inferSelect
  cls: typeof equipmentClasses.$inferSelect
  level: typeof levels.$inferSelect
}

function typeView(r: LoadedType, counts: Counts) {
  return {
    id: r.t.id,
    classId: r.t.classId,
    name: r.t.name,
    manufacturer: r.t.manufacturer,
    model: r.t.model,
    tracking: r.t.tracking,
    status: r.t.status,
    maxPerEvent: r.t.maxPerEvent,
    description: r.t.description,
    class: { id: r.cls.id, name: r.cls.name },
    minLevel: { id: r.level.id, name: r.level.name, rank: r.level.rank },
    counts,
  }
}

/** Lifecycle moves outside checkout/check-in (F-003 §3). in_use is never a target or source here. */
const TRANSITIONS: Partial<Record<UnitStatus, readonly UnitStatus[]>> = {
  available: ["damaged", "retired"],
  damaged: ["in_repair", "retired"],
  in_repair: ["available", "retired"],
  lost: ["available", "retired"],
}

/** Stock buckets of a bulk type (BR-003-09). */
type BulkBucket = "available" | "damaged" | "in_repair" | "lost"

/** A type has stock or history: its tracking mode is locked (BR-003-02). */
function hasStock(db: DB, typeId: string): boolean {
  if (
    db
      .select({ id: equipmentUnits.id })
      .from(equipmentUnits)
      .where(eq(equipmentUnits.typeId, typeId))
      .get()
  )
    return true
  if (
    db
      .select({ typeId: statusHistory.typeId })
      .from(statusHistory)
      .where(eq(statusHistory.typeId, typeId))
      .get()
  )
    return true
  const b = db
    .select()
    .from(bulkStock)
    .where(eq(bulkStock.typeId, typeId))
    .get()
  return (
    !!b &&
    b.qtyAvailable + b.qtyInUse + b.qtyDamaged + b.qtyInRepair + b.qtyLost > 0
  )
}

function classOf(db: DB, id: string) {
  const c = db
    .select()
    .from(equipmentClasses)
    .where(eq(equipmentClasses.id, id))
    .get()
  if (!c) throw badRequest("UNKNOWN_CLASS", "Unknown equipment class.")
  return c
}

function typeOf(db: DB, id: string) {
  const t = db
    .select()
    .from(equipmentTypes)
    .where(eq(equipmentTypes.id, id))
    .get()
  if (!t) throw notFound("Equipment type")
  return t
}

function unitOf(db: DB, id: string) {
  const u = db
    .select()
    .from(equipmentUnits)
    .where(eq(equipmentUnits.id, id))
    .get()
  if (!u) throw notFound("Unit")
  return u
}

function levelOf(db: DB, id: string) {
  const l = db.select().from(levels).where(eq(levels.id, id)).get()
  if (!l) throw badRequest("UNKNOWN_LEVEL", "Unknown level.")
  return l
}

/** Re-checks open events that reserve any of the given types (BR-003-08, F-006 review). */
function recheckTypes(db: DB, typeIds: readonly string[]): string[] {
  const flagged: string[] = []
  for (const equipmentTypeId of new Set(typeIds))
    flagged.push(...recheckEvents(db, { equipmentTypeId }))
  return flagged
}

const isoDate = z.string().refine(isLocalDate, "Use YYYY-MM-DD.")
const classBody = z.object({
  name: z.string().trim().min(1),
  minLevelId: z.string(),
  description: z.string().optional(),
})
const classPatch = classBody.partial()
const typeBody = z.object({
  classId: z.string(),
  name: z.string().trim().min(1),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  tracking: z.enum(["serialized", "bulk"]),
  maxPerEvent: z.number().int().positive().nullish(),
  description: z.string().optional(),
})
const typePatch = typeBody
  .partial()
  .extend({ status: z.enum(["active", "inactive"]).optional() })
const unitBody = z.object({
  assetTag: z.string().trim().min(1),
  serialNumber: z.string().optional(),
  notes: z.string().optional(),
})
const unitPatch = z.object({
  serialNumber: z.string().optional(),
  notes: z.string().optional(),
})
const statusBody = z.object({
  status: z.enum(UNIT_STATUSES),
  reason: z.string().trim().min(1, "A reason is required."),
  expectedBack: isoDate.nullish(),
})
const bulkBody = z.object({
  from: z.enum(["available", "damaged", "in_repair", "lost"]).nullable(),
  to: z.enum(["available", "damaged", "in_repair", "lost"]).nullable(),
  qty: z.number().int().positive(),
  reason: z.string().trim().min(1, "A reason is required."),
})
const availabilityBody = z.object({
  days: z
    .array(
      z.object({ day: isoDate, startTime: z.string(), endTime: z.string() })
    )
    .min(1),
  excludeEventId: z.string().nullish(),
})

export const routes = new Hono<AppEnv>()
  .get("/classes", (c) => {
    requireUser(c)
    const rows = c.var.db
      .select({ cls: equipmentClasses, level: levels })
      .from(equipmentClasses)
      .innerJoin(levels, eq(levels.id, equipmentClasses.minLevelId))
      .orderBy(asc(equipmentClasses.name))
      .all()
    return c.json(
      rows.map((r) => ({
        id: r.cls.id,
        name: r.cls.name,
        description: r.cls.description,
        minLevel: { id: r.level.id, name: r.level.name, rank: r.level.rank },
      }))
    )
  })
  .post("/classes", v("json", classBody), (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    levelOf(db, body.minLevelId)
    const row = db.transaction(() => {
      const r = db
        .insert(equipmentClasses)
        .values({
          name: body.name,
          minLevelId: body.minLevelId,
          description: body.description ?? "",
        })
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "equipment_class.create",
        entityType: "equipment_class",
        entityId: r.id,
        after: r,
      })
      return r
    })
    return c.json(row, 201)
  })
  .patch("/classes/:id", v("json", classPatch), (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = classOf(db, id)
    const body = c.req.valid("json")
    if (body.minLevelId) levelOf(db, body.minLevelId)
    const levelChanged =
      body.minLevelId !== undefined && body.minLevelId !== before.minLevelId
    const flaggedEvents = db.transaction(() => {
      const after = db
        .update(equipmentClasses)
        .set({
          name: body.name ?? before.name,
          minLevelId: body.minLevelId ?? before.minLevelId,
          description: body.description ?? before.description,
        })
        .where(eq(equipmentClasses.id, id))
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "equipment_class.update",
        entityType: "equipment_class",
        entityId: id,
        before,
        after,
      })
      if (!levelChanged) return []
      const typeIds = db
        .select({ id: equipmentTypes.id })
        .from(equipmentTypes)
        .where(eq(equipmentTypes.classId, id))
        .all()
        .map((r) => r.id)
      return recheckTypes(db, typeIds)
    })
    return c.json({ ...classOf(db, id), flaggedEvents })
  })
  .get(
    "/types",
    v("query", z.object({ includeInactive: z.string().optional() })),
    (c) => {
      const me = requireUser(c)
      const db = c.var.db
      const includeInactive =
        isStaff(me) && c.req.valid("query").includeInactive === "1"
      const counts = countsByType(db)
      return c.json(
        loadTypes(
          db,
          includeInactive ? undefined : eq(equipmentTypes.status, "active")
        ).map((r) => typeView(r, counts.get(r.t.id) ?? emptyCounts()))
      )
    }
  )
  .get("/types/:id", (c) => {
    const me = requireUser(c)
    const db = c.var.db
    const id = c.req.param("id")
    const staff = isStaff(me)
    const row = loadTypes(db, eq(equipmentTypes.id, id))[0]
    if (!row || (row.t.status !== "active" && !staff))
      throw notFound("Equipment type")
    const counts = countsByType(db).get(id) ?? emptyCounts()
    const view = typeView(row, counts)
    // One response shape for every caller: staff get the detail, everyone else gets empty detail (never omitted).
    const units = staff
      ? db
          .select({
            id: equipmentUnits.id,
            assetTag: equipmentUnits.assetTag,
            serialNumber: equipmentUnits.serialNumber,
            status: equipmentUnits.status,
            expectedBack: equipmentUnits.expectedBack,
            notes: equipmentUnits.notes,
          })
          .from(equipmentUnits)
          .where(eq(equipmentUnits.typeId, id))
          .orderBy(asc(equipmentUnits.assetTag))
          .all()
      : []
    const bulk = staff
      ? (db.select().from(bulkStock).where(eq(bulkStock.typeId, id)).get() ??
        null)
      : null
    const history = staff
      ? db
          .select()
          .from(statusHistory)
          .where(eq(statusHistory.typeId, id))
          .orderBy(desc(statusHistory.at))
          .limit(50)
          .all()
      : []
    return c.json({ ...view, units, bulkStock: bulk, statusHistory: history })
  })
  .post("/types", v("json", typeBody), (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    classOf(db, body.classId)
    const row = db.transaction(() => {
      const r = db
        .insert(equipmentTypes)
        .values({
          classId: body.classId,
          name: body.name,
          manufacturer: body.manufacturer ?? "",
          model: body.model ?? "",
          tracking: body.tracking,
          maxPerEvent: body.maxPerEvent ?? null,
          description: body.description ?? "",
        })
        .returning()
        .get()
      // Bulk types always have a stock row so reservations and adjustments have somewhere to land.
      if (r.tracking === "bulk")
        db.insert(bulkStock).values({ typeId: r.id }).run()
      audit(db, {
        actorId: me.id,
        action: "equipment_type.create",
        entityType: "equipment_type",
        entityId: r.id,
        after: r,
      })
      return r
    })
    return c.json(row, 201)
  })
  .patch("/types/:id", v("json", typePatch), (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = typeOf(db, id)
    const body = c.req.valid("json")
    if (body.classId) classOf(db, body.classId)
    const trackingChanged =
      body.tracking !== undefined && body.tracking !== before.tracking
    if (trackingChanged && hasStock(db, id))
      throw conflict(
        "TRACKING_LOCKED",
        "Tracking cannot change once units or stock exist. Retire this type and create a new one."
      )
    const flaggedEvents = db.transaction(() => {
      const after = db
        .update(equipmentTypes)
        .set({
          classId: body.classId ?? before.classId,
          name: body.name ?? before.name,
          manufacturer: body.manufacturer ?? before.manufacturer,
          model: body.model ?? before.model,
          tracking: body.tracking ?? before.tracking,
          maxPerEvent:
            body.maxPerEvent === undefined
              ? before.maxPerEvent
              : body.maxPerEvent,
          description: body.description ?? before.description,
          status: body.status ?? before.status,
        })
        .where(eq(equipmentTypes.id, id))
        .returning()
        .get()
      if (trackingChanged) {
        if (after.tracking === "bulk")
          db.insert(bulkStock).values({ typeId: id }).run()
        else db.delete(bulkStock).where(eq(bulkStock.typeId, id)).run()
      }
      audit(db, {
        actorId: me.id,
        action: "equipment_type.update",
        entityType: "equipment_type",
        entityId: id,
        before,
        after,
      })
      const capacityChanged =
        (body.status !== undefined && body.status !== before.status) ||
        (body.classId !== undefined && body.classId !== before.classId)
      return capacityChanged ? recheckEvents(db, { equipmentTypeId: id }) : []
    })
    const row = loadTypes(db, eq(equipmentTypes.id, id))[0]!
    return c.json({
      ...typeView(row, countsByType(db).get(id) ?? emptyCounts()),
      flaggedEvents,
    })
  })
  .post("/types/:id/units", v("json", unitBody), (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const typeId = c.req.param("id")
    const type = typeOf(db, typeId)
    if (type.tracking !== "serialized")
      throw badRequest("NOT_SERIALIZED", "Only serialized types have units.")
    const body = c.req.valid("json")
    if (
      db
        .select({ id: equipmentUnits.id })
        .from(equipmentUnits)
        .where(eq(equipmentUnits.assetTag, body.assetTag))
        .get()
    )
      throw conflict("ASSET_TAG_TAKEN", "That asset tag is already used.")
    const unit = db.transaction(() => {
      const u = db
        .insert(equipmentUnits)
        .values({
          typeId,
          assetTag: body.assetTag,
          serialNumber: body.serialNumber ?? "",
          notes: body.notes ?? "",
        })
        .returning()
        .get()
      db.insert(statusHistory)
        .values({
          unitId: u.id,
          typeId,
          fromStatus: null,
          toStatus: u.status,
          actorId: me.id,
          reason: "Added to inventory",
        })
        .run()
      audit(db, {
        actorId: me.id,
        action: "unit.create",
        entityType: "unit",
        entityId: u.id,
        after: u,
      })
      return u
    })
    return c.json(unit, 201)
  })
  .patch("/units/:id", v("json", unitPatch), (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = unitOf(db, id)
    const body = c.req.valid("json")
    const after = db.transaction(() => {
      const u = db
        .update(equipmentUnits)
        .set({
          serialNumber: body.serialNumber ?? before.serialNumber,
          notes: body.notes ?? before.notes,
        })
        .where(eq(equipmentUnits.id, id))
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "unit.update",
        entityType: "unit",
        entityId: id,
        before,
        after: u,
      })
      return u
    })
    return c.json(after)
  })
  .post("/units/:id/status", v("json", statusBody), (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const unit = unitOf(db, id)
    const body = c.req.valid("json")
    if (body.status === unit.status)
      throw badRequest("NO_CHANGE", "The unit already has that status.")
    if (!TRANSITIONS[unit.status]?.includes(body.status))
      throw badRequest(
        "INVALID_TRANSITION",
        `A unit cannot move from ${unit.status} to ${body.status} here. Checkout and check-in move units in and out of use.`
      )
    if (body.status === "in_repair" && !body.expectedBack)
      throw badRequest(
        "EXPECTED_BACK_REQUIRED",
        "Give the date the unit is expected back from repair."
      )
    const flagged = db.transaction(() => {
      db.update(equipmentUnits)
        .set({
          status: body.status,
          expectedBack:
            body.status === "in_repair" ? (body.expectedBack ?? null) : null,
        })
        .where(eq(equipmentUnits.id, id))
        .run()
      db.insert(statusHistory)
        .values({
          unitId: id,
          typeId: unit.typeId,
          fromStatus: unit.status,
          toStatus: body.status,
          actorId: me.id,
          reason: body.reason,
        })
        .run()
      audit(db, {
        actorId: me.id,
        action: "unit.status",
        entityType: "unit",
        entityId: id,
        before: { status: unit.status },
        after: { status: body.status, expectedBack: body.expectedBack ?? null },
        reason: body.reason,
      })
      // BR-003-08: leaving bookable capacity re-runs reservations.
      return recheckTypes(db, [unit.typeId])
    })
    const updated = unitOf(db, id)
    return c.json({ ...updated, flaggedEvents: flagged })
  })
  .post("/types/:id/bulk-adjust", v("json", bulkBody), (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const typeId = c.req.param("id")
    const type = typeOf(db, typeId)
    if (type.tracking !== "bulk")
      throw badRequest(
        "NOT_BULK",
        "Only bulk types can be adjusted by quantity."
      )
    const { from, to, qty, reason } = c.req.valid("json")
    if (from === null && to === null)
      throw badRequest(
        "NO_CHANGE",
        "Give a source status, a target status, or both."
      )
    if (from !== null && from === to)
      throw badRequest("NO_CHANGE", "Source and target are the same.")
    if (from !== null && to !== null && !TRANSITIONS[from]?.includes(to))
      throw badRequest(
        "INVALID_TRANSITION",
        `Stock cannot move from ${from} to ${to}.`
      )
    const stock = db
      .select()
      .from(bulkStock)
      .where(eq(bulkStock.typeId, typeId))
      .get()
    if (!stock)
      throw badRequest("NO_STOCK_ROW", "This type has no stock record.")
    if (from !== null && bucketQty(stock, from) < qty)
      throw badRequest(
        "INSUFFICIENT_STOCK",
        `Only ${bucketQty(stock, from)} in ${from}.`
      )

    const flagged = db.transaction(() => {
      if (from !== null)
        db.update(bulkStock)
          .set(bucketDelta(from, -qty))
          .where(eq(bulkStock.typeId, typeId))
          .run()
      if (to !== null)
        db.update(bulkStock)
          .set(bucketDelta(to, qty))
          .where(eq(bulkStock.typeId, typeId))
          .run()
      // Removing stock is recorded as moving it to retired (status_history.to_status is required).
      db.insert(statusHistory)
        .values({
          typeId,
          fromStatus: from,
          toStatus: to ?? "retired",
          qty,
          actorId: me.id,
          reason,
        })
        .run()
      audit(db, {
        actorId: me.id,
        action: "bulk.adjust",
        entityType: "bulk_stock",
        entityId: typeId,
        before: { from, qty },
        after: { to, qty },
        reason,
      })
      // BR-003-08: capacity drops when stock leaves available or in_repair for anything but available.
      const capacityDrops =
        from !== null &&
        (from === "available" || from === "in_repair") &&
        to !== "available"
      return capacityDrops ? recheckTypes(db, [typeId]) : []
    })
    return c.json({
      typeId,
      counts: countsByType(db).get(typeId) ?? emptyCounts(),
      flaggedEvents: flagged,
    })
  })
  .post("/availability", v("json", availabilityBody), (c) => {
    const me = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const { intervals, issues } = toIntervals(body.days, config.tz)
    if (issues.length)
      throw badRequest("DAY_INVALID", issues[0]!.message, issues)
    const window: Interval = eventWindow(intervals)
    const types = loadTypes(db, eq(equipmentTypes.status, "active"))
    const avail = availability(
      db,
      types.map((t) => t.t.id),
      window,
      intervals[0]!.day,
      { excludeEventId: body.excludeEventId ?? undefined }
    )
    const grants = grantsFor(db, me.id)
    const days = intervals.map((d) => d.day)
    return c.json(
      types.map((r) => ({
        equipmentTypeId: r.t.id,
        available: avail.get(r.t.id) ?? 0,
        eligible: firstUncoveredDay(grants, days, r.level.rank) === null,
        minLevelName: r.level.name,
      }))
    )
  })

/** Quantity held in one bulk bucket (BR-003-09). */
function bucketQty(
  stock: typeof bulkStock.$inferSelect,
  status: BulkBucket
): number {
  return {
    available: stock.qtyAvailable,
    damaged: stock.qtyDamaged,
    in_repair: stock.qtyInRepair,
    lost: stock.qtyLost,
  }[status]
}

/** Update that moves `delta` units into (positive) or out of (negative) one bulk bucket. */
function bucketDelta(
  status: BulkBucket,
  delta: number
): Partial<
  Record<"qtyAvailable" | "qtyDamaged" | "qtyInRepair" | "qtyLost", SQL>
> {
  switch (status) {
    case "available":
      return { qtyAvailable: sql`${bulkStock.qtyAvailable} + ${delta}` }
    case "damaged":
      return { qtyDamaged: sql`${bulkStock.qtyDamaged} + ${delta}` }
    case "in_repair":
      return { qtyInRepair: sql`${bulkStock.qtyInRepair} + ${delta}` }
    case "lost":
      return { qtyLost: sql`${bulkStock.qtyLost} + ${delta}` }
  }
}
