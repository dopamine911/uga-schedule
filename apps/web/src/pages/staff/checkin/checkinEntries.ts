import type {
  CheckinBody,
  CheckoutOutstanding,
} from "@/components/staff/shared"

export type Condition = "ok" | "damaged" | "missing"
export type Counts = "qtyOk" | "qtyDamaged" | "qtyMissing"

/** What staff entered for one outstanding record. Serialized units use `condition`; bulk uses the counts. */
export interface Entry {
  condition?: Condition
  qtyOk: number
  qtyDamaged: number
  qtyMissing: number
  notes: string
  /** The note field was opened with "Add note" (it also opens on its own for damage or missing). */
  noteOpen: boolean
}

export const blankEntry: Entry = {
  qtyOk: 0,
  qtyDamaged: 0,
  qtyMissing: 0,
  notes: "",
  noteOpen: false,
}

/** "Projector P-102" for a unit, "Projector ×2" for a bulk record. */
export function labelOf(r: CheckoutOutstanding): string {
  return r.assetTag === null
    ? `${r.typeName} ×${r.outstanding}`
    : `${r.typeName} ${r.assetTag}`
}

export function entryOf(
  entries: Record<string, Entry>,
  recordId: string
): Entry {
  return entries[recordId] ?? blankEntry
}

export interface CheckinRow {
  r: CheckoutOutstanding
  e: Entry
  isBulk: boolean
  touched: boolean
  ready: boolean
  invalid: boolean
  needsNote: boolean
  damaged: boolean
  missing: boolean
  showNote: boolean
  overdue: boolean
}

/**
 * A record is ready once fully resolved; untouched records are left out (partial check-in).
 * `now` is passed in so the derivation stays pure.
 */
export function deriveRows(
  outstanding: CheckoutOutstanding[],
  entries: Record<string, Entry>,
  now: number
): CheckinRow[] {
  return outstanding.map((r) => {
    const e = entryOf(entries, r.recordId)
    const isBulk = r.assetTag === null
    const sum = e.qtyOk + e.qtyDamaged + e.qtyMissing
    const damaged = isBulk ? e.qtyDamaged > 0 : e.condition === "damaged"
    const missing = isBulk ? e.qtyMissing > 0 : e.condition === "missing"
    const needsNote = damaged && !e.notes.trim()
    const touched = isBulk ? sum > 0 : e.condition !== undefined
    const ready = isBulk
      ? touched && sum === r.outstanding && !needsNote
      : touched && !needsNote
    return {
      r,
      e,
      isBulk,
      touched,
      ready,
      invalid: touched && !ready,
      needsNote,
      damaged,
      missing,
      // Damage always needs a note, so the field opens for it; missing and "Add note" open it on request.
      showNote: damaged || missing || e.noteOpen || e.notes !== "",
      overdue: Date.parse(r.dueAt) < now,
    }
  })
}

export function buildItems(readyRows: CheckinRow[]): CheckinBody["items"] {
  return readyRows.map(({ r, e }) => {
    const notes = e.notes.trim() || undefined
    return r.assetTag === null
      ? {
          recordId: r.recordId,
          qtyOk: e.qtyOk,
          qtyDamaged: e.qtyDamaged,
          qtyMissing: e.qtyMissing,
          notes,
        }
      : { recordId: r.recordId, condition: e.condition, notes }
  })
}
