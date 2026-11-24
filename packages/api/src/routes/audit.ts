import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { type Context, Hono } from "hono"
import { z } from "zod"
import type { DB } from "../db/client.ts"
import {
  auditLog,
  courseOfferings,
  equipmentClasses,
  equipmentTypes,
  equipmentUnits,
  eventTypes,
  events,
  levels,
  studios,
  users,
} from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { authorize } from "../lib/auth.ts"
import { now } from "../lib/clock.ts"
import { forbidden } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"

// NFR-AUD-02/03: append-only audit log, searchable by admins; Equipment Managers see inventory, grant and hold entries only.

/** Every entity type the API writes audit entries for (the `audit(…)` calls in routes/ and services/). */
const ENTITY_TYPES = [
  "blackout",
  "bulk_stock",
  "checkout_record",
  "course",
  "enrollment",
  "equipment_class",
  "equipment_type",
  "event",
  "event_type",
  "grant",
  "hold",
  "level",
  "policy",
  "result_item",
  "result_package",
  "role_assignment",
  "stage_instance",
  "studio",
  "unit",
  "user",
] as const
const EQUIPMENT_MANAGER_TYPES: readonly string[] = [
  "equipment_class",
  "equipment_type",
  "unit",
  "bulk_stock",
  "grant",
  "hold",
]
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

export interface AuditRow {
  id: string
  at: string
  actorId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string
  /** Human name of the entity when it can be resolved (event title, user name …); null otherwise. */
  entityLabel: string | null
  before: unknown
  after: unknown
  reason: string
}

interface Labelled {
  id: string
  label: string
}

/** One batched lookup per entity type that has a human name. Types not listed here have no label. */
const LABEL_LOOKUPS: Record<
  string,
  (db: DB, ids: string[]) => Promise<Labelled[]>
> = {
  event: async (db, ids) =>
    await db
      .select({ id: events.id, label: events.title })
      .from(events)
      .where(inArray(events.id, ids))
      .all(),
  user: async (db, ids) =>
    await db
      .select({ id: users.id, label: users.displayName })
      .from(users)
      .where(inArray(users.id, ids))
      .all(),
  studio: async (db, ids) =>
    await db
      .select({ id: studios.id, label: studios.name })
      .from(studios)
      .where(inArray(studios.id, ids))
      .all(),
  equipment_type: async (db, ids) =>
    await db
      .select({ id: equipmentTypes.id, label: equipmentTypes.name })
      .from(equipmentTypes)
      .where(inArray(equipmentTypes.id, ids))
      .all(),
  equipment_class: async (db, ids) =>
    await db
      .select({ id: equipmentClasses.id, label: equipmentClasses.name })
      .from(equipmentClasses)
      .where(inArray(equipmentClasses.id, ids))
      .all(),
  unit: async (db, ids) =>
    await db
      .select({ id: equipmentUnits.id, label: equipmentUnits.assetTag })
      .from(equipmentUnits)
      .where(inArray(equipmentUnits.id, ids))
      .all(),
  event_type: async (db, ids) =>
    await db
      .select({ id: eventTypes.id, label: eventTypes.name })
      .from(eventTypes)
      .where(inArray(eventTypes.id, ids))
      .all(),
  level: async (db, ids) =>
    await db
      .select({ id: levels.id, label: levels.name })
      .from(levels)
      .where(inArray(levels.id, ids))
      .all(),
  course: async (db, ids) =>
    (
      await db
        .select({
          id: courseOfferings.id,
          label: courseOfferings.courseCode,
          term: courseOfferings.term,
        })
        .from(courseOfferings)
        .where(inArray(courseOfferings.id, ids))
        .all()
    ).map((c) => ({ id: c.id, label: `${c.label} · ${c.term}` })),
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = typeof value === "string" ? value : JSON.stringify(value)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv(rows: readonly AuditRow[]): string {
  const header = [
    "at",
    "actor",
    "action",
    "entity_type",
    "entity_id",
    "entity_label",
    "before",
    "after",
    "reason",
  ]
  const lines = rows.map((r) =>
    [
      r.at,
      r.actorName ?? "",
      r.action,
      r.entityType,
      r.entityId,
      r.entityLabel ?? "",
      r.before,
      r.after,
      r.reason,
    ]
      .map(csvCell)
      .join(",")
  )
  return [header.join(","), ...lines].join("\n") + "\n"
}

interface Scope {
  entityType?: string
  entityId?: string
  action?: string
  actorId?: string
  from?: string
  to?: string
  restrictTo?: readonly string[]
}

/** Resolves entity names with one query per entity type present in `rows` (never one per row). */
async function entityLabels(
  db: DB,
  rows: readonly { entityType: string; entityId: string }[]
): Promise<Map<string, string>> {
  const idsByType = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!(r.entityType in LABEL_LOOKUPS)) continue
    const ids = idsByType.get(r.entityType) ?? new Set<string>()
    ids.add(r.entityId)
    idsByType.set(r.entityType, ids)
  }
  const labels = new Map<string, string>()
  for (const [type, ids] of idsByType) {
    for (const hit of await LABEL_LOOKUPS[type]!(db, [...ids]))
      labels.set(`${type}:${hit.id}`, hit.label)
  }
  return labels
}

