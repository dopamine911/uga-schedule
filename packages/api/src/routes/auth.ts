import { asc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { config } from "../config.ts"
import { roleAssignments, users } from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { endSession, loadSessionUser, requireUser, startSession } from "../lib/auth.ts"
import { forbidden, notFound } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"

// F-001. Production login is university SSO (OIDC/SAML) with JIT provisioning; not built in v0.
// Dev login lets you pick any seeded user.

export const routes = new Hono<AppEnv>()
  .get("/me", (c) => c.json({ user: c.var.user, devMode: config.devMode, tz: config.tz }))
  .get("/dev-users", (c) => {
    if (!config.devMode) throw forbidden()
    const db = c.var.db
    const rows = db.select().from(users).where(eq(users.status, "active")).orderBy(asc(users.displayName)).all()
    const roles = db.select().from(roleAssignments).all()
    return c.json(
      rows.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        roles: roles.filter((r) => r.userId === u.id).map((r) => ({ role: r.role, studioId: r.studioId })),
      })),
    )
  })
  .post("/dev-login", v("json", z.object({ userId: z.string() })), async (c) => {
    if (!config.devMode) throw forbidden()
    const { userId } = c.req.valid("json")
    const user = loadSessionUser(c.var.db, userId)
    if (!user) throw notFound("User")
    await startSession(c, user.id)
    return c.json({ user })
  })
  .post("/logout", (c) => {
    requireUser(c)
    endSession(c)
    return c.json({ ok: true })
  })
