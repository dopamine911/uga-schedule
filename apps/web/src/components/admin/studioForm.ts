import { intOrUndefined } from "@/components/admin/formHelpers"
import type { StudioSummary } from "@/components/admin/pickers"

// Pure form logic of the studio dialog: initial values, validation and the request body.

export interface StudioFormValues {
  name: string
  location: string
  capacityPeople: string
  minLevelId: string
  turnaroundMinutes: string
  slotGranularityMinutes: string
  active: boolean
}

const NEW_STUDIO: StudioFormValues = {
  name: "",
  location: "",
  capacityPeople: "1",
  minLevelId: "",
  turnaroundMinutes: "30",
  slotGranularityMinutes: "30",
  active: true,
}

/** Form values for a new studio, or for the studio being edited. */
export function studioFormValues(initial?: StudioSummary): StudioFormValues {
  if (!initial) return NEW_STUDIO
  return {
    name: initial.name,
    location: initial.location,
    capacityPeople: String(initial.capacityPeople),
    minLevelId: initial.minLevel.id,
    turnaroundMinutes: String(initial.turnaroundMinutes),
    slotGranularityMinutes: String(initial.slotGranularityMinutes),
    active: initial.status === "active",
  }
}

// Server: turnaround is a whole number ≥ 0; granularity is a positive whole number. Blank is never saved as a default.

export function studioTurnaroundOk(v: StudioFormValues): boolean {
  return /^\d+$/.test(v.turnaroundMinutes.trim())
}

export function studioGranularityOk(v: StudioFormValues): boolean {
  return /^[1-9]\d*$/.test(v.slotGranularityMinutes.trim())
}

export function studioSubmitDisabled(v: StudioFormValues): boolean {
  return (
    !v.name.trim() ||
    !v.minLevelId ||
    !studioTurnaroundOk(v) ||
    !studioGranularityOk(v)
  )
}

/** True when saving would switch an active studio off, which needs confirmation first. */
export function studioDeactivating(
  v: StudioFormValues,
  initial?: StudioSummary
): boolean {
  return !!initial && initial.status === "active" && !v.active
}

/** Request body shared by create and edit; edit adds the status. */
export function studioPayload(v: StudioFormValues) {
  return {
    name: v.name.trim(),
    location: v.location.trim(),
    capacityPeople: intOrUndefined(v.capacityPeople) ?? 1,
    minLevelId: v.minLevelId,
    turnaroundMinutes: Number(v.turnaroundMinutes),
    slotGranularityMinutes: Number(v.slotGranularityMinutes),
  }
}
