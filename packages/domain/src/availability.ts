import type { UnitStatus } from "./enums.ts"
import { type Interval, overlaps } from "./time.ts"

// F-003 §3–4 equipment availability.

export interface UnitLike {
  status: UnitStatus
  /** ISO date (YYYY-MM-DD) a unit in repair is expected back. */
  expectedBack: string | null
}

export interface BulkLike {
  qtyAvailable: number
  qtyInUse: number
}

/**
 * Units that count toward bookable capacity for a window starting at `windowStartDay`.
 * available + in_use count; in_repair counts only when expected back at least one day before the window.
 */
export function serializedCapacity(
  units: readonly UnitLike[],
  windowStartDay: string
): number {
  let n = 0
  for (const u of units) {
    if (u.status === "available" || u.status === "in_use") n++
    else if (
      u.status === "in_repair" &&
      u.expectedBack &&
      u.expectedBack < windowStartDay
    )
      n++
  }
  return n
}

export function bulkCapacity(stock: BulkLike): number {
  return stock.qtyAvailable + stock.qtyInUse
}

export interface Reservation {
  equipmentTypeId: string
  qty: number
  window: Interval
  eventId: string
}

/** Sum of quantities reserved for `typeId` by reservations overlapping `window`, excluding `excludeEventId`. */
export function reservedQty(
  reservations: readonly Reservation[],
  typeId: string,
  window: Interval,
  excludeEventId?: string
): number {
  let n = 0
  for (const r of reservations) {
    if (r.equipmentTypeId !== typeId || r.eventId === excludeEventId) continue
    if (overlaps(r.window, window)) n += r.qty
  }
  return n
}

/**
 * Reservation window for an event: first day start → last day end (equipment stays out overnight, D-14).
 * Days must be sorted.
 */
export function eventWindow(days: readonly Interval[]): Interval {
  if (days.length === 0) throw new Error("event has no days")
  return { start: days[0]!.start, end: days[days.length - 1]!.end }
}

/** Far-future end used for equipment that is overdue and has no known return time. */
export const OPEN_END = "9999-12-31T23:59:59.000Z"
