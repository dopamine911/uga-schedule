import type { ApiType } from "@studio/api"
import type { Issue } from "@studio/domain"
import { hc } from "hono/client"

/** Typed client for the Hono API (types come straight from apps/api route definitions). */
export const api = hc<ApiType>("/api", { init: { credentials: "same-origin" } })

/** Error thrown for non-2xx responses. `issues` is set when the API returned booking-rule issues (409). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly issues: Issue[]
  constructor(status: number, code: string, message: string, details: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
    this.issues = extractIssues(details)
  }
}

function isIssue(x: unknown): x is Issue {
  return !!x && typeof x === "object" && "code" in x && "severity" in x && "message" in x
}

function extractIssues(details: unknown): Issue[] {
  if (Array.isArray(details)) return details.filter(isIssue)
  if (details && typeof details === "object" && "issues" in details && Array.isArray(details.issues))
    return details.issues.filter(isIssue)
  return []
}

interface JsonResponse<T> {
  ok: boolean
  status: number
  json(): Promise<T>
}

/**
 * Unwraps a hono/client response: returns the typed success body or throws ApiError.
 * Usage: `const events = await unwrap(api.events.$get({ query: { scope: "mine" } }))`
 */
export async function unwrap<T>(pending: Promise<JsonResponse<T>>): Promise<T> {
  const res = await pending
  if (res.ok) return res.json()
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // non-JSON error body
  }
  const err =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? body.error
      : null
  const code = err && "code" in err && typeof err.code === "string" ? err.code : "HTTP_" + res.status
  const message = err && "message" in err && typeof err.message === "string" ? err.message : "Request failed."
  throw new ApiError(res.status, code, message, err && "details" in err ? err.details : undefined)
}
