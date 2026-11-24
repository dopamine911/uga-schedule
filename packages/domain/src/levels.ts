import type { LocalDate } from "./time.ts"

// F-002 §4 effective level.

export interface GrantLike {
  levelRank: number
  validFrom: LocalDate
  /** null = open-ended. Inclusive. */
  validUntil: LocalDate | null
  /** Revocation date; the grant is inactive from this day on. */
  revokedOn: LocalDate | null
}

export function grantActiveOn(g: GrantLike, day: LocalDate): boolean {
  return (
    g.validFrom <= day &&
    (g.validUntil === null || day <= g.validUntil) &&
    (g.revokedOn === null || day < g.revokedOn)
  )
}

/** Highest rank among grants active on `day`; 0 when none. Higher levels include lower (D-02). */
export function effectiveLevel(grants: readonly GrantLike[], day: LocalDate): number {
  let best = 0
  for (const g of grants) if (grantActiveOn(g, day) && g.levelRank > best) best = g.levelRank
  return best
}

/** Minimum effective level over every event day (D-05: every day must be covered). */
export function eventLevel(grants: readonly GrantLike[], days: readonly LocalDate[]): number {
  if (days.length === 0) return 0
  return Math.min(...days.map((d) => effectiveLevel(grants, d)))
}

/** First event day on which the user's effective level is below `requiredRank`, or null. */
export function firstUncoveredDay(
  grants: readonly GrantLike[],
  days: readonly LocalDate[],
  requiredRank: number,
): LocalDate | null {
  for (const d of days) if (effectiveLevel(grants, d) < requiredRank) return d
  return null
}
