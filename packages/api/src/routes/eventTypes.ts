import {
  STAGE_ANCHORS,
  STAGE_KINDS,
  STAGE_RECIPIENTS,
  TERMINAL,
} from "@studio/domain"
import { and, asc, eq, inArray, not } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { DB } from "../db/client.ts"
import {
  eventTypeStudios,
  eventTypes,
  events,
  stageTemplates,
  studios,
} from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { audit } from "../lib/audit.ts"
import { authorize, requireUser } from "../lib/auth.ts"
import { badRequest, conflict, notFound } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"
import { isStaff } from "./users.ts"

// F-005: event types, their allowed studios, and pre-event stage schedules.

const MIN_OFFSET_MINUTES = -90 * 1440 // BR-005-10
const MAX_OFFSET_MINUTES = 30 * 1440

type EventTypeRow = typeof eventTypes.$inferSelect

export interface StageView {
  id: string
  seq: number
  name: string
  kind: (typeof STAGE_KINDS)[number]
  anchor: (typeof STAGE_ANCHORS)[number]
  offsetMinutes: number
  recipients: (typeof STAGE_RECIPIENTS)[number][]
  assigneeRole: "requester" | "sponsor" | "studio_staff" | null
  blocksCheckout: boolean
  message: string
}

/** Non-archived stage templates per event type, sorted by seq (BR-005-07). */
async function stagesByType(
  db: DB,
  typeIds?: readonly string[]
): Promise<Map<string, StageView[]>> {
  const out = new Map<string, StageView[]>()
  const rows = await db
    .select()
    .from(stageTemplates)
    .where(
      and(
        eq(stageTemplates.archived, false),
        typeIds ? inArray(stageTemplates.eventTypeId, [...typeIds]) : undefined
      )
    )
    .orderBy(asc(stageTemplates.seq))
    .all()
  for (const r of rows) {
    const list = out.get(r.eventTypeId) ?? []
    list.push({
      id: r.id,
      seq: r.seq,
      name: r.name,
      kind: r.kind,
      anchor: r.anchor,
      offsetMinutes: r.offsetMinutes,
      recipients: r.recipients,
      assigneeRole: r.assigneeRole ?? null,
      blocksCheckout: r.blocksCheckout,
      message: r.message,
    })
    out.set(r.eventTypeId, list)
  }
  return out
}

async function studiosByType(
  db: DB,
  typeIds?: readonly string[]
): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>()
  const rows = await db
    .select({
      eventTypeId: eventTypeStudios.eventTypeId,
      id: studios.id,
      name: studios.name,
    })
    .from(eventTypeStudios)
    .innerJoin(studios, eq(studios.id, eventTypeStudios.studioId))
    .where(
      typeIds ? inArray(eventTypeStudios.eventTypeId, [...typeIds]) : undefined
    )
    .orderBy(asc(studios.name))
    .all()
  for (const r of rows) {
    const list = out.get(r.eventTypeId) ?? []
    list.push({ id: r.id, name: r.name })
    out.set(r.eventTypeId, list)
  }
  return out
}

function typeView(
  t: EventTypeRow,
  allowed: { id: string; name: string }[],
  stages: StageView[]
) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    status: t.status,
    maxDays: t.maxDays,
    maxHoursPerDay: t.maxHoursPerDay,
    dailyEquipmentReturn: t.dailyEquipmentReturn,
    pickupWindowMinutes: t.pickupWindowMinutes,
    checkinGraceMinutes: t.checkinGraceMinutes,
    requiresResults: t.requiresResults,
    resultsDueDays: t.resultsDueDays,
    requesterCanUpload: t.requesterCanUpload,
    requiresSponsorSignoff: t.requiresSponsorSignoff,
    allowedStudios: allowed,
    stages,
  }
}

async function loadTypes(db: DB, staff: boolean, id?: string) {
  const rows = await db
    .select()
    .from(eventTypes)
    .where(
      and(
        id ? eq(eventTypes.id, id) : undefined,
        staff ? undefined : eq(eventTypes.status, "active")
      )
    )
    .orderBy(asc(eventTypes.name))
    .all()
  const ids = rows.map((r) => r.id)
  const allowed = await studiosByType(db, ids)
  const stages = await stagesByType(db, ids)
  return rows.map((r) =>
    typeView(r, allowed.get(r.id) ?? [], stages.get(r.id) ?? [])
  )
}

const typeFields = {
  name: z.string().trim().min(1),
  description: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  maxDays: z.number().int().positive().optional(),
  maxHoursPerDay: z.number().int().positive().optional(),
  dailyEquipmentReturn: z.boolean().optional(),
  pickupWindowMinutes: z.number().int().min(0).optional(),
  checkinGraceMinutes: z.number().int().min(0).optional(),
  requiresResults: z.boolean().optional(),
  resultsDueDays: z.number().int().min(0).optional(),
  requesterCanUpload: z.boolean().optional(),
  requiresSponsorSignoff: z.boolean().optional(),
}
const typeBase = z.object(typeFields)
const typeBody = typeBase.extend({
  allowedStudioIds: z.array(z.string()).min(1, "Pick at least one studio."),
})
const typePatch = typeBase.partial().extend({
  allowedStudioIds: z
    .array(z.string())
    .min(1, "Pick at least one studio.")
    .optional(),
  /** Admin confirmation to deactivate while events are still running (BR-005-08). */
  confirmRunningEvents: z.boolean().optional(),
})
const stageItem = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(STAGE_KINDS),
  anchor: z.enum(STAGE_ANCHORS),
  offsetMinutes: z
    .number()
    .int()
    .min(MIN_OFFSET_MINUTES, "Offsets go back at most 90 days.")
    .max(MAX_OFFSET_MINUTES, "Offsets go forward at most 30 days."),
  recipients: z.array(z.enum(STAGE_RECIPIENTS)),
  assigneeRole: z.enum(["requester", "sponsor", "studio_staff"]).nullish(),
  blocksCheckout: z.boolean().optional(),
  message: z.string().optional(),
})
const stagesBody = z.array(stageItem)

