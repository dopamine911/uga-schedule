import { Hono } from "hono"
import { ZodError } from "zod"
import type { DB } from "./db/client.ts"
import type { AppEnv } from "./env.ts"
import { sessionMiddleware } from "./lib/auth.ts"
import { AppError, type ErrorBody } from "./lib/errors.ts"
import { routes as audit } from "./routes/audit.ts"
import { routes as auth } from "./routes/auth.ts"
import { icsRoutes, routes as calendar } from "./routes/calendar.ts"
import { routes as checkout } from "./routes/checkout.ts"
import { routes as dev } from "./routes/dev.ts"
import { routes as equipment } from "./routes/equipment.ts"
import { routes as eventTypes } from "./routes/eventTypes.ts"
import { routes as events } from "./routes/events.ts"
import { routes as holds } from "./routes/holds.ts"
import { routes as levels } from "./routes/levels.ts"
import { routes as notifications } from "./routes/notifications.ts"
import { routes as policies } from "./routes/policies.ts"
import { routes as results } from "./routes/results.ts"
import { routes as stages } from "./routes/stages.ts"
import { routes as studios } from "./routes/studios.ts"
import { routes as users } from "./routes/users.ts"

/** Stateless API router; per-app state (db) arrives through middleware. Mounted under /api. */
const api = new Hono<AppEnv>()
  .route("/auth", auth)
  .route("/dev", dev)
  .route("/users", users)
  .route("/levels", levels)
  .route("/equipment", equipment)
  .route("/studios", studios)
  .route("/event-types", eventTypes)
  .route("/policies", policies)
  .route("/events", events)
  .route("/checkout", checkout)
  .route("/stages", stages)
  .route("/holds", holds)
  .route("/results", results)
  .route("/notifications", notifications)
  .route("/calendar", calendar)
  .route("/audit", audit)

/** Typed API surface for the web client (hono/client). */
export type ApiType = typeof api

export function createApp(db: DB) {
  const app = new Hono<AppEnv>()
  app.use(async (c, next) => {
    c.set("db", db)
    await next()
  })
  app.use(sessionMiddleware)
  app.route("/api", api)
  app.route("/ics", icsRoutes)
  app.notFound((c) => c.json<ErrorBody>({ error: { code: "NOT_FOUND", message: "Not found." } }, 404))
  app.onError((err, c) => {
    if (err instanceof AppError)
      return c.json<ErrorBody>({ error: { code: err.code, message: err.message, details: err.details } }, err.status)
    if (err instanceof ZodError)
      return c.json<ErrorBody>({ error: { code: "VALIDATION", message: "Some fields are invalid.", details: err.issues } }, 400)
    console.error(err)
    return c.json<ErrorBody>({ error: { code: "INTERNAL", message: "Something went wrong." } }, 500)
  })
  return app
}