async function search(
  db: DB,
  filter: Scope,
  limit: number
): Promise<AuditRow[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      actorId: auditLog.actorId,
      actorName: users.displayName,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      reason: auditLog.reason,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(
      and(
        filter.entityType
          ? eq(auditLog.entityType, filter.entityType)
          : undefined,
        filter.entityId ? eq(auditLog.entityId, filter.entityId) : undefined,
        filter.action
          ? sql`${auditLog.action} like ${`%${filter.action.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`} escape '\\'`
          : undefined,
        filter.actorId ? eq(auditLog.actorId, filter.actorId) : undefined,
        filter.from ? gte(auditLog.at, filter.from) : undefined,
        filter.to ? lte(auditLog.at, filter.to) : undefined,
        filter.restrictTo
          ? inArray(auditLog.entityType, [...filter.restrictTo])
          : undefined
      )
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit)
    .all()
  const labels = await entityLabels(db, rows)
  return rows.map((r) => ({
    ...r,
    entityLabel: labels.get(`${r.entityType}:${r.entityId}`) ?? null,
  }))
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const dateOrInstant = z
  .string()
  .refine(
    (s) => !Number.isNaN(Date.parse(s)),
    "Expected an ISO date or instant."
  )
  .optional()

/** Bound on the `at` column (UTC ISO instants). A bare date covers that whole UTC day. */
function bound(
  value: string | undefined,
  edge: "start" | "end"
): string | undefined {
  if (!value) return undefined
  if (DATE_ONLY.test(value))
    return edge === "start"
      ? `${value}T00:00:00.000Z`
      : `${value}T23:59:59.999Z`
  return new Date(value).toISOString()
}

const filterQuery = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  action: z.string().trim().optional(),
  actorId: z.string().optional(),
  from: dateOrInstant,
  to: dateOrInstant,
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
})

/** Admins see everything; Equipment Managers only inventory-side entries. Throws when they ask for other types. */
function scopeFor(c: Context<AppEnv>, q: z.infer<typeof filterQuery>): Scope {
  const admin = authorize(c, "audit.view").roles.some((r) => r.role === "ADMIN")
  if (!admin && q.entityType && !EQUIPMENT_MANAGER_TYPES.includes(q.entityType))
    throw forbidden()
  return {
    entityType: q.entityType,
    entityId: q.entityId,
    action: q.action,
    actorId: q.actorId,
    from: bound(q.from, "start"),
    to: bound(q.to, "end"),
    restrictTo: admin ? undefined : EQUIPMENT_MANAGER_TYPES,
  }
}

export const routes = new Hono<AppEnv>()
  .get("/", v("query", filterQuery), async (c) => {
    const q = c.req.valid("query")
    return c.json(
      await search(c.var.db, scopeFor(c, q), q.limit ?? DEFAULT_LIMIT)
    )
  })
  /** Entity types the caller may filter by. */
  .get("/entity-types", (c) => {
    const admin = authorize(c, "audit.view").roles.some(
      (r) => r.role === "ADMIN"
    )
    const types: string[] = admin
      ? [...ENTITY_TYPES]
      : ENTITY_TYPES.filter((t) => EQUIPMENT_MANAGER_TYPES.includes(t))
    return c.json(types)
  })
  .get("/export.csv", v("query", filterQuery), async (c) => {
    const q = c.req.valid("query")
    const rows = await search(
      c.var.db,
      scopeFor(c, q),
      q.limit ?? DEFAULT_LIMIT
    )
    const at = now().slice(0, 10)
    return c.body(toCsv(rows), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-${at}.csv"`,
    })
  })
