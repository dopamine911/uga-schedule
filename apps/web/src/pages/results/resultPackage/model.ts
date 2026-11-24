import type { InferResponseType } from "hono/client"
import type { DialogField } from "@/components/events/shared"
import { api, unwrap } from "@/lib/api"

/** Check-in report written when the package is created (lifecycle.buildCheckinReport). */
export interface CheckinReportView {
  generatedAt: string
  items: {
    recordId: string
    typeName: string
    assetTag: string | null
    qty: number
    outAt: string
    outBy: string
    dueAt: string
    inAt: string | null
    inBy: string | null
    conditionIn: string | null
    qtyOk: number
    qtyDamaged: number
    qtyMissing: number
    qtyLost: number
    late: boolean
    notes: string | null
  }[]
  holds: { reason: string; status: string; placedAt: string }[]
}

export type PackageData = InferResponseType<
  (typeof api.results.events)[":eventId"]["$get"]
>

/** Values derived from one results package, computed once per render. */
export interface PackageFlags {
  report: CheckinReportView | null
  noResults: boolean
  signoffBlocked: boolean
  overrideReasons: string[]
  expired: boolean
}

function isCheckinReport(x: unknown): x is CheckinReportView {
  return !!x && typeof x === "object" && "items" in x && Array.isArray(x.items)
}

export function derivePackage(pkg: PackageData): PackageFlags {
  const raw: unknown = pkg.checkinReport
  const noResults = pkg.requiresResults && pkg.items.length === 0
  // Until the sign-off window passes the server refuses to publish; after it, a reason is enough.
  const signoffBlocked = pkg.signoffBlocksPublish
  return {
    report: isCheckinReport(raw) ? raw : null,
    noResults,
    signoffBlocked,
    overrideReasons: [
      ...(noResults ? ["no results uploaded"] : []),
      ...(pkg.signoffOverrideAt && !signoffBlocked
        ? ["sponsor sign-off pending"]
        : []),
    ],
    expired: pkg.status === "expired",
  }
}

export function statusLabel(status: PackageData["status"]): string {
  if (status === "collecting") return "Collecting results"
  return status === "published" ? "Published" : "Expired"
}

export function statusBadgeVariant(
  status: PackageData["status"]
): "destructive" | "secondary" | "outline" {
  if (status === "expired") return "destructive"
  return status === "published" ? "secondary" : "outline"
}

export function publishFields(overrideReasons: string[]): DialogField[] {
  return [
    {
      name: "overrideReason",
      label: "Reason for publishing now",
      required: overrideReasons.length > 0,
      description: overrideReasons.length
        ? `Publishing with: ${overrideReasons.join(", ")}.`
        : undefined,
    },
  ]
}

/** "2 OK, 1 damaged": the non-zero parts of one report row's counts, or "" when none. */
export function countsOf(r: CheckinReportView["items"][number]): string {
  return [
    r.qtyOk ? `${r.qtyOk} OK` : null,
    r.qtyDamaged ? `${r.qtyDamaged} damaged` : null,
    r.qtyMissing ? `${r.qtyMissing} missing` : null,
    r.qtyLost ? `${r.qtyLost} lost` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(", ")
}

export function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}

export async function postItem(
  eventId: string,
  body: FormData | { kind: "link"; title: string; url: string }
) {
  const init: RequestInit =
    body instanceof FormData
      ? { method: "POST", body, credentials: "same-origin" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin",
        }
  return unwrap<{ id: string }>(
    fetch(`/api/results/events/${eventId}/items`, init)
  )
}
