import type { EventTypeDetail } from "@/components/admin/pickers"

/** The settings form; numbers are kept as the text the inputs hold. */
export type SettingsForm = {
  name: string
  description: string
  active: boolean
  maxDays: string
  maxHoursPerDay: string
  dailyEquipmentReturn: boolean
  pickupWindowMinutes: string
  checkinGraceMinutes: string
  requiresResults: boolean
  resultsDueDays: string
  requesterCanUpload: boolean
  requiresSponsorSignoff: boolean
  allowedStudioIds: string[]
}

export type SetSettings = <K extends keyof SettingsForm>(
  key: K,
  value: SettingsForm[K]
) => void

/** The saved state of the type, as form values: the baseline for "unsaved changes". */
export function settingsFormFromType(type: EventTypeDetail): SettingsForm {
  return {
    name: type.name,
    description: type.description,
    active: type.status === "active",
    maxDays: String(type.maxDays),
    maxHoursPerDay: String(type.maxHoursPerDay),
    dailyEquipmentReturn: type.dailyEquipmentReturn,
    pickupWindowMinutes: String(type.pickupWindowMinutes),
    checkinGraceMinutes: String(type.checkinGraceMinutes),
    requiresResults: type.requiresResults,
    resultsDueDays: String(type.resultsDueDays),
    requesterCanUpload: type.requesterCanUpload,
    requiresSponsorSignoff: type.requiresSponsorSignoff,
    allowedStudioIds: type.allowedStudios.map((s) => s.id),
  }
}

/** The PATCH body for the form values. */
export function settingsPayload(
  v: SettingsForm,
  confirmRunningEvents: boolean
) {
  const status: "active" | "inactive" = v.active ? "active" : "inactive"
  return {
    name: v.name.trim(),
    description: v.description.trim(),
    status,
    maxDays: Number(v.maxDays),
    maxHoursPerDay: Number(v.maxHoursPerDay),
    dailyEquipmentReturn: v.dailyEquipmentReturn,
    pickupWindowMinutes: Number(v.pickupWindowMinutes),
    checkinGraceMinutes: Number(v.checkinGraceMinutes),
    requiresResults: v.requiresResults,
    resultsDueDays: Number(v.resultsDueDays),
    requesterCanUpload: v.requesterCanUpload,
    requiresSponsorSignoff: v.requiresSponsorSignoff,
    allowedStudioIds: v.allowedStudioIds,
    confirmRunningEvents,
  }
}

/** Whole number (no decimals) of at least `min`; blank is never valid. */
export function whole(value: string, min: number): boolean {
  return (
    value.trim() !== "" &&
    Number.isInteger(Number(value)) &&
    Number(value) >= min
  )
}

/** Names the save-blocking rules; inlining would put them back into the card. */
export function isSettingsInvalid(v: SettingsForm): boolean {
  return (
    !v.name.trim() ||
    v.allowedStudioIds.length === 0 ||
    !whole(v.maxDays, 1) ||
    !whole(v.maxHoursPerDay, 1) ||
    !whole(v.pickupWindowMinutes, 0) ||
    !whole(v.checkinGraceMinutes, 0) ||
    !whole(v.resultsDueDays, 0)
  )
}