function assertStageRules(items: z.infer<typeof stagesBody>): void {
  items.forEach((s, i) => {
    if (s.kind === "task" && !s.assigneeRole)
      throw badRequest(
        "TASK_ASSIGNEE_REQUIRED",
        `Stage ${i + 1} is a task and needs an assignee role.`
      )
    if (s.kind === "reminder" && s.blocksCheckout)
      throw badRequest(
        "REMINDER_BLOCKS",
        `Stage ${i + 1} is a reminder and cannot block checkout.`
      )
  })
}

async function assertStudiosExist(
  db: DB,
  ids: readonly string[]
): Promise<void> {
  const found = await db
    .select({ id: studios.id })
    .from(studios)
    .where(inArray(studios.id, [...ids]))
    .all()
  if (found.length !== new Set(ids).size)
    throw badRequest("UNKNOWN_STUDIO", "Unknown studio.")
}

async function typeOf(db: DB, id: string): Promise<EventTypeRow> {
  const t = await db
    .select()
    .from(eventTypes)
    .where(eq(eventTypes.id, id))
    .get()
  if (!t) throw notFound("Event type")
  return t
}

export const routes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const me = requireUser(c)
    return c.json(await loadTypes(c.var.db, isStaff(me)))
  })
  .get("/:id", async (c) => {
    const me = requireUser(c)
    const [t] = await loadTypes(c.var.db, isStaff(me), c.req.param("id"))
    if (!t) throw notFound("Event type")
    return c.json(t)
  })
  .post("/", v("json", typeBody), async (c) => {
    const me = authorize(c, "event_type.manage")
    const db = c.var.db
    const { allowedStudioIds, ...fields } = c.req.valid("json")
    await assertStudiosExist(db, allowedStudioIds)
    const t = await db
      .insert(eventTypes)
      .values({ ...fields, description: fields.description ?? "" })
      .returning()
      .get()
    await db
      .insert(eventTypeStudios)
      .values(
        [...new Set(allowedStudioIds)].map((studioId) => ({
          eventTypeId: t.id,
          studioId,
        }))
      )
      .run()
    await audit(db, {
      actorId: me.id,
      action: "event_type.create",
      entityType: "event_type",
      entityId: t.id,
      after: t,
    })
    const [created] = await loadTypes(db, true, t.id)
    return c.json(created, 201)
  })
  .patch("/:id", v("json", typePatch), async (c) => {
    const me = authorize(c, "event_type.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = await typeOf(db, id)
    const { allowedStudioIds, confirmRunningEvents, ...fields } =
      c.req.valid("json")
    if (allowedStudioIds) await assertStudiosExist(db, allowedStudioIds)
    if (
      fields.status === "inactive" &&
      before.status === "active" &&
      !confirmRunningEvents
    ) {
      const running = (
        await db
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.eventTypeId, id),
              not(inArray(events.state, [...TERMINAL]))
            )
          )
          .all()
      ).length
      if (running > 0)
        throw conflict(
          "EVENT_TYPE_IN_USE",
          "This event type still has open events. Confirm to let them keep running under the current version.",
          { openEvents: running }
        )
    }
    const after = await db
      .update(eventTypes)
      .set({ ...fields, name: fields.name ?? before.name })
      .where(eq(eventTypes.id, id))
      .returning()
      .get()
    if (allowedStudioIds) {
      await db
        .delete(eventTypeStudios)
        .where(eq(eventTypeStudios.eventTypeId, id))
        .run()
      await db
        .insert(eventTypeStudios)
        .values(
          [...new Set(allowedStudioIds)].map((studioId) => ({
            eventTypeId: id,
            studioId,
          }))
        )
        .run()
    }
    await audit(db, {
      actorId: me.id,
      action: "event_type.update",
      entityType: "event_type",
      entityId: id,
      before,
      after,
    })
    const [updated] = await loadTypes(db, true, id)
    return c.json(updated)
  })
  .put("/:id/stages", v("json", stagesBody), async (c) => {
    const me = authorize(c, "event_type.manage")
    const db = c.var.db
    const id = c.req.param("id")
    await typeOf(db, id)
    const items = c.req.valid("json")
    assertStageRules(items)
    const previous = (await stagesByType(db, [id])).get(id) ?? []
    // BR-005-07: existing instances keep their snapshot, so old templates are archived, never deleted.
    await db
      .update(stageTemplates)
      .set({ archived: true })
      .where(eq(stageTemplates.eventTypeId, id))
      .run()
    if (items.length)
      await db
        .insert(stageTemplates)
        .values(
          items.map((s, i) => ({
            eventTypeId: id,
            seq: i + 1,
            name: s.name,
            kind: s.kind,
            anchor: s.anchor,
            offsetMinutes: s.offsetMinutes,
            recipients: s.recipients,
            assigneeRole: s.kind === "task" ? (s.assigneeRole ?? null) : null,
            blocksCheckout:
              s.kind === "task" ? (s.blocksCheckout ?? false) : false,
            message: s.message ?? "",
          }))
        )
        .run()
    await audit(db, {
      actorId: me.id,
      action: "event_type.stages",
      entityType: "event_type",
      entityId: id,
      before: previous,
      after: items,
    })
    return c.json((await stagesByType(db, [id])).get(id) ?? [])
  })
