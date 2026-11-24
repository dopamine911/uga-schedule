import { Hono } from "hono"
import { z } from "zod"
import { config } from "../config.ts"
import type { AppEnv } from "../env.ts"
import { runJobs } from "../jobs/tick.ts"
import { advanceClock, clockOffsetMs, now, resetClock } from "../lib/clock.ts"
import { forbidden } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"

// Dev-only time travel so reminders, expiries, overdue returns and holds can be demonstrated.

export const routes = new Hono<AppEnv>()
  .use(async (_c, next) => {
    if (!config.devMode) throw forbidden()
    await next()
  })
  .get("/clock", (c) => c.json({ now: now(), offsetMs: clockOffsetMs() }))
  .post(
    "/clock",
    v(
      "json",
      z.object({
        advanceMinutes: z.number().int().optional(),
        reset: z.boolean().optional(),
      })
    ),
    (c) => {
      const body = c.req.valid("json")
      if (body.reset) resetClock()
      if (body.advanceMinutes) advanceClock(body.advanceMinutes * 60_000)
      const ran = runJobs(c.var.db)
      return c.json({ now: now(), offsetMs: clockOffsetMs(), ran })
    }
  )
  .post("/run-jobs", (c) => c.json({ now: now(), ran: runJobs(c.var.db) }))
