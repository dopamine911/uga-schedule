import { type Issue, blockingTasks } from "@studio/domain"
import { and, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  acknowledgements,
  bulkStock,
  checkoutRecords,
  equipmentLines,
  equipmentTypes,
  equipmentUnits,
  stageInstances,
} from "../db/schema.ts"
import type { AppEnv, SessionUser } from "../env.ts"
import { requireUser } from "../lib/auth.ts"
import { audit } from "../lib/audit.ts"
import { now } from "../lib/clock.ts"
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts"
import { notify } from "../lib/notify.ts"
import { v } from "../lib/validate.ts"
import { checkDraft, draftOf, hasActiveHold } from "../services/booking.ts"
import { getPolicies } from "../services/policy.ts"
import {
  type EventRow,
  addDaysIso,
  advancePostEvent,
  allowed,
  checkinComplete,
  eventSpan,
  getEvent,
  localLabel,
  moveBulk,
  moveEvent,
  outstandingQty,
  pickupOpensAt,
  placeHold,
  recordsOf,
  returnDueAt,
  setUnitStatus,
  stagesOf,
  visibleEvent,
} from "../services/lifecycle.ts"

// F-007 checkout and check-in.

export interface Blocker {
  code: string
  message: string
  overridable: boolean
}

const lineSchema = z.object({
  lineId: z.string(),
  unitIds: z.array(z.string()).optional(),
  qty: z.number().int().min(0).optional(),
  unfilledReason: z.string().optional(),
})
const checkoutBody = z.object({
  acknowledged: z.literal(true),
  taskOverrideReason: z.string().optional(),
  lines: z.array(lineSchema).default([]),
})
const checkinBody = z.object({
  items: z.array(
    z.object({
      recordId: z.string(),
      condition: z.enum(["ok", "damaged", "missing"]).optional(),
      qtyOk: z.number().int().min(0).optional(),
      qtyDamaged: z.number().int().min(0).optional(),
      qtyMissing: z.number().int().min(0).optional(),
      notes: z.string().optional(),
    })
  ),
})

/** Start-grace cutoff: after this the event counts as a no-show (BR-006-13, BR-007-01). */
async function noShowAt(db: DB, ev: EventRow): Promise<string | null> {
  const span = await eventSpan(db, ev.id)
  if (!span) return null
  return new Date(
    Date.parse(span.start) +
      (await getPolicies(db)).NO_SHOW_GRACE_MINUTES * 60_000
  ).toISOString()
}

/** BR-007-02 pre-checks. Overridable blockers can be waived with a reason; the rest cannot. */
async function blockersFor(db: DB, ev: EventRow): Promise<Blocker[]> {
  const out: Blocker[] = []
  if (ev.state !== "Confirmed")
    out.push({
      code: "NOT_CONFIRMED",
      message: `The event is ${ev.state}.`,
      overridable: false,
    })
  if (ev.needsReview)
    out.push({
      code: "NEEDS_REVIEW",
      message: "Resolve the review flag on this request first.",
      overridable: false,
    })
  for (const s of blockingTasks(await stagesOf(db, ev.id)))
    out.push({
      code: "TASK_BLOCKING",
      message: `Task not complete: ${s.name}`,
      overridable: true,
    })

  const issues: Issue[] = await checkDraft(db, await draftOf(db, ev.id), ev.id)
  for (const i of issues)
    if (i.code === "LEVEL_STUDIO" || i.code === "LEVEL_EQUIPMENT")
      out.push({ code: i.code, message: i.message, overridable: false })
  if (await hasActiveHold(db, ev.requesterId))
    out.push({
      code: "HOLD_ACTIVE",
      message: "The requester has an active hold. Clear it under Holds first.",
      overridable: false,
    })

  const opens = await pickupOpensAt(db, ev)
  if (opens && Date.parse(now()) < Date.parse(opens))
    out.push({
      code: "PICKUP_NOT_OPEN",
      message: `Pickup opens ${localLabel(opens)}.`,
      overridable: false,
    })
  const cutoff = await noShowAt(db, ev)
  if (cutoff && Date.parse(now()) > Date.parse(cutoff))
    out.push({
      code: "NO_SHOW",
      message: "The start grace period has passed; the event is a no-show.",
      overridable: false,
    })
  return out
}

function blockedError(blockers: readonly Blocker[]) {
  return conflict(
    "CHECKOUT_BLOCKED",
    blockers.map((b) => b.message).join(" "),
    { blockers }
  )
}

