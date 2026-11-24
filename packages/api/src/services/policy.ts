import type { DB } from "../db/client.ts"
import { policies } from "../db/schema.ts"

/** Admin-configurable values with defaults (BR-006-05 and related rules). */
export const POLICY_DEFAULTS = {
  LEAD_TIME_HOURS: 48,
  ADVANCE_DAYS: 60,
  WEEKLY_HOURS: 10,
  OPEN_CAP: 3,
  SPONSOR_SLA_HOURS: 72,
  STAFF_SLA_HOURS: 48,
  DECISION_CUTOFF_HOURS: 24,
  NO_SHOW_GRACE_MINUTES: 30,
  GRANT_EXPIRY_WARN_DAYS: 7,
  LOST_AFTER_DAYS: 7,
  LATE_HOLD_CLEAR_DAYS: 7,
  RESULTS_RETENTION_DAYS: 365,
  SIGNOFF_PUBLISH_AFTER_DAYS: 14,
} as const

export type PolicyKey = keyof typeof POLICY_DEFAULTS
export type Policies = Record<PolicyKey, number>

export function getPolicies(db: DB): Policies {
  const out: Policies = { ...POLICY_DEFAULTS }
  for (const row of db.select().from(policies).all()) {
    if (row.key in out) out[row.key as PolicyKey] = row.value
  }
  return out
}
