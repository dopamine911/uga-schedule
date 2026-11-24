import type { ContentfulStatusCode } from "hono/utils/http-status"

/** Error with an HTTP status and a stable machine-readable code. Rendered by app.onError. */
export class AppError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly details: unknown
  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details)
export const unauthorized = () =>
  new AppError(401, "UNAUTHENTICATED", "Please sign in.")
export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError(403, "FORBIDDEN", message)
/** Also used for records the caller may not see, so existence is not leaked (US-008-02 AC2). */
export const notFound = (what = "Record") =>
  new AppError(404, "NOT_FOUND", `${what} not found.`)
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details)

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown }
}