async function linesOf(db: DB, eventId: string) {
  return await db
    .select({
      id: equipmentLines.id,
      equipmentTypeId: equipmentLines.equipmentTypeId,
      qty: equipmentLines.qty,
      note: equipmentLines.note,
      typeName: equipmentTypes.name,
      tracking: equipmentTypes.tracking,
    })
    .from(equipmentLines)
    .innerJoin(
      equipmentTypes,
      eq(equipmentTypes.id, equipmentLines.equipmentTypeId)
    )
    .where(eq(equipmentLines.eventId, eventId))
    .all()
}

function requireCheckout(user: SessionUser, ev: EventRow): void {
  if (!allowed(user, "checkout.perform", ev.studioId)) throw forbidden()
}

export const routes = new Hono<AppEnv>()
  .get("/:eventId", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const ev = await visibleEvent(db, user, c.req.param("eventId"))
    requireCheckout(user, ev)
    const lines = await linesOf(db, ev.id)
    const typeIds = [...new Set(lines.map((l) => l.equipmentTypeId))]
    const units = typeIds.length
      ? await db
          .select({
            id: equipmentUnits.id,
            typeId: equipmentUnits.typeId,
            assetTag: equipmentUnits.assetTag,
          })
          .from(equipmentUnits)
          .where(
            and(
              inArray(equipmentUnits.typeId, typeIds),
              eq(equipmentUnits.status, "available")
            )
          )
          .all()
      : []
    const stock = typeIds.length
      ? await db
          .select()
          .from(bulkStock)
          .where(inArray(bulkStock.typeId, typeIds))
          .all()
      : []
    const typeNames = new Map(lines.map((l) => [l.equipmentTypeId, l.typeName]))
    const assetTags = new Map(
      (
        await db
          .select({ id: equipmentUnits.id, assetTag: equipmentUnits.assetTag })
          .from(equipmentUnits)
          .all()
      ).map((u) => [u.id, u.assetTag])
    )
    return c.json({
      state: ev.state,
      termsVersion: config.termsVersion,
      window: {
        opensAt: await pickupOpensAt(db, ev),
        noShowAt: await noShowAt(db, ev),
      },
      blockers: await blockersFor(db, ev),
      lines: lines.map((l) => ({
        lineId: l.id,
        equipmentTypeId: l.equipmentTypeId,
        typeName: l.typeName,
        tracking: l.tracking,
        qty: l.qty,
        candidates:
          l.tracking === "serialized"
            ? units
                .filter((u) => u.typeId === l.equipmentTypeId)
                .map((u) => ({ unitId: u.id, assetTag: u.assetTag }))
            : [],
        bulkAvailable:
          l.tracking === "bulk"
            ? (stock.find((s) => s.typeId === l.equipmentTypeId)
                ?.qtyAvailable ?? 0)
            : null,
      })),
      outstanding: (await recordsOf(db, ev.id))
        .filter((r) => outstandingQty(r) > 0)
        .map((r) => ({
          recordId: r.id,
          equipmentLineId: r.equipmentLineId,
          typeName: typeNames.get(r.equipmentTypeId) ?? "",
          assetTag: r.unitId ? (assetTags.get(r.unitId) ?? null) : null,
          qty: r.qty,
          outstanding: outstandingQty(r),
          outAt: r.outAt,
          dueAt: r.dueAt,
          late: r.late,
        })),
    })
  })
  .post("/:eventId", v("json", checkoutBody), async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const ev = await visibleEvent(db, user, c.req.param("eventId"))
    requireCheckout(user, ev)
    const at = now()
    const current = (await getEvent(db, ev.id))!
    const blockers = await blockersFor(db, current)
    if (blockers.some((b) => !b.overridable)) throw blockedError(blockers)

    const openTasks = blockingTasks(await stagesOf(db, current.id))
    if (openTasks.length) {
      const reason = body.taskOverrideReason?.trim() ?? ""
      if (!reason) throw blockedError(blockers)
      if (!allowed(user, "stage.override_block", current.studioId))
        throw forbidden()
      for (const s of openTasks) {
        await db
          .update(stageInstances)
          .set({
            status: "overridden",
            overrideReason: reason,
            completedBy: user.id,
            completedAt: at,
          })
          .where(eq(stageInstances.id, s.id))
          .run()
        await audit(db, {
          actorId: user.id,
          action: "stage.override",
          entityType: "stage_instance",
          entityId: s.id,
          before: { status: s.status },
          after: { status: "overridden" },
          reason,
        })
      }
    }

    const lines = await linesOf(db, current.id)
    const dueAt = await returnDueAt(db, current)
    const byLine = new Map(body.lines.map((l) => [l.lineId, l] as const))
    for (const id of byLine.keys())
      if (!lines.some((x) => x.id === id))
        throw badRequest("UNKNOWN_LINE", "Unknown equipment line.")

    const receipt: string[] = []
    for (const line of lines) {
      const input = byLine.get(line.id)
      let fulfilled = 0
      if (line.tracking === "serialized") {
        const unitIds = [...new Set(input?.unitIds ?? [])]
        if (unitIds.length > line.qty)
          throw badRequest(
            "TOO_MANY_UNITS",
            `${line.typeName}: ${line.qty} requested.`
          )
        for (const unitId of unitIds) {
          const unit = await db
            .select()
            .from(equipmentUnits)
            .where(eq(equipmentUnits.id, unitId))
            .get()
          if (!unit) throw badRequest("UNKNOWN_UNIT", "Unknown unit.")
          if (unit.typeId !== line.equipmentTypeId)
            throw badRequest(
              "UNIT_TYPE_MISMATCH",
              `${unit.assetTag} is not a ${line.typeName}.`
            )
          if (unit.status !== "available")
            throw conflict(
              "UNIT_UNAVAILABLE",
              `${unit.assetTag} is ${unit.status.replace("_", " ")}.`
            )
          await db
            .insert(checkoutRecords)
            .values({
              eventId: current.id,
              equipmentLineId: line.id,
              equipmentTypeId: line.equipmentTypeId,
              unitId,
              qty: 1,
              outAt: at,
              outBy: user.id,
              dueAt,
            })
            .run()
          await setUnitStatus(
            db,
            unit,
            "in_use",
            user.id,
            current.id,
            "checked out"
          )
          receipt.push(`${line.typeName} ${unit.assetTag}`)
        }
        fulfilled = unitIds.length
      } else {
        const qty = input?.qty ?? 0
        if (qty > line.qty)
          throw badRequest(
            "TOO_MANY_UNITS",
            `${line.typeName}: ${line.qty} requested.`
          )
        const stock = await db
          .select()
          .from(bulkStock)
          .where(eq(bulkStock.typeId, line.equipmentTypeId))
          .get()
        if (qty > (stock?.qtyAvailable ?? 0))
          throw conflict(
            "STOCK_SHORT",
            `${line.typeName}: ${stock?.qtyAvailable ?? 0} available.`
          )
        if (qty > 0) {
          await db
            .insert(checkoutRecords)
            .values({
              eventId: current.id,
              equipmentLineId: line.id,
              equipmentTypeId: line.equipmentTypeId,
              qty,
              outAt: at,
              outBy: user.id,
              dueAt,
            })
            .run()
          await moveBulk(
            db,
            line.equipmentTypeId,
            "qtyAvailable",
            "qtyInUse",
            qty,
            user.id,
            current.id,
            "checked out"
          )
          receipt.push(`${line.typeName} ×${qty}`)
        }
        fulfilled = qty
      }
      // BR-007-05: the line is reduced to what went out; the unfilled remainder is recorded with a reason.
      const unfilled = line.qty - fulfilled
      await db
        .update(equipmentLines)
        .set({
          qty: fulfilled,
          note:
            unfilled > 0
              ? `Unfilled ${unfilled}: ${input?.unfilledReason ?? "not provided"}`
              : line.note,
        })
        .where(eq(equipmentLines.id, line.id))
        .run()
    }

    await db
      .insert(acknowledgements)
      .values({
        eventId: current.id,
        userId: current.requesterId,
        termsVersion: config.termsVersion,
      })
      .run()
    const started = await moveEvent(
      db,
      current,
      "start",
      user.id,
      {},
      "checkout"
    )
    await audit(db, {
      actorId: user.id,
      action: "checkout.complete",
      entityType: "event",
      entityId: current.id,
      after: { dueAt },
    })
    await notify(db, {
      code: "CHECKOUT_RECEIPT",
      to: [current.requesterId],
      eventId: current.id,
      subject: `Equipment checked out: ${current.title}`,
      body: `${receipt.length ? receipt.join(", ") : "No equipment"}. Return by ${localLabel(dueAt)}.`,
      key: `CHECKOUT_RECEIPT:${current.id}`,
    })
    return c.json({
      eventId: started.id,
      state: started.state,
      dueAt,
      checkedOut: receipt.length,
    })
  })
  .post("/:eventId/checkin", v("json", checkinBody), async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const ev = await visibleEvent(db, user, c.req.param("eventId"))
    requireCheckout(user, ev)
    if (ev.state !== "InProgress" && ev.state !== "PostEvent")
      throw conflict(
        "INVALID_STATE",
        `Check-in is not available while the event is ${ev.state}.`
      )
    const at = now()
    const policies = await getPolicies(db)
    const byId = new Map((await recordsOf(db, ev.id)).map((r) => [r.id, r]))
    const types = new Map(
      (await db.select().from(equipmentTypes).all()).map((t) => [t.id, t])
    )
    let lateDue: string | null = null

    for (const item of body.items) {
      const r = byId.get(item.recordId)
      if (!r) throw notFound("Checkout record")
      const outstanding = outstandingQty(r)
      if (outstanding === 0)
        throw conflict(
          "ALREADY_RETURNED",
          "This item has already been checked in."
        )
      const type = types.get(r.equipmentTypeId)!
      const notes = item.notes?.trim() ?? ""

      let ok: number
      let damaged: number
      let missing: number
      let condition: "ok" | "damaged" | "missing"
      if (type.tracking === "serialized") {
        if (!item.condition)
          throw badRequest(
            "CONDITION_REQUIRED",
            "Choose a condition for each unit."
          )
        condition = item.condition
        ok = condition === "ok" ? 1 : 0
        damaged = condition === "damaged" ? 1 : 0
        missing = condition === "missing" ? 1 : 0
      } else {
        ok = item.qtyOk ?? 0
        damaged = item.qtyDamaged ?? 0
        missing = item.qtyMissing ?? 0
        if (ok + damaged + missing !== outstanding)
          throw badRequest(
            "QTY_MISMATCH",
            `${type.name}: ok + damaged + missing must equal the ${outstanding} still out.`
          )
        condition = damaged > 0 ? "damaged" : ok > 0 ? "ok" : "missing"
      }
      if (damaged > 0 && !notes)
        throw badRequest("NOTES_REQUIRED", "Damaged items need a note.")

      const returned = ok + damaged
      const late = returned > 0 && at > r.dueAt
      if (type.tracking === "serialized") {
        const unit = (await db
          .select()
          .from(equipmentUnits)
          .where(eq(equipmentUnits.id, r.unitId!))
          .get())!
        if (ok)
          await setUnitStatus(
            db,
            unit,
            "available",
            user.id,
            ev.id,
            "checked in"
          )
        if (damaged)
          await setUnitStatus(
            db,
            unit,
            "damaged",
            user.id,
            ev.id,
            "checked in damaged"
          )
      } else {
        await moveBulk(
          db,
          type.id,
          "qtyInUse",
          "qtyAvailable",
          ok,
          user.id,
          ev.id,
          "checked in"
        )
        await moveBulk(
          db,
          type.id,
          "qtyInUse",
          "qtyDamaged",
          damaged,
          user.id,
          ev.id,
          "checked in damaged"
        )
      }

      const updated = await db
        .update(checkoutRecords)
        .set({
          qtyOk: r.qtyOk + ok,
          qtyDamaged: r.qtyDamaged + damaged,
          qtyMissing: missing,
          inAt: returned > 0 ? (r.inAt ?? at) : r.inAt,
          inBy: returned > 0 ? user.id : r.inBy,
          conditionIn: condition,
          notes: notes ? (r.notes ? `${r.notes}\n${notes}` : notes) : r.notes,
          late: r.late || late,
        })
        .where(eq(checkoutRecords.id, r.id))
        .returning()
        .get()
      byId.set(updated.id, updated)
      await audit(db, {
        actorId: user.id,
        action: "checkout.checkin",
        entityType: "checkout_record",
        entityId: r.id,
        after: { ok, damaged, missing, late },
        reason: notes,
      })
      if (damaged > 0)
        await placeHold(db, {
          userId: ev.requesterId,
          reason: "DAMAGE",
          eventId: ev.id,
          source: "staff",
          note: `Damaged on return: ${type.name} ×${damaged}. ${notes}`,
          actorId: user.id,
        })
      if (late) lateDue = r.dueAt
    }

    if (lateDue)
      await placeHold(db, {
        userId: ev.requesterId,
        reason: "LATE_RETURN",
        eventId: ev.id,
        source: "system",
        note: `Returned after ${localLabel(lateDue)}.`,
        autoClearAt: addDaysIso(at, policies.LATE_HOLD_CLEAR_DAYS),
        actorId: user.id,
      })

    await advancePostEvent(db, ev.id, user.id)
    return c.json({
      complete: await checkinComplete(db, ev.id),
      items: [...byId.values()].map((r) => ({
        recordId: r.id,
        qtyOk: r.qtyOk,
        qtyDamaged: r.qtyDamaged,
        qtyMissing: r.qtyMissing,
        qtyLost: r.qtyLost,
        outstanding: outstandingQty(r),
        late: r.late,
        inAt: r.inAt,
      })),
    })
  })
