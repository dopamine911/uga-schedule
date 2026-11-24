import { zValidator } from "@hono/zod-validator"
import type { ValidationTargets } from "hono"
import type { ZodType } from "zod"
import { badRequest } from "./errors.ts"

/** zod request validation that fails with the app's error shape (400 VALIDATION). */
export const v = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result) => {
    if (!result.success) throw badRequest("VALIDATION", "Some fields are invalid.", result.error.issues)
  })
