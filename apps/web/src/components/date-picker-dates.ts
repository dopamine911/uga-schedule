import type { DateRange, Matcher } from "react-day-picker"
import { fmtDay } from "@/lib/format"

// Pure date helpers for DatePicker. Values are calendar strings ("YYYY-MM-DD"); Dates exist only
// inside the picker, pinned to local noon so no DST or offset change can shift the day.

export const toDate = (day: string) => new Date(`${day}T12:00:00`)
export const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** The picker's Date for a value; undefined while nothing is chosen. */
export function selectedDate(value: string): Date | undefined {
  return value ? toDate(value) : undefined
}

/** Last day of a multi-day span starting at the selection; undefined for single days. */
export function lastDayOfSpan(
  selected: Date | undefined,
  span: number
): Date | undefined {
  return selected && span > 1
    ? new Date(
        selected.getFullYear(),
        selected.getMonth(),
        selected.getDate() + span - 1
      )
    : undefined
}

/** Days the calendar greys out: outside [min, max] or rejected by the caller's rule. */
export function disabledMatchers(
  min: string | undefined,
  max: string | undefined,
  isDisabled: ((day: string) => boolean) | undefined
): Matcher[] {
  const disabled: Matcher[] = []
  if (min) disabled.push({ before: toDate(min) })
  if (max) disabled.push({ after: toDate(max) })
  if (isDisabled) disabled.push((d: Date) => isDisabled(toDay(d)))
  return disabled
}

/** Calendar props that mark soft-rule days. */
export interface FlaggedModifiers {
  modifiers: { flagged: (d: Date) => boolean }
}

/** Calendar props that mark soft-rule days; undefined when the caller flags none. */
export function flaggedModifiers(
  isFlagged: ((day: string) => boolean) | undefined
): FlaggedModifiers | undefined {
  return isFlagged
    ? { modifiers: { flagged: (d: Date) => isFlagged(toDay(d)) } }
    : undefined
}

/** Text on the trigger button: the day, the day range for a span, or the placeholder. */
export function triggerLabel(
  value: string,
  span: number,
  last: Date | undefined,
  placeholder: string
): string {
  if (!value) return placeholder
  return span > 1 && last
    ? `${fmtDay(value)} – ${fmtDay(toDay(last))}`
    : fmtDay(value)
}

/** Month the calendar opens on: the selection, else the earliest selectable day. */
export function defaultMonthOf(
  selected: Date | undefined,
  min: string | undefined
): Date | undefined {
  return selected ?? (min ? toDate(min) : undefined)
}

/** Range highlighted for a multi-day span. */
export function rangeOf(
  selected: Date | undefined,
  last: Date | undefined
): DateRange | undefined {
  return selected ? { from: selected, to: last } : undefined
}
