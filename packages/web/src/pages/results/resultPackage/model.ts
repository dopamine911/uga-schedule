import { upload } from "@vercel/blob/client"
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

type ItemBody = Parameters<
  (typeof api.results.events)[":eventId"]["items"]["$post"]
>[0]["json"]

export function postItem(eventId: string, body: ItemBody) {
  return unwrap(
    api.results.events[":eventId"].items.$post({
      param: { eventId },
      json: body,
    })
  )
}

/** Files above this go to Blob in parts, so a dropped connection costs one part rather than the whole file. */
const MULTIPART_FROM_BYTES = 100 * 1024 * 1024

/**
 * Uploads a result file: the API checks it and names its storage key, the bytes go straight to storage (Vercel Blob,
 * or the API's local store in development), then the API records the item.
 */
export async function uploadFile(eventId: string, file: File, title: string) {
  const contentType = file.type || "application/octet-stream"
  const { key, target } = await unwrap(
    api.results.events[":eventId"].uploads.$post({
      param: { eventId },
      json: { fileName: file.name, contentType, size: file.size },
    })
  )
  if (target.storage === "blob") {
    await upload(key, file, {
      access: "private",
      handleUploadUrl: `/api/results/events/${eventId}/uploads/token`,
      contentType,
      multipart: file.size >= MULTIPART_FROM_BYTES,
    })
  } else {
    const res = await fetch(target.url, {
      method: "PUT",
      body: file,
      headers: { "content-type": contentType },
      credentials: "same-origin",
    })
    if (!res.ok) await unwrap(Promise.resolve(res))
  }
  return postItem(eventId, { kind: "file", title, key, contentType })
}
