import { z } from "zod"
import { Hono } from "hono"
import { policies } from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { audit } from "../lib/audit.ts"
import { authorize, requireUser } from "../lib/auth.ts"
import { badRequest } from "../lib/errors.ts"
import { v } from "../lib/validate.ts"
import {
  POLICY_DEFAULTS,
  type PolicyKey,
  getPolicies,
} from "../services/policy.ts"

// BR-006-05: admin-configurable policy numbers.

const KEYS = Object.keys(POLICY_DEFAULTS) as PolicyKey[]

export const routes = new Hono<AppEnv>()
  .get("/", async (c) => {
    requireUser(c)
    return c.json(await getPolicies(c.var.db))
  })
  .put(
    "/",
    v("json", z.record(z.string(), z.number().int().min(0))),
    async (c) => {
      const me = authorize(c, "policy.manage")
      const db = c.var.db
      const body = c.req.valid("json")
      const unknown = Object.keys(body).filter(
        (k) => !KEYS.includes(k as PolicyKey)
      )
      if (unknown.length)
        throw badRequest("UNKNOWN_POLICY", "Unknown policy.", { keys: unknown })
      const before = await getPolicies(db)
      for (const key of Object.keys(body) as PolicyKey[]) {
        const value = body[key]!
        if (before[key] === value) continue
        await db
          .insert(policies)
          .values({ key, value })
          .onConflictDoUpdate({ target: policies.key, set: { value } })
          .run()
        await audit(db, {
          actorId: me.id,
          action: "policy.update",
          entityType: "policy",
          entityId: key,
          before: { value: before[key] },
          after: { value },
        })
      }
      return c.json(await getPolicies(db))
    }
  )
