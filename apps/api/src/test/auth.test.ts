import { describe, expect, it } from "vitest"
import { createHarness } from "./harness.ts"

describe("dev login (F-001)", () => {
  it("returns the signed-in user with role assignments", async () => {
    const h = createHarness()
    const sam = await h.as("sam.staff")
    const me = await sam.get("/api/auth/me")
    expect(me.status).toBe(200)
    expect(me.body.user.roles.map((r: { role: string }) => r.role)).toEqual(["STUDIO_STAFF", "STUDIO_STAFF"])
  })

  it("treats unauthenticated callers as signed out", async () => {
    const h = createHarness()
    const res = await h.app.request("/api/auth/me")
    expect(await res.json()).toMatchObject({ user: null })
  })
})
