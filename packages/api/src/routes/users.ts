import {
  PERMISSIONS,
  type Permission,
  ROLES,
  type RoleCode,
  STUDIO_SCOPED_PERMISSIONS,
  can,
  effectivePermissions,
  utcToLocal,
} from "@studio/domain"
import { and, asc, count, eq, inArray, isNull, like, or } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  holds,
  permissionDenials,
  roleAssignments,
  studios,
  users,
} from "../db/schema.ts"
import type { AppEnv, SessionUser } from "../env.ts"
import { audit } from "../lib/audit.ts"
import { authorize, requireUser } from "../lib/auth.ts"
import { now } from "../lib/clock.ts"
import { badRequest, conflict, notFound } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"
import { recheckEvents } from "../services/review.ts"
import { listGrants } from "./levels.ts"

// F-001: user directory and role administration.

const STAFF_ROLES: readonly RoleCode[] = [
  "STUDIO_STAFF",
  "EQUIPMENT_MANAGER",
  "ADMIN",
]

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

async function rolesOf(
  db: DB,
  userIds: readonly string[]
): Promise<Map<string, RoleView[]>> {
  const out = new Map<string, RoleView[]>()
  if (userIds.length === 0) return out
  const rows = await db
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

/**
 * Distinct active Admins who can still manage users and roles (BR-001-06): an Admin whose
 * role.assign permission was removed (BR-001-14) cannot rescue the system, so they don't count.
 */
async function activeAdminIds(db: DB): Promise<string[]> {
  const blocked = new Set(
    (
      await db
        .select({ id: permissionDenials.userId })
        .from(permissionDenials)
        .where(
          and(
            eq(permissionDenials.permission, "role.assign"),
            isNull(permissionDenials.studioId)
          )
        )
        .all()
    ).map((r) => r.id)
  )
  return [
    ...new Set(
      (
        await db
          .select({ id: users.id })
          .from(roleAssignments)
          .innerJoin(users, eq(users.id, roleAssignments.userId))
          .where(
            and(eq(roleAssignments.role, "ADMIN"), eq(users.status, "active"))
          )
          .all()
      )
        .map((r) => r.id)
        .filter((id) => !blocked.has(id))
    ),
  ]
}

async function denialsOf(db: DB, userId: string) {
  return await db
    .select({
      permission: permissionDenials.permission,
      studioId: permissionDenials.studioId,
      studioName: studios.name,
      reason: permissionDenials.reason,
      createdAt: permissionDenials.createdAt,
      createdByName: users.displayName,
    })
    .from(permissionDenials)
    .leftJoin(users, eq(users.id, permissionDenials.createdBy))
    .leftJoin(studios, eq(studios.id, permissionDenials.studioId))
    .where(eq(permissionDenials.userId, userId))
    .all()
}

/** The denial row for (user, permission, studio); null studio = everywhere. */
async function findDenial(
  db: DB,
  userId: string,
  permission: Permission,
  studioId: string | null
) {
  return await db
    .select()
    .from(permissionDenials)
    .where(
      and(
        eq(permissionDenials.userId, userId),
        eq(permissionDenials.permission, permission),
        studioId === null
          ? isNull(permissionDenials.studioId)
          : eq(permissionDenials.studioId, studioId)
      )
    )
    .get()
}

async function getUser(db: DB, id: string) {
  const u = await db.select().from(users).where(eq(users.id, id)).get()
  if (!u) throw notFound("User")
  return u
}

const roleBody = z.object({
  role: z.enum(ROLES),
  studioId: z.string().nullish(),
})
const statusBody = z.object({ status: z.enum(["active", "disabled"]) })
const AFFILIATIONS = ["student", "faculty", "staff", "other"] as const
const profileBody = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  affiliation: z.enum(AFFILIATIONS),
})
const createBody = profileBody.extend({
  roles: z.array(roleBody).max(20).default([]),
})

/** BR-001-05 plus existence/duplicate checks for a set of role assignments. */
async function validateRoles(
  db: DB,
  roles: readonly { role: RoleCode; studioId?: string | null }[]
): Promise<void> {
  const seen = new Set<string>()
  for (const r of roles) {
    const studioId = r.studioId ?? null
    if (r.role === "STUDIO_STAFF" && !studioId)
      throw badRequest(
        "STUDIO_REQUIRED",
        "Studio Staff assignments must name a studio."
      )
    if (r.role !== "STUDIO_STAFF" && studioId)
      throw badRequest(
        "STUDIO_NOT_ALLOWED",
        "Only Studio Staff assignments name a studio."
      )
    if (
      studioId &&
      !(await db
        .select({ id: studios.id })
        .from(studios)
        .where(eq(studios.id, studioId))
        .get())
    )
      throw badRequest("UNKNOWN_STUDIO", "Unknown studio.")
    const key = `${r.role}:${studioId ?? ""}`
    if (seen.has(key))
      throw badRequest("DUPLICATE_ROLE", "The same role is listed twice.")
    seen.add(key)
  }
}

