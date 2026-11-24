import { type Permission, type PermissionContext, can } from "@studio/domain"
import { eq } from "drizzle-orm"
import type { Context, MiddlewareHandler } from "hono"
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import { roleAssignments, users } from "../db/schema.ts"
import type { AppEnv, SessionUser } from "../env.ts"
import { forbidden, unauthorized } from "./errors.ts"

const COOKIE = "sid"

export async function startSession(c: Context<AppEnv>, userId: string): Promise<void> {
  await setSignedCookie(c, COOKIE, userId, config.sessionSecret, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: !config.devMode,
    maxAge: 12 * 3600, // BR-001-10 absolute timeout
  })
}

export function endSession(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE, { path: "/" })
}

export function loadSessionUser(db: DB, userId: string): SessionUser | null {
  const u = db.select().from(users).where(eq(users.id, userId)).get()
  if (!u || u.status !== "active") return null
  const roles = db
    .select({ role: roleAssignments.role, studioId: roleAssignments.studioId })
    .from(roleAssignments)
    .where(eq(roleAssignments.userId, u.id))
    .all()
  return { id: u.id, email: u.email, displayName: u.displayName, affiliation: u.affiliation, roles }
}

/** Resolves the session cookie into c.var.user (null when signed out). */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = await getSignedCookie(c, config.sessionSecret, COOKIE)
  c.set("user", userId ? loadSessionUser(c.var.db, userId) : null)
  await next()
}

export function requireUser(c: Context<AppEnv>): SessionUser {
  const u = c.var.user
  if (!u) throw unauthorized()
  return u
}

/** Server-side permission check (BR-001-12). Throws 401/403. */
export function authorize(c: Context<AppEnv>, perm: Permission, ctx?: PermissionContext): SessionUser {
  const u = requireUser(c)
  if (!can(u.roles, perm, ctx)) throw forbidden()
  return u
}
