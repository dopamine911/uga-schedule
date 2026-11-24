import {
  type IssueCode,
  REVIEWABLE,
  type ReviewReason,
  validateSubmission,
} from "@studio/domain"
import { and, eq, inArray } from "drizzle-orm"
import type { DB } from "../db/client.ts"
import { equipmentLines, events } from "../db/schema.ts"
import { eventAudience, notify } from "../lib/notify.ts"
import { now } from "../lib/clock.ts"
import { buildSubmissionContext, draftOf } from "./booking.ts"

// BR-002-09, BR-003-08, BR-004-06/07, BR-007-11: re-run eligibility/availability for open events after
// something they depend on changed, and raise needs_review instead of cancelling.

const REASON_OF: Partial<Record<IssueCode, ReviewReason>> = {
  LEVEL_STUDIO: "ELIGIBILITY_LOST",
  LEVEL_EQUIPMENT: "ELIGIBILITY_LOST",
  EQUIPMENT_SHORTAGE: "EQUIPMENT_SHORTAGE",
  EQUIPMENT_INACTIVE: "EQUIPMENT_SHORTAGE",
  BLACKOUT: "STUDIO_BLACKOUT",
  OUTSIDE_HOURS: "OUTSIDE_HOURS",
  STUDIO_INACTIVE: "OUTSIDE_HOURS",
  SPONSOR_INVALID: "SPONSOR_INACTIVE",
  HOLD_ACTIVE: "HOLD_ACTIVE",
}

export interface RecheckScope {
  requesterId?: string
  sponsorId?: string
  studioId?: string
  equipmentTypeId?: string
  eventIds?: string[]
}

/** Returns ids of events that gained at least one new review reason. */
export async function recheckEvents(
  db: DB,
  scope: RecheckScope
): Promise<string[]> {
  let ids: string[]
  if (scope.eventIds) ids = scope.eventIds
  else if (scope.equipmentTypeId)
    ids = (
      await db
        .select({ id: equipmentLines.eventId })
        .from(equipmentLines)
        .where(eq(equipmentLines.equipmentTypeId, scope.equipmentTypeId))
        .all()
    ).map((r) => r.id)
  else
    ids = (
      await db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            scope.requesterId
              ? eq(events.requesterId, scope.requesterId)
              : undefined,
            scope.sponsorId ? eq(events.sponsorId, scope.sponsorId) : undefined,
            scope.studioId ? eq(events.studioId, scope.studioId) : undefined
          )
        )
        .all()
    ).map((r) => r.id)
  if (ids.length === 0) return []

  const open = await db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.id, [...new Set(ids)]),
        inArray(events.state, [...REVIEWABLE])
      )
    )
    .all()
  const flagged: string[] = []
  for (const ev of open) {
    const draft = await draftOf(db, ev.id)
    // Shortage is attributed to the later-created event (US-003-03): only count earlier reservations.
    const ctx = await buildSubmissionContext(db, draft, {
      excludeEventId: ev.id,
      createdBefore: ev.createdAt,
    })
    const issues = validateSubmission(ctx)
    const reasons = [
      ...new Set(
        issues
          .map((i) => REASON_OF[i.code])
          .filter((r): r is ReviewReason => !!r)
      ),
    ]
    const added = reasons.filter((r) => !ev.reviewReasons.includes(r))
    if (added.length === 0) continue
    const merged = [...new Set([...ev.reviewReasons, ...reasons])]
    await db
      .update(events)
      .set({ needsReview: true, reviewReasons: merged, updatedAt: now() })
      .where(eq(events.id, ev.id))
      .run()
    await notify(db, {
      code: "NEEDS_REVIEW",
      to: await eventAudience(db, ev.id, ["studio_staff", "sponsor"]),
      eventId: ev.id,
      subject: `Needs review: ${ev.title}`,
      body: issues
        .filter((i) => REASON_OF[i.code] && added.includes(REASON_OF[i.code]!))
        .map((i) => i.message)
        .join("\n"),
      key: `NEEDS_REVIEW:${ev.id}:${added.sort().join(",")}:${ev.updatedAt}`,
    })
    flagged.push(ev.id)
  }
  return flagged
}
