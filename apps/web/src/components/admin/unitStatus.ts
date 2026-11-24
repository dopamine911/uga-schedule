// Status options for the equipment type page's unit and bulk-stock dialogs.

/** Lifecycle moves outside checkout and check-in (F-003 §3). Mirrors the API's TRANSITIONS table. */
export const UNIT_TRANSITIONS: Record<
  string,
  readonly { value: string; label: string }[]
> = {
  available: [
    { value: "damaged", label: "Damaged" },
    { value: "retired", label: "Retired" },
  ],
  damaged: [
    { value: "in_repair", label: "In repair" },
    { value: "retired", label: "Retired" },
  ],
  in_repair: [
    { value: "available", label: "Available" },
    { value: "retired", label: "Retired" },
  ],
  lost: [
    { value: "available", label: "Available" },
    { value: "retired", label: "Retired" },
  ],
}

export const STOCK_BUCKETS = [
  { value: "available", label: "Available" },
  { value: "damaged", label: "Damaged" },
  { value: "in_repair", label: "In repair" },
  { value: "lost", label: "Lost" },
]
