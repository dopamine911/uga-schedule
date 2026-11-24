import { and, desc, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"
import { notifications } from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { requireUser } from "../lib/auth.ts"
import { now } from "../lib/clock.ts"
import { notFound } from "../lib/errors.ts"

// F-010 in-app inbox. Every notification is an inbox row (BR-010-01).

export const routes = new Hono<AppEnv>()
  .get("/", (c) => {
    const user = requireUser(c)
    const rows = c.var.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, user.id))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(100)
      .all()
    return c.json(
      rows.map((n) => ({
        id: n.id,
        code: n.code,
        eventId: n.eventId,
        subject: n.subject,
        body: n.body,
        createdAt: n.createdAt,
        readAt: n.readAt,
      })),
    )
  })
  .get("/unread-count", (c) => {
    const user = requireUser(c)
    const rows = c.var.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt)))
      .all()
    return c.json({ count: rows.length })
  })
  .post("/read-all", (c) => {
    const user = requireUser(c)
    const res = c.var.db
      .update(notifications)
      .set({ readAt: now() })
      .where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt)))
      .run()
    return c.json({ updated: res.changes })
  })
  .post("/:id/read", (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const n = db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, c.req.param("id")), eq(notifications.recipientId, user.id)))
      .get()
    if (!n) throw notFound("Notification")
    const readAt = n.readAt ?? now()
    db.update(notifications).set({ readAt }).where(eq(notifications.id, n.id)).run()
    return c.json({ id: n.id, readAt })
  })
