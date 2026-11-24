import type { DB } from "../db/client.ts"
import { auditLog } from "../db/schema.ts"

/** Append-only audit entry (NFR-AUD-01). Call inside the same transaction as the change. */
export async function audit(
  db: DB,
  entry: {
    actorId: string | null
    action: string
    entityType: string
    entityId: string
    before?: unknown
    after?: unknown
    reason?: string
  }
): Promise<void> {
  await db
    .insert(auditLog)
    .values({
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? "",
    })
    .run()
}
