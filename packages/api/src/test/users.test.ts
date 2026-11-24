import { describe, expect, it } from "vitest"
import { createHarness } from "./harness.ts"

describe("user administration (F-001)", () => {
  it("creates a pre-provisioned user with roles, and rejects a duplicate email", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const studios = await ada.get("/api/studios")
    const studioA = studios.body.find((s: { name: string }) => s.name.startsWith("Studio A"))

    const created = await ada.post("/api/users", {
      displayName: "Grace Grip",
      email: "Grace.Grip@University.edu",
      affiliation: "staff",
      roles: [{ role: "STUDIO_STAFF", studioId: studioA.id }, { role: "SPONSOR" }],
    })
    expect(created.status).toBe(201)

    const detail = await ada.get(`/api/users/${created.body.id}`)
    expect(detail.body).toMatchObject({ email: "grace.grip@university.edu", linked: false, status: "active" })
    expect(detail.body.roles.map((r: { role: string; studioName: string | null }) => [r.role, r.studioName]).sort()).toEqual([
      ["SPONSOR", null],
      ["STUDIO_STAFF", studioA.name],
    ])

    const dup = await ada.post("/api/users", { displayName: "Other", email: "grace.grip@university.edu", affiliation: "staff" })
    expect(dup.status).toBe(409)
  })

  it("rejects studio staff without a studio and non-admins creating users", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const bad = await ada.post("/api/users", {
      displayName: "No Studio",
      email: "nostudio@university.edu",
      affiliation: "staff",
      roles: [{ role: "STUDIO_STAFF" }],
    })
    expect(bad.status).toBe(400)
    // Nothing was created by the rejected request.
    expect((await ada.get("/api/users?q=nostudio")).body).toEqual([])

    const sam = await h.as("sam.staff")
    expect((await sam.post("/api/users", { displayName: "X", email: "x@university.edu", affiliation: "staff" })).status).toBe(403)
  })

  it("edits a profile and keeps emails unique", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const dan = (await ada.get("/api/users?q=dan.student")).body[0]
    const ok = await ada.put(`/api/users/${dan.id}/profile`, {
      displayName: "Daniel Student",
      email: "dan.student@university.edu",
      affiliation: "student",
    })
    expect(ok.status).toBe(200)
    expect((await ada.get(`/api/users/${dan.id}`)).body.displayName).toBe("Daniel Student")

    const taken = await ada.put(`/api/users/${dan.id}/profile`, {
      displayName: "Daniel Student",
      email: "alice.student@university.edu",
      affiliation: "student",
    })
    expect(taken.status).toBe(409)
  })
})

describe("per-user permission removal (BR-001-14)", () => {
  it("removes one permission from a staff member, enforced server-side, and restores it", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const samId = (await ada.get("/api/users?q=sam.staff")).body[0].id
    const episode = (await ada.get("/api/events?scope=all")).body.find((e: { title: string }) => e.title.startsWith("Episode 4"))

    const removed = await ada.post(`/api/users/${samId}/denials`, { permission: "event.cancel", reason: "Training pending" })
    expect(removed.status).toBe(201)

    // Sam's role still grants it, but the server now refuses (the role's other permissions still work).
    const sam = await h.as("sam.staff")
    expect((await sam.post(`/api/events/${episode.id}/cancel`, { reason: "test" })).status).toBe(403)
    expect((await sam.get(`/api/events/${episode.id}`)).status).toBe(200)

    const detail = (await ada.get(`/api/users/${samId}`)).body
    expect(detail.denials).toMatchObject([{ permission: "event.cancel", reason: "Training pending" }])
    expect(detail.permissions.find((p: { permission: string }) => p.permission === "event.cancel").denied).toBe(true)

    expect((await ada.del(`/api/users/${samId}/denials/event.cancel`)).status).toBe(200)
    const samAgain = await h.as("sam.staff")
    expect((await samAgain.post(`/api/events/${episode.id}/cancel`, { reason: "test" })).status).toBe(200)
  })

  it("won't let an admin lock themselves or the last admin out of user management", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const adaId = (await ada.get("/api/users?q=ada.admin")).body[0].id
    expect((await ada.post(`/api/users/${adaId}/denials`, { permission: "role.assign", reason: "oops" })).status).toBe(409)
    expect((await ada.post(`/api/users/${adaId}/denials`, { permission: "audit.view", reason: "Not needed" })).status).toBe(201)
  })
})

describe("per-studio permission removal (BR-001-15)", () => {
  it("blocks one studio for a staff member who works in two, and only that studio", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const samId = (await ada.get("/api/users?q=sam.staff")).body[0].id
    const studios = (await ada.get("/api/studios")).body as { id: string; name: string }[]
    const studioA = studios.find((s) => s.name.startsWith("Studio A"))!
    const studioB = studios.find((s) => s.name.startsWith("Studio B"))!
    const all = (await ada.get("/api/events?scope=all")).body as { id: string; title: string; studio: { id: string } }[]
    const inA = all.find((e) => e.studio.id === studioA.id)!
    const inC = all.find((e) => e.title.startsWith("Green screen"))!

    // Sam isn't staff at Studio B, so there is nothing to remove there.
    expect(
      (await ada.post(`/api/users/${samId}/denials`, { permission: "event.view", studioId: studioB.id, reason: "n/a" })).status,
    ).toBe(400)
    // System-wide permissions can't be removed per studio.
    expect(
      (await ada.post(`/api/users/${samId}/denials`, { permission: "user.list", studioId: studioA.id, reason: "n/a" })).status,
    ).toBe(400)

    expect(
      (await ada.post(`/api/users/${samId}/denials`, { permission: "event.view", studioId: studioA.id, reason: "Moved to C" }))
        .status,
    ).toBe(201)
    const sam = await h.as("sam.staff")
    expect((await sam.get(`/api/events/${inA.id}`)).status).toBe(404)
    expect((await sam.get(`/api/events/${inC.id}`)).status).toBe(200)
    const queue = (await sam.get("/api/events?scope=studio")).body as { studio: { id: string } }[]
    expect(queue.length).toBeGreaterThan(0)
    expect(queue.every((e) => e.studio.id !== studioA.id)).toBe(true)

    expect((await ada.del(`/api/users/${samId}/denials/event.view?studioId=${studioA.id}`)).status).toBe(200)
    expect((await (await h.as("sam.staff")).get(`/api/events/${inA.id}`)).status).toBe(200)
  })

  it("blocks one studio for an 'all studios' role, in lists as well as single records", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const eliId = (await ada.get("/api/users?q=eli.manager")).body[0].id
    const studioB = ((await ada.get("/api/studios")).body as { id: string; name: string }[]).find((s) =>
      s.name.startsWith("Studio B"),
    )!
    expect(
      (await ada.post(`/api/users/${eliId}/denials`, { permission: "event.view", studioId: studioB.id, reason: "Conflict" }))
        .status,
    ).toBe(201)
    const eli = await h.as("eli.manager")
    const list = (await eli.get("/api/events?scope=all")).body as { studio: { id: string } }[]
    expect(list.length).toBeGreaterThan(0)
    expect(list.some((e) => e.studio.id === studioB.id)).toBe(false)
    const thesis = ((await ada.get("/api/events?scope=all")).body as { id: string; title: string }[]).find((e) =>
      e.title.startsWith("Thesis"),
    )!
    expect((await eli.get(`/api/events/${thesis.id}`)).status).toBe(404)
  })
})