async function emailTaken(
  db: DB,
  email: string,
  exceptId?: string
): Promise<boolean> {
  const hit = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get()
  return !!hit && hit.id !== exceptId
}

export const routes = new Hono<AppEnv>()
  .get("/", v("query", z.object({ q: z.string().optional() })), async (c) => {
    authorize(c, "user.list")
    const db = c.var.db
    const q = c.req.valid("query").q?.trim()
    const rows = await db
      .select()
      .from(users)
      .where(
        q
          ? or(like(users.displayName, `%${q}%`), like(users.email, `%${q}%`))
          : undefined
      )
      .orderBy(asc(users.displayName))
      .all()
    const roles = await rolesOf(
      db,
      rows.map((u) => u.id)
    )
    const deniedCounts = new Map(
      (
        await db
          .select({ userId: permissionDenials.userId, n: count() })
          .from(permissionDenials)
          .groupBy(permissionDenials.userId)
          .all()
      ).map((r) => [r.userId, r.n])
    )
    return c.json(
      rows.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        affiliation: u.affiliation,
        linked: !u.idpSubject.startsWith("pending:"),
        status: u.status,
        roles: roles.get(u.id) ?? [],
        deniedCount: deniedCounts.get(u.id) ?? 0,
      }))
    )
  })
  .get("/sponsors", async (c) => {
    requireUser(c)
    const rows = await c.var.db
      .selectDistinct({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .innerJoin(roleAssignments, eq(roleAssignments.userId, users.id))
      .where(
        and(eq(roleAssignments.role, "SPONSOR"), eq(users.status, "active"))
      )
      .orderBy(asc(users.displayName))
      .all()
    return c.json(rows)
  })
  // People picker for participants and holds: names only, and only for a typed query, so it cannot list the directory.
  .get(
    "/search",
    v("query", z.object({ q: z.string().default("") })),
    async (c) => {
      requireUser(c)
      const q = c.req.valid("query").q.trim()
      if (q.length < 2) return c.json([])
      const rows = await c.var.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(
          and(
            eq(users.status, "active"),
            or(like(users.displayName, `%${q}%`), like(users.email, `${q}%`))
          )
        )
        .orderBy(asc(users.displayName))
        .limit(10)
        .all()
      return c.json(rows)
    }
  )
  // Pre-provisions an account before first sign-in (F-001 §5). The SSO identity is linked on first login
  // by email; until then the subject is a placeholder that can never match a real IdP subject.
  .post("/", v("json", createBody), async (c) => {
    const me = authorize(c, "role.assign")
    const db = c.var.db
    const body = c.req.valid("json")
    if (await emailTaken(db, body.email))
      throw conflict(
        "EMAIL_TAKEN",
        "An account with this email already exists."
      )
    await validateRoles(db, body.roles)
    const u = await db
      .insert(users)
      .values({
        idpSubject: `pending:${body.email}`,
        email: body.email,
        displayName: body.displayName,
        affiliation: body.affiliation,
      })
      .returning()
      .get()
    await audit(db, {
      actorId: me.id,
      action: "user.create",
      entityType: "user",
      entityId: u.id,
      after: {
        email: u.email,
        displayName: u.displayName,
        affiliation: u.affiliation,
      },
    })
    for (const r of body.roles) {
      const a = await db
        .insert(roleAssignments)
        .values({
          userId: u.id,
          role: r.role,
          studioId: r.studioId ?? null,
          source: "manual",
          assignedBy: me.id,
        })
        .returning()
        .get()
      await audit(db, {
        actorId: me.id,
        action: "role.assign",
        entityType: "role_assignment",
        entityId: a.id,
        after: { userId: u.id, role: r.role, studioId: r.studioId ?? null },
      })
    }
    const created = u
    return c.json(
      {
        id: created.id,
        displayName: created.displayName,
        email: created.email,
      },
      201
    )
  })
  .put("/:id/profile", v("json", profileBody), async (c) => {
    const me = authorize(c, "role.assign")
    const db = c.var.db
    const u = await getUser(db, c.req.param("id"))
    const body = c.req.valid("json")
    if (await emailTaken(db, body.email, u.id))
      throw conflict(
        "EMAIL_TAKEN",
        "An account with this email already exists."
      )
    await db
      .update(users)
      .set({
        displayName: body.displayName,
        email: body.email,
        affiliation: body.affiliation,
        // Keep an unlinked placeholder subject in step with the email it will be matched by.
        ...(u.idpSubject.startsWith("pending:")
          ? { idpSubject: `pending:${body.email}` }
          : {}),
      })
      .where(eq(users.id, u.id))
      .run()
    await audit(db, {
      actorId: me.id,
      action: "user.update",
      entityType: "user",
      entityId: u.id,
      before: {
        displayName: u.displayName,
        email: u.email,
        affiliation: u.affiliation,
      },
      after: body,
    })
    return c.json({ id: u.id, ...body })
  })
  .get("/:id", async (c) => {
    const me = requireUser(c)
    const id = c.req.param("id")
    if (me.id !== id && !can(me, "user.list")) throw notFound("User")
    const db = c.var.db
    const u = await getUser(db, id)
    const activeHoldCount =
      (
        await db
          .select({ n: count() })
          .from(holds)
          .where(and(eq(holds.userId, id), eq(holds.status, "active")))
          .get()
      )?.n ?? 0
    const roles = (await rolesOf(db, [id])).get(id) ?? []
    const denials = await denialsOf(db, id)
    return c.json({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      affiliation: u.affiliation,
      status: u.status,
      createdAt: u.createdAt,
      /** False until the person signs in with university SSO for the first time. */
      linked: !u.idpSubject.startsWith("pending:"),
      roles,
      grants: await listGrants(db, id),
      activeHoldCount,
      denials,
      /** What the roles grant, and where grants were removed individually (BR-001-14/15). */
      permissions: effectivePermissions({
        roles,
        denied: denials.map((d) => ({
          permission: d.permission,
          studioId: d.studioId,
        })),
      }),
    })
  })
  // BR-001-14/15: remove one permission from one user, everywhere or for one studio, whatever roles grant it.
  .post(
    "/:id/denials",
    v(
      "json",
      z.object({
        permission: z.enum(PERMISSIONS),
        studioId: z.string().nullable().default(null),
        reason: z.string().trim().min(3).max(500),
      })
    ),
    async (c) => {
      const me = authorize(c, "role.assign")
      const db = c.var.db
      const u = await getUser(db, c.req.param("id"))
      const { permission, studioId, reason } = c.req.valid("json")
      if (permission === "role.assign" && u.id === me.id)
        throw conflict(
          "SELF_LOCKOUT",
          "You can't remove your own permission to manage users and roles."
        )
      if (
        permission === "role.assign" &&
        (await activeAdminIds(db)).filter((id) => id !== u.id).length === 0
      )
        throw conflict(
          "LAST_ADMIN",
          "At least one active Admin must keep permission to manage users and roles."
        )
      if (studioId !== null) {
        if (!STUDIO_SCOPED_PERMISSIONS.includes(permission))
          throw badRequest(
            "NOT_STUDIO_SCOPED",
            "This permission applies system-wide and can't be removed for one studio."
          )
        if (
          !(await db
            .select({ id: studios.id })
            .from(studios)
            .where(eq(studios.id, studioId))
            .get())
        )
          throw badRequest("UNKNOWN_STUDIO", "Unknown studio.")
        // Removing something the roles don't give at that studio would be a no-op that reads like a restriction.
        if (
          !can(
            { roles: (await rolesOf(db, [u.id])).get(u.id) ?? [] },
            permission,
            {
              studioId,
            }
          )
        )
          throw badRequest(
            "NOT_GRANTED_THERE",
            "This person's roles don't give this permission at that studio."
          )
        if (await findDenial(db, u.id, permission, null))
          throw conflict(
            "ALREADY_REMOVED",
            "This permission is already removed everywhere for this user."
          )
      }
      if (await findDenial(db, u.id, permission, studioId))
        throw conflict(
          "ALREADY_REMOVED",
          "This permission is already removed for this user."
        )
      // An everywhere-removal supersedes per-studio ones; drop them so restoring is a single step.
      if (studioId === null)
        await db
          .delete(permissionDenials)
          .where(
            and(
              eq(permissionDenials.userId, u.id),
              eq(permissionDenials.permission, permission)
            )
          )
          .run()
      const row = await db
        .insert(permissionDenials)
        .values({
          userId: u.id,
          permission,
          studioId,
          reason,
          createdBy: me.id,
        })
        .returning()
        .get()
      await audit(db, {
        actorId: me.id,
        action: "permission.remove",
        entityType: "user",
        entityId: u.id,
        after: { permission, studioId },
        reason,
      })
      return c.json(
        {
          permission: row.permission,
          studioId: row.studioId,
          reason: row.reason,
          createdAt: row.createdAt,
        },
        201
      )
    }
  )
  .delete(
    "/:id/denials/:permission",
    v("param", z.object({ id: z.string(), permission: z.enum(PERMISSIONS) })),
    // studioId absent = the everywhere-removal.
    v("query", z.object({ studioId: z.string().optional() })),
    async (c) => {
      const me = authorize(c, "role.assign")
      const db = c.var.db
      const { id, permission } = c.req.valid("param")
      const studioId = c.req.valid("query").studioId ?? null
      const u = await getUser(db, id)
      const row = await findDenial(db, u.id, permission, studioId)
      if (!row) throw notFound("Removed permission")
      await db
        .delete(permissionDenials)
        .where(eq(permissionDenials.id, row.id))
        .run()
      await audit(db, {
        actorId: me.id,
        action: "permission.restore",
        entityType: "user",
        entityId: u.id,
        before: { permission, studioId, reason: row.reason },
      })
      return c.json({ ok: true })
    }
  )
  .post("/:id/roles", v("json", roleBody), async (c) => {
    const me = authorize(c, "role.assign")
    const db = c.var.db
    const userId = c.req.param("id")
    const { role } = c.req.valid("json")
    const studioId = c.req.valid("json").studioId ?? null
    await getUser(db, userId)
    await validateRoles(db, [{ role, studioId }])
    // NULL studioId is distinct in the unique index, so check duplicates here.
    const existing = await db
      .select()
      .from(roleAssignments)
      .where(
        and(eq(roleAssignments.userId, userId), eq(roleAssignments.role, role))
      )
      .all()
    if (existing.some((r) => r.studioId === studioId))
      throw conflict("DUPLICATE_ROLE", "The user already holds this role.")
    const row = await db
      .insert(roleAssignments)
      .values({ userId, role, studioId, source: "manual", assignedBy: me.id })
      .returning()
      .get()
    await audit(db, {
      actorId: me.id,
      action: "role.assign",
      entityType: "role_assignment",
      entityId: row.id,
      after: { userId, role, studioId },
    })
    const view: RoleView = {
      id: row.id,
      role: row.role,
      studioId: row.studioId,
      studioName: studioId
        ? ((
            await db
              .select()
              .from(studios)
              .where(eq(studios.id, studioId))
              .get()
          )?.name ?? null)
        : null,
      source: row.source,
    }
    return c.json(view, 201)
  })
  .delete("/:id/roles/:assignmentId", async (c) => {
    const me = authorize(c, "role.assign")
    const db = c.var.db
    const userId = c.req.param("id")
    const r = await db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.id, c.req.param("assignmentId")),
          eq(roleAssignments.userId, userId)
        )
      )
      .get()
    if (!r) throw notFound("Role assignment")
    if (r.role === "ADMIN") {
      const remaining = (await activeAdminIds(db)).filter((id) => id !== userId)
      if (remaining.length === 0)
        throw conflict(
          "LAST_ADMIN",
          "There must always be at least one active Admin."
        )
    }
    await db.delete(roleAssignments).where(eq(roleAssignments.id, r.id)).run()
    await audit(db, {
      actorId: me.id,
      action: "role.remove",
      entityType: "role_assignment",
      entityId: r.id,
      before: {
        userId,
        role: r.role,
        studioId: r.studioId,
        source: r.source,
      },
    })
    return c.json({ ok: true })
  })
  .patch("/:id", v("json", statusBody), async (c) => {
    const me = authorize(c, "role.assign")
    const db = c.var.db
    const u = await getUser(db, c.req.param("id"))
    const { status } = c.req.valid("json")
    if (status === u.status)
      return c.json({
        id: u.id,
        status: u.status,
        flaggedEvents: [] as string[],
      })
    if (
      status === "disabled" &&
      (await activeAdminIds(db)).filter((id) => id !== u.id).length === 0
    )
      throw conflict(
        "LAST_ADMIN",
        "There must always be at least one active Admin."
      )
    await db.update(users).set({ status }).where(eq(users.id, u.id)).run()
    await audit(db, {
      actorId: me.id,
      action: status === "disabled" ? "user.disable" : "user.enable",
      entityType: "user",
      entityId: u.id,
      before: { status: u.status },
      after: { status },
    })
    const flaggedEvents =
      status === "disabled" ? await recheckEvents(db, { sponsorId: u.id }) : []
    return c.json({ id: u.id, status, flaggedEvents })
  })
