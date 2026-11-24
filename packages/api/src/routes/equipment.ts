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
async function countsByType(db: DB): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>()
  const get = (typeId: string) => {
    let c = out.get(typeId)
    if (!c) {
      c = emptyCounts()
      out.set(typeId, c)
    }
    return c
  }
  const units = await db
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
  for (const b of await db.select().from(bulkStock).all()) {
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
async function loadTypes(db: DB, where?: SQL) {
  return await db
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
async function hasStock(db: DB, typeId: string): Promise<boolean> {
  if (
    await db
      .select({ id: equipmentUnits.id })
      .from(equipmentUnits)
      .where(eq(equipmentUnits.typeId, typeId))
      .get()
  )
    return true
  if (
    await db
      .select({ typeId: statusHistory.typeId })
      .from(statusHistory)
      .where(eq(statusHistory.typeId, typeId))
      .get()
  )
    return true
  const b = await db
    .select()
    .from(bulkStock)
    .where(eq(bulkStock.typeId, typeId))
    .get()
  return (
    !!b &&
    b.qtyAvailable + b.qtyInUse + b.qtyDamaged + b.qtyInRepair + b.qtyLost > 0
  )
}

async function classOf(db: DB, id: string) {
  const c = await db
    .select()
    .from(equipmentClasses)
    .where(eq(equipmentClasses.id, id))
    .get()
  if (!c) throw badRequest("UNKNOWN_CLASS", "Unknown equipment class.")
  return c
}

async function typeOf(db: DB, id: string) {
  const t = await db
    .select()
    .from(equipmentTypes)
    .where(eq(equipmentTypes.id, id))
    .get()
  if (!t) throw notFound("Equipment type")
  return t
}

async function unitOf(db: DB, id: string) {
  const u = await db
    .select()
    .from(equipmentUnits)
    .where(eq(equipmentUnits.id, id))
    .get()
  if (!u) throw notFound("Unit")
  return u
}

async function levelOf(db: DB, id: string) {
  const l = await db.select().from(levels).where(eq(levels.id, id)).get()
  if (!l) throw badRequest("UNKNOWN_LEVEL", "Unknown level.")
  return l
}

/** Re-checks open events that reserve any of the given types (BR-003-08, F-006 review). */
async function recheckTypes(
  db: DB,
  typeIds: readonly string[]
): Promise<string[]> {
  const flagged: string[] = []
  for (const equipmentTypeId of new Set(typeIds))
    flagged.push(...(await recheckEvents(db, { equipmentTypeId })))
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
  .get("/classes", async (c) => {
    requireUser(c)
    const rows = await c.var.db
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
  .post("/classes", v("json", classBody), async (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    await levelOf(db, body.minLevelId)
    const r = await db
      .insert(equipmentClasses)
      .values({
        name: body.name,
        minLevelId: body.minLevelId,
        description: body.description ?? "",
      })
      .returning()
      .get()
    await audit(db, {
      actorId: me.id,
      action: "equipment_class.create",
      entityType: "equipment_class",
      entityId: r.id,
      after: r,
    })
    return c.json(r, 201)
  })
  .patch("/classes/:id", v("json", classPatch), async (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = await classOf(db, id)
    const body = c.req.valid("json")
    if (body.minLevelId) await levelOf(db, body.minLevelId)
    const levelChanged =
      body.minLevelId !== undefined && body.minLevelId !== before.minLevelId
    const after = await db
      .update(equipmentClasses)
      .set({
        name: body.name ?? before.name,
        minLevelId: body.minLevelId ?? before.minLevelId,
        description: body.description ?? before.description,
      })
      .where(eq(equipmentClasses.id, id))
      .returning()
      .get()
    await audit(db, {
      actorId: me.id,
      action: "equipment_class.update",
      entityType: "equipment_class",
      entityId: id,
      before,
      after,
    })
    let flaggedEvents: string[] = []
    if (levelChanged) {
      const typeIds = (
        await db
          .select({ id: equipmentTypes.id })
          .from(equipmentTypes)
          .where(eq(equipmentTypes.classId, id))
          .all()
      ).map((r) => r.id)
      flaggedEvents = await recheckTypes(db, typeIds)
    }
    return c.json({ ...(await classOf(db, id)), flaggedEvents })
  })
  .get(
    "/types",
    v("query", z.object({ includeInactive: z.string().optional() })),
    async (c) => {
      const me = requireUser(c)
      const db = c.var.db
      const includeInactive =
        isStaff(me) && c.req.valid("query").includeInactive === "1"
      const counts = await countsByType(db)
      return c.json(
        (
          await loadTypes(
            db,
            includeInactive ? undefined : eq(equipmentTypes.status, "active")
          )
        ).map((r) => typeView(r, counts.get(r.t.id) ?? emptyCounts()))
      )
    }
  )
  .get("/types/:id", async (c) => {
    const me = requireUser(c)
    const db = c.var.db
    const id = c.req.param("id")
    const staff = isStaff(me)
    const row = (await loadTypes(db, eq(equipmentTypes.id, id)))[0]
    if (!row || (row.t.status !== "active" && !staff))
      throw notFound("Equipment type")
    const counts = (await countsByType(db)).get(id) ?? emptyCounts()
    const view = typeView(row, counts)
    // One response shape for every caller: staff get the detail, everyone else gets empty detail (never omitted).
    const units = staff
      ? await db
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
      ? ((await db
          .select()
          .from(bulkStock)
          .where(eq(bulkStock.typeId, id))
          .get()) ?? null)
      : null
    const history = staff
      ? await db
          .select()
          .from(statusHistory)
          .where(eq(statusHistory.typeId, id))
          .orderBy(desc(statusHistory.at))
          .limit(50)
          .all()
      : []
    return c.json({ ...view, units, bulkStock: bulk, statusHistory: history })
  })
  .post("/types", v("json", typeBody), async (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    await classOf(db, body.classId)
    const r = await db
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
      await db.insert(bulkStock).values({ typeId: r.id }).run()
    await audit(db, {
      actorId: me.id,
      action: "equipment_type.create",
      entityType: "equipment_type",
      entityId: r.id,
      after: r,
    })
    return c.json(r, 201)
  })
  .patch("/types/:id", v("json", typePatch), async (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = await typeOf(db, id)
    const body = c.req.valid("json")
    if (body.classId) await classOf(db, body.classId)
    const trackingChanged =
      body.tracking !== undefined && body.tracking !== before.tracking
    if (trackingChanged && (await hasStock(db, id)))
      throw conflict(
        "TRACKING_LOCKED",
        "Tracking cannot change once units or stock exist. Retire this type and create a new one."
      )
    const after = await db
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
        await db.insert(bulkStock).values({ typeId: id }).run()
      else await db.delete(bulkStock).where(eq(bulkStock.typeId, id)).run()
    }
    await audit(db, {
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
    const flaggedEvents = capacityChanged
      ? await recheckEvents(db, { equipmentTypeId: id })
      : []
    const row = (await loadTypes(db, eq(equipmentTypes.id, id)))[0]!
    return c.json({
      ...typeView(row, (await countsByType(db)).get(id) ?? emptyCounts()),
      flaggedEvents,
    })
  })
  .post("/types/:id/units", v("json", unitBody), async (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const typeId = c.req.param("id")
    const type = await typeOf(db, typeId)
    if (type.tracking !== "serialized")
      throw badRequest("NOT_SERIALIZED", "Only serialized types have units.")
    const body = c.req.valid("json")
    if (
      await db
        .select({ id: equipmentUnits.id })
        .from(equipmentUnits)
        .where(eq(equipmentUnits.assetTag, body.assetTag))
        .get()
    )
      throw conflict("ASSET_TAG_TAKEN", "That asset tag is already used.")
    const u = await db
      .insert(equipmentUnits)
      .values({
        typeId,
        assetTag: body.assetTag,
        serialNumber: body.serialNumber ?? "",
        notes: body.notes ?? "",
      })
      .returning()
      .get()
    await db
      .insert(statusHistory)
      .values({
        unitId: u.id,
        typeId,
        fromStatus: null,
        toStatus: u.status,
        actorId: me.id,
        reason: "Added to inventory",
      })
      .run()
    await audit(db, {
      actorId: me.id,
      action: "unit.create",
      entityType: "unit",
      entityId: u.id,
      after: u,
    })
    return c.json(u, 201)
  })
  .patch("/units/:id", v("json", unitPatch), async (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = await unitOf(db, id)
    const body = c.req.valid("json")
    const u = await db
      .update(equipmentUnits)
      .set({
        serialNumber: body.serialNumber ?? before.serialNumber,
        notes: body.notes ?? before.notes,
      })
      .where(eq(equipmentUnits.id, id))
      .returning()
      .get()
    await audit(db, {
      actorId: me.id,
      action: "unit.update",
      entityType: "unit",
      entityId: id,
      before,
      after: u,
    })
    return c.json(u)
  })
  .post("/units/:id/status", v("json", statusBody), async (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const unit = await unitOf(db, id)
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
    await db
      .update(equipmentUnits)
      .set({
        status: body.status,
        expectedBack:
          body.status === "in_repair" ? (body.expectedBack ?? null) : null,
      })
      .where(eq(equipmentUnits.id, id))
      .run()
    await db
      .insert(statusHistory)
      .values({
        unitId: id,
        typeId: unit.typeId,
        fromStatus: unit.status,
        toStatus: body.status,
        actorId: me.id,
        reason: body.reason,
      })
      .run()
    await audit(db, {
      actorId: me.id,
      action: "unit.status",
      entityType: "unit",
      entityId: id,
      before: { status: unit.status },
      after: { status: body.status, expectedBack: body.expectedBack ?? null },
      reason: body.reason,
    })
    // BR-003-08: leaving bookable capacity re-runs reservations.
    const flagged = await recheckTypes(db, [unit.typeId])
    const updated = await unitOf(db, id)
    return c.json({ ...updated, flaggedEvents: flagged })
  })
  .post("/types/:id/bulk-adjust", v("json", bulkBody), async (c) => {
    const me = authorize(c, "inventory.manage")
    const db = c.var.db
    const typeId = c.req.param("id")
    const type = await typeOf(db, typeId)
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
    const stock = await db
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

    if (from !== null)
      await db
        .update(bulkStock)
        .set(bucketDelta(from, -qty))
        .where(eq(bulkStock.typeId, typeId))
        .run()
    if (to !== null)
      await db
        .update(bulkStock)
        .set(bucketDelta(to, qty))
        .where(eq(bulkStock.typeId, typeId))
        .run()
    // Removing stock is recorded as moving it to retired (status_history.to_status is required).
    await db
      .insert(statusHistory)
      .values({
        typeId,
        fromStatus: from,
        toStatus: to ?? "retired",
        qty,
        actorId: me.id,
        reason,
      })
      .run()
    await audit(db, {
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
    const flagged = capacityDrops ? await recheckTypes(db, [typeId]) : []
    return c.json({
      typeId,
      counts: (await countsByType(db)).get(typeId) ?? emptyCounts(),
      flaggedEvents: flagged,
    })
  })
  .post("/availability", v("json", availabilityBody), async (c) => {
    const me = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const { intervals, issues } = toIntervals(body.days, config.tz)
    if (issues.length)
      throw badRequest("DAY_INVALID", issues[0]!.message, issues)
    const window: Interval = eventWindow(intervals)
    const types = await loadTypes(db, eq(equipmentTypes.status, "active"))
    const avail = await availability(
      db,
      types.map((t) => t.t.id),
      window,
      intervals[0]!.day,
      { excludeEventId: body.excludeEventId ?? undefined }
    )
    const grants = await grantsFor(db, me.id)
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
