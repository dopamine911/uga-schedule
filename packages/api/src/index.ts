import type { Hono } from "hono"
import { createApp } from "./createApp.ts"
import { config } from "./config.ts"
import { openDb } from "./db/client.ts"
import { runJobs } from "./jobs/tick.ts"
import type { AppEnv } from "./env.ts"

// Vercel Functions entry (service "api" in vercel.json). `vercel dev` ignores the service `entrypoint`: it takes the
// first of src/{app,index,server}.ts that imports "hono", so this file keeps that name and import.
// There is no long-lived process here, so the background jobs that server.ts runs on an interval run from a
// Vercel Cron request to /api/jobs/tick instead.

if (!config.sessionSecret)
  throw new Error("SESSION_SECRET is required outside dev mode.")

const db = openDb()
const app: Hono<AppEnv> = createApp(db)

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; anything else is turned away. */
app.get("/api/jobs/tick", (c) => {
  const secret = process.env.CRON_SECRET
  if (!secret || c.req.header("authorization") !== `Bearer ${secret}`)
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Not allowed." } },
      401
    )
  return c.json(runJobs(db))
})

export default app
