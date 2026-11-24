import type { StageRecipient } from "@studio/domain"
import { and, eq } from "drizzle-orm"
import type { DB } from "../db/client.ts"
import {
  eventParticipants,
  events,
  notifications,
  roleAssignments,
} from "../db/schema.ts"

/**
 * In-app notification (F-010). Every notification is an inbox row; email delivery is not wired in v0 and is
 * logged to stdout instead. Idempotent per (key, recipient) (BR-010-02).
 */
export function notify(
  db: DB,
  n: {
    code: string
    to: readonly string[]
    eventId?: string | null
    subject: string
    body: string
    key: string
  }
): void {
  for (const recipientId of new Set(n.to)) {
    const res = db
      .insert(notifications)
      .values({
        code: n.code,
        recipientId,
        eventId: n.eventId ?? null,
        subject: n.subject,
        body: n.body,
        dedupeKey: `${n.key}:${recipientId}`,
      })
      .onConflictDoNothing()
      .run()
    if (res.changes > 0 && process.env.NODE_ENV !== "test")
      console.log(`[email stub] ${n.code} → ${recipientId}: ${n.subject}`)
  }
}

/** User ids for the given audience of an event (stage recipients, F-005). */
export function eventAudience(
  db: DB,
  eventId: string,
  who: readonly StageRecipient[]
): string[] {
  const ev = db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return []
  const out = new Set<string>()
  if (who.includes("requester")) out.add(ev.requesterId)
  if (who.includes("sponsor") && ev.sponsorId) out.add(ev.sponsorId)
  if (who.includes("participants"))
    for (const p of db
      .select()
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))
      .all())
      out.add(p.userId)
  if (who.includes("studio_staff"))
    for (const r of db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.role, "STUDIO_STAFF"),
          eq(roleAssignments.studioId, ev.studioId)
        )
      )
      .all())
      out.add(r.userId)
  return [...out]
}
