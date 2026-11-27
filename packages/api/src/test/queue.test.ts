import { localToUtc, utcToLocal } from "@studio/domain"
import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { config } from "../config.ts"
import * as s from "../db/schema.ts"
import { advanceClock, loadClock, now, nowMs } from "../lib/clock.ts"
import type { QueueItem, QueueSeverity } from "../services/queue.ts"
import { createHarness } from "./harness.ts"

// Acceptance tests for the work queue (GET /api/queue). Time is pinned to campus-local times.

type Harness = Awaited<ReturnType<typeof createHarness>>
type Client = Awaited<ReturnType<Harness["as"]>>
type Queue = { items: QueueItem[]; counts: Record<QueueSeverity, number> }

const HOUR = 3_600_000
const RANK: Record<QueueSeverity, number> = {
  critical: 0,
  soon: 1,
  waiting: 2,
}

const today = () => utcToLocal(now(), config.tz).day
const dayPlus = (base: string, n: number) => {
  const d = new Date(`${base}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const at = (day: string, time: string) => localToUtc(day, time, config.tz)
const setNow = async (h: Harness, iso: string) => {
  await loadClock(h.db)
  await advanceClock(h.db, Date.parse(iso) - nowMs())
}
const pinNoon = (h: Harness) => setNow(h, at(today(), "12:00"))

async function queueOf(c: Client): Promise<Queue> {
  const res = await c.get("/api/queue")
  expect(res.status).toBe(200)
  return res.body
}
const itemOf = (q: Queue, key: string) => q.items.find((i) => i.key === key)

async function userId(h: Harness, email: string): Promise<string> {
  return (await h.db
    .select()
    .from(s.users)
    .where(eq(s.users.email, `${email}@university.edu`))
    .get())!.id
}

async function eventId(h: Harness, title: string): Promise<string> {
  return (await h.db
    .select()
    .from(s.events)
    .where(eq(s.events.title, title))
    .get())!.id
}

/** A Studio A podcast booking for alice, sponsored by Priya, on `day` 14:00–15:00. */
async function podcastBody(h: Harness, day: string, title: string) {
  const types = await h.db.select().from(s.eventTypes).all()
  const studios = await h.db.select().from(s.studios).all()
  const equipment = await h.db.select().from(s.equipmentTypes).all()
  const pick = <T extends { name: string }>(rows: T[], prefix: string) =>
    rows.find((r) => r.name.startsWith(prefix))!
  return {
    title,
    description: "",
    eventTypeId: pick(types, "Podcast Recording").id,
    studioId: pick(studios, "Studio A").id,
    sponsorId: await userId(h, "priya.patel"),
    participantIds: [],
    days: [{ day, startTime: "14:00", endTime: "15:00" }],
    lines: [
      { equipmentTypeId: pick(equipment, "Shure SM7B").id, qty: 2 },
      { equipmentTypeId: pick(equipment, "XLR").id, qty: 2 },
    ],
  }
}

/** Alice creates and submits a podcast request on `day`. */
async function submitRequest(
  h: Harness,
  day: string,
  title: string
): Promise<string> {
  const alice = await h.as("alice.student")
  const created = await alice.post(
    "/api/events",
    await podcastBody(h, day, title)
  )
  expect(created.status).toBe(201)
  const submitted = await alice.post(
    `/api/events/${created.body.id}/submit`,
    {}
  )
  expect(submitted.status).toBe(200)
  return created.body.id as string
}

async function approveAndConfirm(h: Harness, id: string) {
  const priya = await h.as("priya.patel")
  expect(
    (
      await priya.post(`/api/events/${id}/sponsor-decision`, {
        decision: "approve",
        note: "",
      })
    ).status
  ).toBe(200)
  const sam = await h.as("sam.staff")
  expect(
    (
      await sam.post(`/api/events/${id}/staff-decision`, {
        decision: "confirm",
        note: "",
      })
    ).status
  ).toBe(200)
}

async function checkOutAll(h: Harness, id: string) {
  const sam = await h.as("sam.staff")
  const view = await sam.get(`/api/checkout/${id}`)
  const lines = view.body.lines.map(
    (l: {
      lineId: string
      tracking: string
      candidates: { unitId: string }[]
    }) =>
      l.tracking === "serialized"
        ? {
            lineId: l.lineId,
            unitIds: l.candidates.slice(0, 2).map((c) => c.unitId),
          }
        : { lineId: l.lineId, qty: 2 }
  )
  expect(
    (await sam.post(`/api/checkout/${id}`, { acknowledged: true, lines }))
      .status
  ).toBe(200)
}

/** A confirmed podcast on `day` that has been checked out and is now past its return time. */
async function overdueBooking(h: Harness): Promise<string> {
  await pinNoon(h)
  const day = dayPlus(today(), 5)
  const id = await submitRequest(h, day, "Overdue episode")
  await approveAndConfirm(h, id)
  await setNow(h, at(day, "13:45"))
  await checkOutAll(h, id)
  await setNow(h, at(day, "16:30")) // return due 15:00 + 60 min grace
  return id
}

function expectOrdered(items: QueueItem[]) {
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]!
    const b = items[i]!
    expect(RANK[a.severity]).toBeLessThanOrEqual(RANK[b.severity])
    if (a.severity === b.severity) {
      if (a.due === null) expect(b.due).toBeNull()
      else if (b.due !== null)
        expect(Date.parse(a.due)).toBeLessThanOrEqual(Date.parse(b.due))
    }
  }
}

describe("work queue: student", () => {
  it("shows a submitted request as waiting, with the moment it expires", async () => {
    const h = await createHarness()
    await pinNoon(h)
    const id = await submitRequest(h, dayPlus(today(), 5), "Waiting request")
    const alice = await h.as("alice.student")
    const q = await queueOf(alice)
    const item = itemOf(q, `waiting-${id}`)!
    expect(item.kind).toBe("waiting")
    expect(item.severity).toBe("waiting")
    expect(item.dueVerb).toBe("expires")
    const listed = (await alice.get("/api/events?scope=mine")).body.find(
      (e: { id: string }) => e.id === id
    )
    expect(item.due).toBe(listed.decideBy)
    expect(q.counts.waiting).toBeGreaterThanOrEqual(1)
  })

  it("shows an active hold as critical, with no action", async () => {
    const h = await createHarness()
    await pinNoon(h)
    const sam = await h.as("sam.staff")
    const placed = await sam.post("/api/holds", {
      userId: await userId(h, "alice.student"),
      note: "Left the booth unlocked",
    })
    expect(placed.status).toBe(201)
    const q = await queueOf(await h.as("alice.student"))
    const item = itemOf(q, `own-hold-${placed.body.id}`)!
    expect(item.severity).toBe("critical")
    expect(item.dueVerb).toBe("placed")
    expect(item.action).toBeNull()
  })

  it("shows a grant that ends within the warning window as soon", async () => {
    const h = await createHarness()
    const benId = await userId(h, "ben.student")
    const grant = (await h.db
      .select()
      .from(s.levelGrants)
      .where(
        and(eq(s.levelGrants.userId, benId), eq(s.levelGrants.source, "manual"))
      )
      .get())!
    const q = await queueOf(await h.as("ben.student"))
    const item = itemOf(q, `own-grant-${grant.id}`)!
    expect(item.severity).toBe("soon")
    expect(item.dueVerb).toBe("ends")
    expect(item.action?.href).toBe("/me/access")
  })

  it("shows an overdue return as critical and links to the booking", async () => {
    const h = await createHarness()
    const id = await overdueBooking(h)
    const item = itemOf(
      await queueOf(await h.as("alice.student")),
      `own-return-${id}`
    )!
    expect(item.severity).toBe("critical")
    expect(item.dueVerb).toBe("due")
    expect(item.eventId).toBe(id)
  })
})

describe("work queue: sponsor", () => {
  it("turns a request critical within 4 hours of its decideBy", async () => {
    const h = await createHarness()
    await pinNoon(h)
    const id = await submitRequest(h, dayPlus(today(), 5), "Sponsor decision")
    const priya = await h.as("priya.patel")
    const first = await queueOf(priya)
    const decision = itemOf(first, `sponsor-decision-${id}`)!
    expect(decision.kind).toBe("sponsor-decision")
    expect(decision.dueVerb).toBe("expires")
    expect(decision.severity).toBe("soon")
    const decideBy = decision.due!

    await setNow(h, new Date(Date.parse(decideBy) - 5 * HOUR).toISOString())
    expect(
      itemOf(await queueOf(priya), `sponsor-decision-${id}`)!.severity
    ).toBe("soon")

    await setNow(h, new Date(Date.parse(decideBy) - 3 * HOUR).toISOString())
    expect(
      itemOf(await queueOf(priya), `sponsor-decision-${id}`)!.severity
    ).toBe("critical")
  })

  it("does not show another sponsor's requests", async () => {
    const h = await createHarness()
    await pinNoon(h)
    const id = await submitRequest(h, dayPlus(today(), 5), "Priya only")
    const q = await queueOf(await h.as("minh.nguyen"))
    expect(q.items.some((i) => i.eventId === id)).toBe(false)
  })
})

describe("work queue: studio staff", () => {
  it("shows only requests in the staff member's own studios", async () => {
    const h = await createHarness()
    await pinNoon(h)
    const episode = await eventId(h, "Episode 4: Campus Food") // Studio A, Submitted
    const green = await eventId(h, "Green screen interview") // Studio C, SponsorApproved

    // Sam staffs Studios A and C.
    const sam = await queueOf(await h.as("sam.staff"))
    expect(itemOf(sam, `waiting-${episode}`)).toBeDefined()
    expect(itemOf(sam, `staff-decision-${green}`)).toBeDefined()

    // Tara staffs Studio B only.
    const tara = await queueOf(await h.as("tara.tech"))
    const taraIds = tara.items.map((i) => i.eventId)
    expect(taraIds).not.toContain(episode)
    expect(taraIds).not.toContain(green)
  })

  it("shows an overdue return with a check-in link", async () => {
    const h = await createHarness()
    const id = await overdueBooking(h)
    const q = await queueOf(await h.as("sam.staff"))
    const item = itemOf(q, `overdue-return-${id}`)!
    expect(item.severity).toBe("critical")
    expect(item.action).toEqual({
      label: "Check in",
      href: `/events/${id}/checkin`,
    })
  })

  it("keeps the queue ordered: critical, then soon, then waiting; due ascending within a tier", async () => {
    const h = await createHarness()
    await overdueBooking(h)
    const q = await queueOf(await h.as("sam.staff"))
    expect(q.items.length).toBeGreaterThan(1)
    expect(q.items[0]!.severity).toBe("critical")
    expectOrdered(q.items)
    const tally = { critical: 0, soon: 0, waiting: 0 }
    for (const i of q.items) tally[i.severity]++
    expect(q.counts).toEqual(tally)
  })
})

describe("work queue: equipment manager", () => {
  it("shows an overdue return across all studios without a check-in link", async () => {
    const h = await createHarness()
    const id = await overdueBooking(h)
    const q = await queueOf(await h.as("eli.manager"))
    const item = itemOf(q, `overdue-return-${id}`)!
    expect(item.severity).toBe("critical")
    expect(item.action).toEqual({
      label: "View booking",
      href: `/events/${id}`,
    })
  })

  it("shows an active hold on a student", async () => {
    const h = await createHarness()
    await pinNoon(h)
    const sam = await h.as("sam.staff")
    const placed = await sam.post("/api/holds", {
      userId: await userId(h, "alice.student"),
      note: "Left the booth unlocked",
    })
    const q = await queueOf(await h.as("eli.manager"))
    const item = itemOf(q, `hold-${placed.body.id}`)!
    expect(item.severity).toBe("soon")
    expect(item.action?.href).toBe("/holds")
  })

  it("shows a grant ending soon for the student and for the manager", async () => {
    const h = await createHarness()
    const benId = await userId(h, "ben.student")
    const grant = (await h.db
      .select()
      .from(s.levelGrants)
      .where(
        and(eq(s.levelGrants.userId, benId), eq(s.levelGrants.source, "manual"))
      )
      .get())!
    const manager = itemOf(
      await queueOf(await h.as("eli.manager")),
      `grant-${grant.id}`
    )!
    expect(manager.severity).toBe("soon")
    expect(manager.action?.href).toBe(`/admin/users/${benId}`)
  })
})

describe("work queue: no roles", () => {
  it("gives a user with no roles an empty queue", async () => {
    const h = await createHarness()
    await h.db
      .insert(s.users)
      .values({
        idpSubject: "dev|nobody",
        email: "nobody@university.edu",
        displayName: "Nobody Here",
        affiliation: "other",
      })
      .run()
    const q = await queueOf(await h.as("nobody"))
    expect(q.items).toEqual([])
    expect(q.counts).toEqual({ critical: 0, soon: 0, waiting: 0 })
  })
})
