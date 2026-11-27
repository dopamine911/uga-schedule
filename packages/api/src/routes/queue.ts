import { Hono } from "hono"
import type { AppEnv } from "../env.ts"
import { requireUser } from "../lib/auth.ts"
import { buildQueue } from "../services/queue.ts"

// The work queue on the home page (GET /api/queue). Rules: services/queue.ts.

export type {
  Queue,
  QueueAction,
  QueueDueVerb,
  QueueItem,
  QueueKind,
  QueueSeverity,
} from "../services/queue.ts"

export const routes = new Hono<AppEnv>().get("/", async (c) =>
  c.json(await buildQueue(c.var.db, requireUser(c)))
)
