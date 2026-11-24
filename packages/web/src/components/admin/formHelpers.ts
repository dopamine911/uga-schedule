import { toast } from "sonner"

// Small helpers shared by the admin forms and dialogs.

/** Toast after a change that re-checked open events (BR-003-08, BR-004-07 …). */
export function toastSaved(message: string, flagged?: unknown) {
  const n =
    typeof flagged === "number"
      ? flagged
      : Array.isArray(flagged)
        ? flagged.length
        : 0
  toast.success(
    message,
    n > 0
      ? {
          description: `${n} open event${n === 1 ? "" : "s"} flagged for review.`,
        }
      : undefined
  )
}

/** Parses an optional whole-number input; "" → undefined. */
export function intOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}
