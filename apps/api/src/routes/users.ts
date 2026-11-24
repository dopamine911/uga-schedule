import { ROLES, type RoleCode, can, utcToLocal } from "@studio/domain"
import { and, asc, count, eq, inArray, like, or } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import { holds, roleAssignments, studios, users } from "../db/schema.ts"
import type { AppEnv, SessionUser } from "../env.ts"
import { audit } from "../lib/audit.ts"
import { authorize, requireUser } from "../lib/auth.ts"
import { now } from "../lib/clock.ts"
import { badRequest, conflict, notFound } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"
import { recheckEvents } from "../services/review.ts"
import { listGrants } from "./levels.ts"

// F-001: user directory and role administration.

const STAFF_ROLES: readonly RoleCode[] = ["STUDIO_STAFF", "EQUIPMENT_MANAGER", "ADMIN"]

/** Staff roles see inactive catalog entries and unit details (BR-003-11); students and sponsors do not. */
export function isStaff(user: SessionUser): boolean {
  return user.roles.some((r) => STAFF_ROLES.includes(r.role))
}

/** Today's calendar date in the campus time zone. */
export function today(): string {
  return utcToLocal(now(), config.tz).day
}

export interface RoleView {
  id: string
  role: RoleCode
  studioId: string | null
  studioName: string | null
  source: "auto" | "manual"
}

function rolesOf(db: DB, userIds: readonly string[]): Map<string, RoleView[]> {
  const out = new Map<string, RoleView[]>()
  if (userIds.length === 0) return out
  const rows = db
    .select({
      id: roleAssignments.id,
      userId: roleAssignments.userId,
      role: roleAssignments.role,
      studioId: roleAssignments.studioId,
      studioName: studios.name,
      source: roleAssignments.source,
    })
    .from(roleAssignments)
    .leftJoin(studios, eq(studios.id, roleAssignments.studioId))
    .where(inArray(roleAssignments.userId, [...userIds]))
    .all()
  for (const { userId, ...r } of rows) {
    const list = out.get(userId) ?? []
    list.push(r)
    out.set(userId, list)
  }
  return out
}

/** Distinct active users holding ADMIN (BR-001-06). */
function activeAdminIds(db: DB): string[] {
  return [
    ...new Set(
      db
        .select({ id: users.id })
        .from(roleAssignments)
        .innerJoin(users, eq(users.id, roleAssignments.userId))
        .where(and(eq(roleAssignments.role, "ADMIN"), eq(users.status, "active")))
        .all()
        .map((r) => r.id),
    ),
  ]
}

function getUser(db: DB, id: string) {
  const u = db.select().from(users).where(eq(users.id, id)).get()
  if (!u) throw notFound("User")
  return u
}

const roleBody = z.object({ role: z.enum(ROLES), studioId: z.string().nullish() })
const statusBody = z.object({ status: z.enum(["active", "disabled"]) })

