import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { stageInstances } from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import {
  allowed,
  canCompleteStage,
  visibleEvent,
} from "../services/lifecycle.ts"
import { audit } from "../lib/audit.ts"
import { requireUser } from "../lib/auth.ts"
import { now } from "../lib/clock.ts"
import { conflict, forbidden, notFound } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"

// F-005 pre-event tasks (BR-005-05/06).

const reasonBody = z.object({ reason: z.string().trim().min(1) })

export const routes = new Hono<AppEnv>()
  .post("/:id/complete", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const stage = await db
      .select()
      .from(stageInstances)
      .where(eq(stageInstances.id, c.req.param("id")))
      .get()
    if (!stage) throw notFound("Task")
    const ev = await visibleEvent(db, user, stage.eventId)
    if (stage.kind !== "task")
      throw conflict("NOT_A_TASK", "Only tasks can be completed.")
    if (stage.status !== "open" && stage.status !== "overdue")
      throw conflict("INVALID_STATE", `This task is ${stage.status}.`)
    if (!canCompleteStage(user, ev, stage)) throw forbidden()
    const updated = await db
      .update(stageInstances)
      .set({ status: "done", completedBy: user.id, completedAt: now() })
      .where(eq(stageInstances.id, stage.id))
      .returning()
      .get()
    await audit(db, {
      actorId: user.id,
      action: "stage.complete",
      entityType: "stage_instance",
      entityId: stage.id,
      before: { status: stage.status },
      after: { status: "done" },
    })
    return c.json({
      id: updated.id,
      status: updated.status,
      completedAt: updated.completedAt,
    })
  })
  .post("/:id/override", v("json", reasonBody), async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const stage = await db
      .select()
      .from(stageInstances)
      .where(eq(stageInstances.id, c.req.param("id")))
      .get()
    if (!stage) throw notFound("Task")
    const ev = await visibleEvent(db, user, stage.eventId)
    if (!allowed(user, "stage.override_block", ev.studioId)) throw forbidden()
    const blocking =
      stage.kind === "task" &&
      stage.blocksCheckout &&
      (stage.status === "open" || stage.status === "overdue")
    if (!blocking)
      throw conflict(
        "NOT_BLOCKING",
        "Only an open task that blocks checkout can be overridden."
      )
    const updated = await db
      .update(stageInstances)
      .set({
        status: "overridden",
        overrideReason: body.reason,
        completedBy: user.id,
        completedAt: now(),
      })
      .where(eq(stageInstances.id, stage.id))
      .returning()
      .get()
    await audit(db, {
      actorId: user.id,
      action: "stage.override",
      entityType: "stage_instance",
      entityId: stage.id,
      before: { status: stage.status },
      after: { status: "overridden" },
      reason: body.reason,
    })
    return c.json({
      id: updated.id,
      status: updated.status,
      overrideReason: updated.overrideReason,
    })
  })
