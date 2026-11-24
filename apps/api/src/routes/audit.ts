import { and, desc, eq, inArray } from "drizzle-orm"
import { type Context, Hono } from "hono"
import { z } from "zod"
import type { DB } from "../db/client.ts"
import { auditLog, users } from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { authorize } from "../lib/auth.ts"
import { now } from "../lib/clock.ts"
import { forbidden } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"

// NFR-AUD-02/03: append-only audit log, searchable by admins; Equipment Managers see inventory-side entries only.

const EQUIPMENT_MANAGER_TYPES = ["equipment_class", "equipment_type", "unit", "bulk_stock", "grant", "hold", "course", "enrollment"]
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
  before: unknown
  after: unknown
  reason: string
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = typeof value === "string" ? value : JSON.stringify(value)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv(rows: readonly AuditRow[]): string {
  const header = ["at", "actor", "action", "entity_type", "entity_id", "before", "after", "reason"]
  const lines = rows.map((r) =>
    [r.at, r.actorName ?? "", r.action, r.entityType, r.entityId, r.before, r.after, r.reason].map(csvCell).join(","),
  )
  return [header.join(","), ...lines].join("\n") + "\n"
}

function search(db: DB, filter: { entityType?: string; entityId?: string; restrictTo?: readonly string[] }, limit: number) {
  return db
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
        filter.entityType ? eq(auditLog.entityType, filter.entityType) : undefined,
        filter.entityId ? eq(auditLog.entityId, filter.entityId) : undefined,
        filter.restrictTo ? inArray(auditLog.entityType, [...filter.restrictTo]) : undefined,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit)
    .all()
}

const filterQuery = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
})

/** Admins see everything; Equipment Managers only inventory-side entries. Throws when they ask for other types. */
function scopeFor(c: Context<AppEnv>, q: z.infer<typeof filterQuery>) {
  const me = authorize(c, "audit.view")
  const isAdmin = me.roles.some((r) => r.role === "ADMIN")
  if (!isAdmin && q.entityType && !EQUIPMENT_MANAGER_TYPES.includes(q.entityType)) throw forbidden()
  return {
    entityType: q.entityType,
    entityId: q.entityId,
    restrictTo: isAdmin ? undefined : EQUIPMENT_MANAGER_TYPES,
  }
}

export const routes = new Hono<AppEnv>()
  .get("/", v("query", filterQuery), (c) => {
    const q = c.req.valid("query")
    return c.json(search(c.var.db, scopeFor(c, q), q.limit ?? DEFAULT_LIMIT))
  })
  .get("/export.csv", v("query", filterQuery), (c) => {
    const q = c.req.valid("query")
    const rows = search(c.var.db, scopeFor(c, q), q.limit ?? DEFAULT_LIMIT)
    const at = now().slice(0, 10)
    return c.body(toCsv(rows), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-${at}.csv"`,
    })
  })