export const routes = new Hono<AppEnv>()
  .get("/", v("query", z.object({ q: z.string().optional() })), (c) => {
    authorize(c, "user.list")
    const db = c.var.db
    const q = c.req.valid("query").q?.trim()
    const rows = db
      .select()
      .from(users)
      .where(q ? or(like(users.displayName, `%${q}%`), like(users.email, `%${q}%`)) : undefined)
      .orderBy(asc(users.displayName))
      .all()
    const roles = rolesOf(
      db,
      rows.map((u) => u.id),
    )
    return c.json(
      rows.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        affiliation: u.affiliation,
        status: u.status,
        roles: roles.get(u.id) ?? [],
      })),
    )
  })
  .get("/sponsors", (c) => {
    requireUser(c)
    const rows = c.var.db
      .selectDistinct({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .innerJoin(roleAssignments, eq(roleAssignments.userId, users.id))
      .where(and(eq(roleAssignments.role, "SPONSOR"), eq(users.status, "active")))
      .orderBy(asc(users.displayName))
      .all()
    return c.json(rows)
  })
  .get("/search", v("query", z.object({ q: z.string().default("") })), (c) => {
    requireUser(c)
    const q = c.req.valid("query").q.trim()
    const rows = c.var.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(
        and(
          eq(users.status, "active"),
          q ? or(like(users.displayName, `%${q}%`), like(users.email, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(asc(users.displayName))
      .limit(20)
      .all()
    return c.json(rows)
  })
  .get("/:id", (c) => {
    const me = requireUser(c)
    const id = c.req.param("id")
    if (me.id !== id && !can(me.roles, "user.list")) throw notFound("User")
    const db = c.var.db
    const u = getUser(db, id)
    const activeHoldCount =
      db
        .select({ n: count() })
        .from(holds)
        .where(and(eq(holds.userId, id), eq(holds.status, "active")))
        .get()?.n ?? 0
    return c.json({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      affiliation: u.affiliation,
      status: u.status,
      createdAt: u.createdAt,
      roles: rolesOf(db, [id]).get(id) ?? [],
      grants: listGrants(db, id),
      activeHoldCount,
    })
  })
  .post("/:id/roles", v("json", roleBody), (c) => {
    const me = authorize(c, "role.assign")
    const db = c.var.db
    const userId = c.req.param("id")
    const { role } = c.req.valid("json")
    const studioId = c.req.valid("json").studioId ?? null
    getUser(db, userId)
    // BR-001-05
    if (role === "STUDIO_STAFF" && !studioId)
      throw badRequest("STUDIO_REQUIRED", "Studio Staff assignments must name a studio.")
    if (role !== "STUDIO_STAFF" && studioId)
      throw badRequest("STUDIO_NOT_ALLOWED", "Only Studio Staff assignments name a studio.")
    if (studioId && !db.select({ id: studios.id }).from(studios).where(eq(studios.id, studioId)).get())
      throw badRequest("UNKNOWN_STUDIO", "Unknown studio.")
    // NULL studioId is distinct in the unique index, so check duplicates here.
    const existing = db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.role, role)))
      .all()
    if (existing.some((r) => r.studioId === studioId))
      throw conflict("DUPLICATE_ROLE", "The user already holds this role.")
    const row = db.transaction(() => {
      const r = db
        .insert(roleAssignments)
        .values({ userId, role, studioId, source: "manual", assignedBy: me.id })
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "role.assign",
        entityType: "role_assignment",
        entityId: r.id,
        after: { userId, role, studioId },
      })
      return r
    })
    const view: RoleView = {
      id: row.id,
      role: row.role,
      studioId: row.studioId,
      studioName: studioId ? (db.select().from(studios).where(eq(studios.id, studioId)).get()?.name ?? null) : null,
      source: row.source,
    }
    return c.json(view, 201)
  })
  .delete("/:id/roles/:assignmentId", (c) => {
    const me = authorize(c, "role.assign")
    const db = c.var.db
    const userId = c.req.param("id")
    const r = db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.id, c.req.param("assignmentId")), eq(roleAssignments.userId, userId)))
      .get()
    if (!r) throw notFound("Role assignment")
    if (r.role === "ADMIN") {
      const remaining = activeAdminIds(db).filter((id) => id !== userId)
      if (remaining.length === 0) throw conflict("LAST_ADMIN", "There must always be at least one active Admin.")
    }
    db.transaction(() => {
      db.delete(roleAssignments).where(eq(roleAssignments.id, r.id)).run()
      audit(db, {
        actorId: me.id,
        action: "role.remove",
        entityType: "role_assignment",
        entityId: r.id,
        before: { userId, role: r.role, studioId: r.studioId, source: r.source },
      })
    })
    return c.json({ ok: true })
  })
  .patch("/:id", v("json", statusBody), (c) => {
    const me = authorize(c, "role.assign")
    const db = c.var.db
    const u = getUser(db, c.req.param("id"))
    const { status } = c.req.valid("json")
    if (status === u.status) return c.json({ id: u.id, status: u.status, flaggedEvents: [] as string[] })
    if (status === "disabled" && activeAdminIds(db).filter((id) => id !== u.id).length === 0)
      throw conflict("LAST_ADMIN", "There must always be at least one active Admin.")
    const flaggedEvents = db.transaction(() => {
      db.update(users).set({ status }).where(eq(users.id, u.id)).run()
      audit(db, {
        actorId: me.id,
        action: status === "disabled" ? "user.disable" : "user.enable",
        entityType: "user",
        entityId: u.id,
        before: { status: u.status },
        after: { status },
      })
      return status === "disabled" ? recheckEvents(db, { sponsorId: u.id }) : []
    })
    return c.json({ id: u.id, status, flaggedEvents })
  })
