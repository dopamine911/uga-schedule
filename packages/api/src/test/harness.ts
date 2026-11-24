import { eq } from "drizzle-orm"
import { createApp } from "../createApp.ts"
import { migrateDb, openDb } from "../db/client.ts"
import { users } from "../db/schema.ts"
import { seed } from "../db/seed.ts"
import { resetClock } from "../lib/clock.ts"

/**
 * Fresh in-memory database with demo seed data, plus a cookie-carrying client per user.
 * Seed users are addressed by email prefix, e.g. "alice.student", "sam.staff", "ada.admin".
 */
export async function createHarness() {
  const db = await openDb(":memory:")
  await migrateDb(db)
  // Before seeding: seed dates derive from now(), which still carries the previous test's offset.
  await resetClock(db)
  await seed(db)
  const app = createApp(db)

  async function as(emailPrefix: string) {
    const u = await db
      .select()
      .from(users)
      .where(eq(users.email, `${emailPrefix}@university.edu`))
      .get()
    if (!u) throw new Error(`no seed user ${emailPrefix}`)
    const login = await app.request("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: u.id }),
    })
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: {
          cookie,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null }
    }
    return {
      user: u,
      get: (path: string) => call("GET", path),
      post: (path: string, body?: unknown) => call("POST", path, body ?? {}),
      put: (path: string, body?: unknown) => call("PUT", path, body ?? {}),
      patch: (path: string, body?: unknown) => call("PATCH", path, body ?? {}),
      del: (path: string) => call("DELETE", path),
    }
  }

  return { db, app, as }
}
