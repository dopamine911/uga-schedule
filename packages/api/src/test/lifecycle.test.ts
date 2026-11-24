import { localToUtc, utcToLocal } from "@studio/domain"
import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { config } from "../config.ts"
import * as s from "../db/schema.ts"
import { runJobs } from "../jobs/tick.ts"
import { advanceClock, now, nowMs } from "../lib/clock.ts"
import { createHarness } from "./harness.ts"

// Acceptance tests for F-005…F-010 lifecycle. Time is pinned to campus-local times so dates stay consistent.

type Harness = ReturnType<typeof createHarness>
type Client = Awaited<ReturnType<Harness["as"]>>

const HOUR = 3_600_000

const today = () => utcToLocal(now(), config.tz).day
const dayPlus = (base: string, n: number) => {
  const d = new Date(`${base}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const at = (day: string, time: string) => localToUtc(day, time, config.tz)
/** Moves the (time-travelling) clock to `iso`. */
const setNow = (iso: string) => advanceClock(Date.parse(iso) - nowMs())
const pinNoon = () => setNow(at(today(), "12:00"))

function byName<T extends { id: string }>(
  rows: T[],
  pick: (r: T) => boolean
): string {
  const r = rows.find(pick)
  if (!r) throw new Error("seed row missing")
  return r.id
}

function ids(h: Harness) {
  const db = h.db
  const users = db.select().from(s.users).all()
  const studios = db.select().from(s.studios).all()
  const types = db.select().from(s.eventTypes).all()
  const equipment = db.select().from(s.equipmentTypes).all()
  return {
    alice: byName(users, (u) => u.email === "alice.student@university.edu"),
    ben: byName(users, (u) => u.email === "ben.student@university.edu"),
    dan: byName(users, (u) => u.email === "dan.student@university.edu"),
    priya: byName(users, (u) => u.email === "priya.patel@university.edu"),
    studioA: byName(studios, (x) => x.name.startsWith("Studio A")),
    studioB: byName(studios, (x) => x.name.startsWith("Studio B")),
    podcast: byName(types, (t) => t.name === "Podcast Recording"),
    thesis: byName(types, (t) => t.name === "Thesis Production"),
    sm7b: byName(equipment, (t) => t.name.startsWith("Shure SM7B")),
    xlr: byName(equipment, (t) => t.name.startsWith("XLR")),
    fx6: byName(equipment, (t) => t.name.startsWith("Sony FX6")),
    aputure: byName(equipment, (t) => t.name.startsWith("Aputure")),
  }
}

function podcastDraft(
  i: ReturnType<typeof ids>,
  day: string,
  startTime = "14:00",
  endTime = "15:00",
  title = "Episode"
) {
  return {
    title,
    description: "",
    eventTypeId: i.podcast,
    studioId: i.studioA,
    sponsorId: i.priya,
    participantIds: [],
    days: [{ day, startTime, endTime }],
    lines: [
      { equipmentTypeId: i.sm7b, qty: 2 },
      { equipmentTypeId: i.xlr, qty: 2 },
    ],
  }
}

async function createAndSubmit(alice: Client, body: unknown): Promise<string> {
  const created = await alice.post("/api/events", body)
  expect(created.status).toBe(201)
  const submitted = await alice.post(
    `/api/events/${created.body.id}/submit`,
    {}
  )
  expect(submitted.status).toBe(200)
  return created.body.id
}

/** Submit → sponsor approves → staff confirms. */
async function confirmed(
  h: Harness,
  day: string,
  startTime = "14:00",
  endTime = "15:00",
  title = "Episode"
): Promise<string> {
  const i = ids(h)
  const alice = await h.as("alice.student")
  const id = await createAndSubmit(
    alice,
    podcastDraft(i, day, startTime, endTime, title)
  )
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
  return id
}

async function checkoutAll(
  h: Harness,
  eventId: string,
  lines: { unitIdsOf?: string[]; xlrQty?: number }
) {
  const sam = await h.as("sam.staff")
  const view = await sam.get(`/api/checkout/${eventId}`)
  expect(view.status).toBe(200)
  const body = {
    acknowledged: true,
    lines: view.body.lines.map(
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
          : { lineId: l.lineId, qty: lines.xlrQty ?? 2 }
    ),
  }
  return sam.post(`/api/checkout/${eventId}`, body)
}

describe("happy path: podcast booking to closed (US-006-01, US-007-01, US-008-01)", () => {
  it("runs request, approval, confirmation, checkout, return and publication", async () => {
    const h = createHarness()
    const i = ids(h)
    pinNoon()
    const day = dayPlus(today(), 5)
    const alice = await h.as("alice.student")

    const created = await alice.post("/api/events", podcastDraft(i, day))
    expect(created.status).toBe(201)
    expect(created.body.state).toBe("Draft")
    const id = created.body.id as string

    const check = await alice.post("/api/events/check", {
      eventTypeId: i.podcast,
      studioId: i.studioA,
      sponsorId: i.priya,
      days: [{ day, startTime: "14:00", endTime: "15:00" }],
      lines: [{ equipmentTypeId: i.sm7b, qty: 2 }],
      excludeEventId: id,
    })
    expect(check.body.issues).toEqual([])

    expect((await alice.post(`/api/events/${id}/submit`, {})).body.state).toBe(
      "Submitted"
    )
    const priya = await h.as("priya.patel")
    expect(
      (
        await priya.post(`/api/events/${id}/sponsor-decision`, {
          decision: "approve",
          note: "",
        })
      ).body.state
    ).toBe("SponsorApproved")

    const sam = await h.as("sam.staff")
    const confirm = await sam.post(`/api/events/${id}/staff-decision`, {
      decision: "confirm",
      note: "",
    })
    expect(confirm.body.state).toBe("Confirmed")
    expect(
      h.db
        .select()
        .from(s.stageInstances)
        .where(eq(s.stageInstances.eventId, id))
        .all().length
    ).toBeGreaterThan(0)

    // Pickup window opens 30 minutes before the start.
    setNow(at(day, "13:45"))
    const out = await checkoutAll(h, id, { xlrQty: 2 })
    expect(out.status).toBe(200)
    expect(out.body.state).toBe("InProgress")
    const mics = h.db
      .select()
      .from(s.equipmentUnits)
      .where(eq(s.equipmentUnits.typeId, i.sm7b))
      .all()
    expect(mics.filter((m) => m.status === "in_use")).toHaveLength(2)

    // After the last day ends the event moves to PostEvent; check-in happens before the return grace ends.
    setNow(at(day, "15:30"))
    const ran = runJobs(h.db)
    expect(ran.events_post_event).toBeGreaterThanOrEqual(1)
    expect((await sam.get(`/api/events/${id}`)).body.state).toBe("PostEvent")

    const view = await sam.get(`/api/checkout/${id}`)
    const items = view.body.outstanding.map(
      (r: { recordId: string; assetTag: string | null; qty: number }) =>
        r.assetTag
          ? { recordId: r.recordId, condition: "ok" }
          : { recordId: r.recordId, qtyOk: r.qty }
    )
    const checkin = await sam.post(`/api/checkout/${id}/checkin`, { items })
    expect(checkin.status).toBe(200)
    expect(checkin.body.complete).toBe(true)

    const detail = await sam.get(`/api/events/${id}`)
    expect(detail.body.state).toBe("Closed")
    const micsAfter = h.db
      .select()
      .from(s.equipmentUnits)
      .where(eq(s.equipmentUnits.typeId, i.sm7b))
      .all()
    expect(micsAfter.every((m) => m.status === "available")).toBe(true)

    const inbox = await alice.get("/api/notifications")
    const codes = inbox.body.map((n: { code: string }) => n.code)
    expect(codes).toContain("CHECKOUT_RECEIPT")
    expect(codes).toContain("RESULTS_AVAILABLE")

    // US-008-02 AC2: another student gets 404; the requester can open the package.
    const dan = await h.as("dan.student")
    expect((await dan.get(`/api/results/events/${id}`)).status).toBe(404)
    const mine = await alice.get(`/api/results/events/${id}`)
    expect(mine.status).toBe(200)
    expect(mine.body.status).toBe("published")
  })
})

describe("lead-time override (US-006-05)", () => {
  it("blocks without justification, submits with one, and needs a reason to confirm", async () => {
    const h = createHarness()
    const i = ids(h)
    setNow(at(today(), "22:00"))
    const day = dayPlus(today(), 2)
    const alice = await h.as("alice.student")
    const created = await alice.post(
      "/api/events",
      podcastDraft(i, day, "10:00", "11:00")
    )
    const id = created.body.id as string

    const blocked = await alice.post(`/api/events/${id}/submit`, {})
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe("LEAD_TIME")

    const submitted = await alice.post(`/api/events/${id}/submit`, {
      justification: "Reshoot approved by dept",
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body.state).toBe("Submitted")
    expect(submitted.body.overrideRequested).toEqual(["LEAD_TIME"])

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
    const noReason = await sam.post(`/api/events/${id}/staff-decision`, {
      decision: "confirm",
      note: "",
    })
    expect(noReason.status).toBe(409)
    expect(noReason.body.error.code).toBe("OVERRIDE_REASON_REQUIRED")

    const confirmed = await sam.post(`/api/events/${id}/staff-decision`, {
      decision: "confirm",
      note: "",
      overrideReason: "Approved by department",
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.state).toBe("Confirmed")
    const overrides = h.db
      .select()
      .from(s.policyOverrides)
      .where(eq(s.policyOverrides.eventId, id))
      .all()
    expect(overrides.map((o) => o.ruleCode)).toEqual(["LEAD_TIME"])
  })
})

describe("expiry (US-006-07)", () => {
  it("expires a submitted request after the sponsor SLA", async () => {
    const h = createHarness()
    const i = ids(h)
    pinNoon()
    const day = dayPlus(today(), 5)
    const alice = await h.as("alice.student")
    const id = await createAndSubmit(alice, podcastDraft(i, day))

    setNow(new Date(nowMs() + 73 * HOUR).toISOString())
    const ran = runJobs(h.db)
    expect(ran.events_expired).toBeGreaterThanOrEqual(1)
    expect((await alice.get(`/api/events/${id}`)).body.state).toBe("Expired")
    const codes = (await alice.get("/api/notifications")).body.map(
      (n: { code: string }) => n.code
    )
    expect(codes).toContain("EVENT_EXPIRED")
  })
})

describe("late return, hold and submission block (US-007-03)", () => {
  it("places a LATE_RETURN hold that blocks the next submission", async () => {
    const h = createHarness()
    const i = ids(h)
    pinNoon()
    const day = dayPlus(today(), 5)
    const id = await confirmed(h, day)
    setNow(at(day, "13:45"))
    expect((await checkoutAll(h, id, {})).status).toBe(200)

    setNow(at(day, "16:30")) // past the return due time (15:00 + 60 min grace)
    runJobs(h.db)
    const sam = await h.as("sam.staff")
    const items = (await sam.get(`/api/checkout/${id}`)).body.outstanding.map(
      (r: { recordId: string; assetTag: string | null; qty: number }) =>
        r.assetTag
          ? { recordId: r.recordId, condition: "ok" }
          : { recordId: r.recordId, qtyOk: r.qty }
    )
    const checkin = await sam.post(`/api/checkout/${id}/checkin`, { items })
    expect(checkin.status).toBe(200)

    const holds = h.db
      .select()
      .from(s.holds)
      .where(eq(s.holds.userId, i.alice))
      .all()
    const late = holds.find((x) => x.reason === "LATE_RETURN")
    expect(late?.status).toBe("active")
    expect(late?.autoClearAt).toBeTruthy()

    const alice = await h.as("alice.student")
    const next = await alice.post(
      "/api/events",
      podcastDraft(i, dayPlus(today(), 12), "10:00", "11:00", "Next")
    )
    const submit = await alice.post(`/api/events/${next.body.id}/submit`, {})
    expect(submit.status).toBe(409)
    expect(submit.body.error.code).toBe("HOLD_ACTIVE")
  })
})

describe("lost equipment (US-007-04)", () => {
  it("writes off unreturned items after LOST_AFTER_DAYS with a LOSS hold", async () => {
    const h = createHarness()
    const i = ids(h)
    pinNoon()
    const day = dayPlus(today(), 5)
    const id = await confirmed(h, day)
    setNow(at(day, "13:45"))
    expect((await checkoutAll(h, id, {})).status).toBe(200)

    setNow(at(dayPlus(day, 8), "12:00")) // well past due + 7 days
    runJobs(h.db)

    const mics = h.db
      .select()
      .from(s.equipmentUnits)
      .where(eq(s.equipmentUnits.typeId, i.sm7b))
      .all()
    expect(mics.filter((m) => m.status === "lost")).toHaveLength(2)
    const stock = h.db
      .select()
      .from(s.bulkStock)
      .where(eq(s.bulkStock.typeId, i.xlr))
      .get()
    expect(stock?.qtyLost).toBe(2)
    const loss = h.db
      .select()
      .from(s.holds)
      .where(and(eq(s.holds.userId, i.alice), eq(s.holds.reason, "LOSS")))
      .all()
    expect(loss).toHaveLength(1)
    const sponsorCodes = h.db
      .select({ code: s.notifications.code })
      .from(s.notifications)
      .where(eq(s.notifications.recipientId, i.priya))
      .all()
      .map((n) => n.code)
    expect(sponsorCodes).toContain("HOLD_PLACED")
  })
})

describe("blocking safety task on the seeded thesis (US-005-03)", () => {
  it("blocks checkout until the task is overridden with a reason", async () => {
    const h = createHarness()
    const thesis = h.db
      .select()
      .from(s.events)
      .where(eq(s.events.title, "Thesis: The Last Projectionist"))
      .get()!
    const days = h.db
      .select()
      .from(s.eventDays)
      .where(eq(s.eventDays.eventId, thesis.id))
      .all()
    const start = days.map((d) => d.startsAt).sort()[0]!
    // Studio B is staffed by Tara Tech.
    const tara = await h.as("tara.tech")

    setNow(new Date(Date.parse(start) - 10 * 60_000).toISOString())
    const blocked = await tara.get(`/api/checkout/${thesis.id}`)
    expect(blocked.status).toBe(200)
    expect(
      blocked.body.blockers.map((b: { code: string }) => b.code)
    ).toContain("TASK_BLOCKING")

    const fx6 = h.db
      .select()
      .from(s.equipmentTypes)
      .where(eq(s.equipmentTypes.name, "Sony FX6 Kit"))
      .get()!
    const aputure = h.db
      .select()
      .from(s.equipmentTypes)
      .where(eq(s.equipmentTypes.name, "Aputure 300d LED"))
      .get()!
    const sm7b = h.db
      .select()
      .from(s.equipmentTypes)
      .where(eq(s.equipmentTypes.name, "Shure SM7B Microphone"))
      .get()!
    const lines = h.db
      .select()
      .from(s.equipmentLines)
      .where(eq(s.equipmentLines.eventId, thesis.id))
      .all()
    const lineFor = (typeId: string) =>
      lines.find((l) => l.equipmentTypeId === typeId)!.id
    const unitFor = (tag: string) =>
      h.db
        .select()
        .from(s.equipmentUnits)
        .where(eq(s.equipmentUnits.assetTag, tag))
        .get()!.id
    const body = {
      acknowledged: true,
      lines: [
        { lineId: lineFor(fx6.id), unitIds: [unitFor("CAM-001")] },
        { lineId: lineFor(aputure.id), unitIds: [unitFor("LGT-001")] },
        { lineId: lineFor(sm7b.id), unitIds: [unitFor("MIC-001")] },
      ],
    }
    const refused = await tara.post(`/api/checkout/${thesis.id}`, body)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe("CHECKOUT_BLOCKED")

    const ok = await tara.post(`/api/checkout/${thesis.id}`, {
      ...body,
      taskOverrideReason: "Briefing done in person",
    })
    expect(ok.status).toBe(200)
    expect(ok.body.state).toBe("InProgress")
    const safety = h.db
      .select()
      .from(s.stageInstances)
      .where(
        and(
          eq(s.stageInstances.eventId, thesis.id),
          eq(s.stageInstances.name, "Safety briefing acknowledged")
        )
      )
      .get()
    expect(safety?.status).toBe("overridden")
  })
})

describe("visibility and decision rules", () => {
  it("hides other students' events and blocks requesters and non-sponsors from deciding", async () => {
    const h = createHarness()
    const i = ids(h)
    const ben = await h.as("ben.student")
    const alice = await h.as("alice.student")
    const aliceEvent = h.db
      .select()
      .from(s.events)
      .where(eq(s.events.requesterId, i.alice))
      .get()!

    expect((await ben.get(`/api/events/${aliceEvent.id}`)).status).toBe(404)
    expect(
      (
        await alice.post(`/api/events/${aliceEvent.id}/sponsor-decision`, {
          decision: "approve",
          note: "",
        })
      ).status
    ).toBe(403)
    const list = await alice.get("/api/events")
    expect(
      list.body.every(
        (e: { requester: { id: string } }) => e.requester.id === i.alice
      )
    ).toBe(true)
    expect(list.body.map((e: { id: string }) => e.id)).toContain(aliceEvent.id)
  })
})

describe("calendar feed (US-009 ICS)", () => {
  it("lists the confirmed event with its UID and SEQUENCE, and omits cancelled ones", async () => {
    const h = createHarness()
    const i = ids(h)
    pinNoon()
    const day = dayPlus(today(), 6)
    const id = await confirmed(h, day, "14:00", "15:00", "Confirmed Show")
    const alice = await h.as("alice.student")
    const cancelled = await createAndSubmit(
      alice,
      podcastDraft(i, dayPlus(today(), 7), "14:00", "15:00", "Cancelled Show")
    )
    expect(
      (await alice.post(`/api/events/${cancelled}/cancel`, { reason: "" }))
        .status
    ).toBe(200)

    const feed = await alice.get("/api/calendar/feed")
    const path = new URL(feed.body.url).pathname
    const res = await h.app.request(path)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/calendar")
    const text = await res.text()
    expect(text.includes("\r\n")).toBe(true)
    expect(text).toContain("X-PUBLISHED-TTL:PT15M")
    expect(text).not.toContain("Cancelled Show")

    const day0 = h.db
      .select()
      .from(s.eventDays)
      .where(eq(s.eventDays.eventId, id))
      .get()!
    const event = h.db.select().from(s.events).where(eq(s.events.id, id)).get()!
    expect(text).toContain(`UID:${day0.id}@studio-scheduling`)
    expect(text).toContain(`SEQUENCE:${event.sequence}`)
    expect(text).toContain("STATUS:TENTATIVE") // Alice's seeded Submitted request, shown as tentative to its requester
    expect(text).toContain("STATUS:CONFIRMED")
    expect(text).toContain("SUMMARY:[Studio A")
    expect(text).toContain("Confirmed Show")
    expect(text).toContain("END:VCALENDAR")
  })
})

describe("result items (BR-008-02, BR-008-10)", () => {
  it("lets staff open and remove an item, hides it from outsiders, and keeps asset tags from the requester", async () => {
    const h = createHarness()
    pinNoon()
    const day = dayPlus(today(), 5)
    const id = await confirmed(h, day)
    setNow(at(day, "13:45"))
    expect((await checkoutAll(h, id, { xlrQty: 2 })).status).toBe(200)

    const sam = await h.as("sam.staff")
    const alice = await h.as("alice.student")
    const tagsFor = async (c: Client) =>
      (await c.get(`/api/events/${id}`)).body.checkouts.map(
        (r: { assetTag: string | null }) => r.assetTag
      )
    expect((await tagsFor(sam)).some((t: string | null) => t !== null)).toBe(
      true
    )
    expect((await tagsFor(alice)).every((t: string | null) => t === null)).toBe(
      true
    )

    setNow(at(day, "15:30"))
    runJobs(h.db)
    const added = await sam.post(`/api/results/events/${id}/items`, {
      kind: "link",
      title: "Rough cut",
      url: "https://example.edu/cut",
    })
    expect(added.status).toBe(201)
    const itemPath = `/api/results/items/${added.body.id}`

    expect(
      (await (await h.as("dan.student")).get(`${itemPath}/download`)).status
    ).toBe(404)
    const opened = await sam.get(`${itemPath}/download`)
    expect(opened.status).toBe(200)
    expect(opened.body.url).toBe("https://example.edu/cut")
    expect((await sam.del(itemPath)).status).toBe(200)
    expect((await sam.get(`/api/results/events/${id}`)).body.items).toEqual([])
  })
})

describe("changing a confirmed event (US-006-06, BR-009-01)", () => {
  it("restarts the staff decision clock and keeps the calendar entry's UID", async () => {
    const h = createHarness()
    const i = ids(h)
    pinNoon()
    const day = dayPlus(today(), 10)
    const id = await confirmed(h, day)
    const dayRow = () =>
      h.db.select().from(s.eventDays).where(eq(s.eventDays.eventId, id)).get()!
    const uidBefore = dayRow().id

    // Long after the sponsor approved, the requester moves the session to the next day.
    advanceClock(72 * HOUR)
    const alice = await h.as("alice.student")
    const moved = await alice.put(
      `/api/events/${id}`,
      podcastDraft(i, dayPlus(day, 1))
    )
    expect(moved.status).toBe(200)
    expect(moved.body.state).toBe("SponsorApproved")

    runJobs(h.db)
    expect((await alice.get(`/api/events/${id}`)).body.state).toBe(
      "SponsorApproved"
    )
    expect(dayRow().id).toBe(uidBefore)
    expect(dayRow().day).toBe(dayPlus(day, 1))
  })
})

describe("calendar feed access (BR-009-06, BR-001-09)", () => {
  it("answers 304 for an unchanged feed and stops serving a tampered link or a disabled account", async () => {
    const h = createHarness()
    pinNoon()
    await confirmed(h, dayPlus(today(), 6))
    const alice = await h.as("alice.student")
    const path = new URL((await alice.get("/api/calendar/feed")).body.url)
      .pathname

    const first = await h.app.request(path)
    expect(first.status).toBe(200)
    advanceClock(HOUR)
    const again = await h.app.request(path, {
      headers: { "if-none-match": first.headers.get("etag")! },
    })
    expect(again.status).toBe(304)

    const forged = path.replace(/\.[^.]+\.ics$/, ".AAAA.ics")
    expect((await h.app.request(forged)).status).toBe(404)

    const ada = await h.as("ada.admin")
    expect(
      (await ada.patch(`/api/users/${alice.user.id}`, { status: "disabled" }))
        .status
    ).toBe(200)
    expect((await h.app.request(path)).status).toBe(404)
  })
})
