import { toast } from "sonner"
import type {
  CheckoutBody,
  CheckoutLine,
  CheckoutView,
} from "@/components/staff/shared"

export const UNFILLED_REASONS = [
  { value: "unit_unavailable", label: "Unit unavailable" },
  { value: "declined_by_requester", label: "Declined by requester" },
] as const

/** What staff picked so far, keyed by line id. */
export interface CheckoutSelection {
  unitsByLine: Record<string, string[]>
  qtyByLine: Record<string, number>
  unfilledByLine: Record<string, string>
}

/** Which required fields may already show as invalid, and what else gates the submit. */
export interface CheckoutAttempt {
  overrideReason: string
  acknowledged: boolean
  submitTried: boolean
  overrideTouched: boolean
  unfilledTouched: Record<string, boolean>
  submitPending: boolean
}

/** One equipment line with its current selection and validation state. */
export interface CheckoutRow {
  line: CheckoutLine
  selectedUnits: string[]
  qtyValue: number | ""
  unfilledReason: string
  unfilled: number
  bulkOver: boolean
  unfilledInvalid: boolean
}

export type UnitsUpdater = (
  update: (m: Record<string, string[]>) => Record<string, string[]>
) => void

function selectedCount(line: CheckoutLine, sel: CheckoutSelection): number {
  return line.tracking === "serialized"
    ? (sel.unitsByLine[line.lineId]?.length ?? 0)
    : (sel.qtyByLine[line.lineId] ?? 0)
}

function buildRows(
  lines: CheckoutLine[],
  sel: CheckoutSelection,
  attempt: CheckoutAttempt
): CheckoutRow[] {
  return lines.map((line) => {
    const got = selectedCount(line, sel)
    const unfilled = line.qty - got
    return {
      line,
      selectedUnits: sel.unitsByLine[line.lineId] ?? [],
      qtyValue: sel.qtyByLine[line.lineId] ?? "",
      unfilledReason: sel.unfilledByLine[line.lineId] ?? "",
      unfilled,
      bulkOver: line.tracking === "bulk" && got > (line.bulkAvailable ?? 0),
      unfilledInvalid:
        unfilled > 0 &&
        !sel.unfilledByLine[line.lineId] &&
        (attempt.submitTried || !!attempt.unfilledTouched[line.lineId]),
    }
  })
}

/**
 * Rows, blocker split and validation flags for the current selection. Required fields show as
 * invalid only after a submit attempt or once the user has left them.
 */
export function deriveCheckout(
  view: CheckoutView | undefined,
  sel: CheckoutSelection,
  attempt: CheckoutAttempt
) {
  const blockers = view?.blockers ?? []
  const hard = blockers.filter((b) => !b.overridable)
  const overridable = blockers.filter((b) => b.overridable)
  const rows = buildRows(view?.lines ?? [], sel, attempt)
  const reasonMissing = rows.some(
    (r) => r.unfilled > 0 && !sel.unfilledByLine[r.line.lineId]
  )
  const bulkInvalid = rows.some((r) => r.bulkOver)
  const overrideMissing =
    overridable.length > 0 && !attempt.overrideReason.trim()
  const canComplete =
    hard.length === 0 &&
    !reasonMissing &&
    !bulkInvalid &&
    !overrideMissing &&
    attempt.acknowledged &&
    !attempt.submitPending
  return {
    rows,
    hasHardBlocker: hard.length > 0,
    hasOverridable: overridable.length > 0,
    termsInvalid: !attempt.acknowledged && attempt.submitTried,
    overrideInvalid:
      overrideMissing && (attempt.submitTried || attempt.overrideTouched),
    canComplete,
    showFillHint: attempt.submitTried && !canComplete && hard.length === 0,
  }
}

export function buildCheckoutBody(
  rows: CheckoutRow[],
  sel: CheckoutSelection,
  overrideReason: string,
  hasOverridable: boolean
): CheckoutBody {
  return {
    acknowledged: true,
    ...(hasOverridable ? { taskOverrideReason: overrideReason.trim() } : {}),
    lines: rows.map(({ line, unfilled }) => {
      const unfilledReason =
        unfilled > 0 ? sel.unfilledByLine[line.lineId] : undefined
      const base =
        line.tracking === "serialized"
          ? { lineId: line.lineId, unitIds: sel.unitsByLine[line.lineId] ?? [] }
          : { lineId: line.lineId, qty: sel.qtyByLine[line.lineId] ?? 0 }
      return unfilledReason ? { ...base, unfilledReason } : base
    }),
  }
}

/** Keyboard-wedge scanners type the tag and press Enter (BR-007-15). */
export function scanUnit(
  raw: string,
  lines: CheckoutLine[],
  unitsByLine: Record<string, string[]>,
  setUnitsByLine: UnitsUpdater
): void {
  const tag = raw.trim().toUpperCase()
  if (!tag) return
  for (const line of lines) {
    if (line.tracking !== "serialized") continue
    const unit = line.candidates.find((c) => c.assetTag.toUpperCase() === tag)
    if (!unit) continue
    const selected = unitsByLine[line.lineId] ?? []
    if (selected.includes(unit.unitId)) {
      toast.info(`${unit.assetTag} is already selected.`)
      return
    }
    if (selected.length >= line.qty) {
      toast.error(`${line.typeName} already has ${line.qty} selected.`)
      return
    }
    setUnitsByLine((m) => ({
      ...m,
      [line.lineId]: [...selected, unit.unitId],
    }))
    toast.success(`Selected ${unit.assetTag}`)
    return
  }
  toast.error(`No available unit ${tag} on this event's equipment.`)
}

/** Drops selected units that the refreshed view no longer offers. */
export function keepAvailableUnits(
  unitsByLine: Record<string, string[]>,
  freshLines: CheckoutLine[]
): Record<string, string[]> {
  const available = new Map(
    freshLines.map((l) => [
      l.lineId,
      new Set(l.candidates.map((c) => c.unitId)),
    ])
  )
  return Object.fromEntries(
    Object.entries(unitsByLine).map(([lineId, ids]) => [
      lineId,
      ids.filter((unitId) => available.get(lineId)?.has(unitId)),
    ])
  )
}
