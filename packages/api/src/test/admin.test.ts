import { utcToLocal } from "@studio/domain"
import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  courseOfferings,
  enrollments,
  equipmentLines,
  equipmentTypes,
  equipmentUnits,
  eventDays,
  eventTypes,
  events,
  levelGrants,
  roleAssignments,
  studios,
  users,
} from "../db/schema.ts"
import { now } from "../lib/clock.ts"
import { createHarness } from "./harness.ts"

const THESIS = "Thesis: The Last Projectionist"

/** Calendar date n days from today in the campus time zone. */
function dayOffset(n: number): string {
  const d = new Date(`${utcToLocal(now(), config.tz).day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function one<T>(rows: T[]): T {
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`)
  return rows[0]!
}

function studioNamed(db: DB, prefix: string) {
  return one(
    db
      .select()
      .from(studios)
      .all()
      .filter((s) => s.name.startsWith(prefix))
  )
}

function eventTitled(db: DB, title: string) {
  return one(db.select().from(events).where(eq(events.title, title)).all())
}

function typeNamed(db: DB, name: string) {
  return one(
    db.select().from(equipmentTypes).where(eq(equipmentTypes.name, name)).all()
  )
}

function unitTagged(db: DB, tag: string) {
  return one(
    db
      .select()
      .from(equipmentUnits)
      .where(eq(equipmentUnits.assetTag, tag))
      .all()
  )
}

function userEmailed(db: DB, email: string) {
  return one(db.select().from(users).where(eq(users.email, email)).all())
}

/** Inserts a Confirmed FX6 booking by chloe in the thesis window, created just after the thesis. */
function insertCompetingFx6Event(db: DB) {
  const thesis = eventTitled(db, THESIS)
  const chloe = userEmailed(db, "chloe.student@university.edu")
  const patel = userEmailed(db, "priya.patel@university.edu")
  const studioB = studioNamed(db, "Studio B")
  const type = one(
    db
      .select()
      .from(eventTypes)
      .where(eq(eventTypes.name, "Thesis Production"))
      .all()
  )
  const fx6 = typeNamed(db, "Sony FX6 Kit")
  const ev = one(
    db
      .insert(events)
      .values({
        title: "Documentary: Competing FX6 booking",
        eventTypeId: type.id,
        studioId: studioB.id,
        requesterId: chloe.id,
        sponsorId: patel.id,
        state: "Confirmed",
        createdAt: new Date(Date.parse(thesis.createdAt) + 1000).toISOString(),
      })
      .returning()
      .all()
  )
  const days = db
    .select()
    .from(eventDays)
    .where(eq(eventDays.eventId, thesis.id))
    .all()
  db.insert(eventDays)
    .values(
      days.map((d) => ({
        eventId: ev.id,
        day: d.day,
        startTime: d.startTime,
        endTime: d.endTime,
        startsAt: d.startsAt,
        endsAt: d.endsAt,
      }))
    )
    .run()
  db.insert(equipmentLines)
    .values({ eventId: ev.id, equipmentTypeId: fx6.id, qty: 1 })
    .run()
  return ev
}

describe("US-002-04 dropping a course revokes the grant and flags events", () => {
  it("drops chloe from FILM 301 and flags her thesis ELIGIBILITY_LOST", async () => {
    const h = createHarness()
    const eli = await h.as("eli.manager")
    const chloe = await h.as("chloe.student")
    const course = one(
      h.db
        .select()
        .from(courseOfferings)
        .where(eq(courseOfferings.courseCode, "FILM 301"))
        .all()
    )
    const enrollment = one(
      h.db
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.userId, chloe.user.id),
            eq(enrollments.courseOfferingId, course.id)
          )
        )
        .all()
    )
    const res = await eli.post(
      `/api/levels/courses/${course.id}/enrollments/${enrollment.id}/drop`
    )
    expect(res.status).toBe(200)

    const grant = one(
      h.db
        .select()
        .from(levelGrants)
        .where(eq(levelGrants.enrollmentId, enrollment.id))
        .all()
    )
    expect(grant.revokedOn).not.toBeNull()

    const thesis = eventTitled(h.db, THESIS)
    expect(thesis.needsReview).toBe(true)
    expect(thesis.reviewReasons).toContain("ELIGIBILITY_LOST")
    expect(res.body.flaggedEvents).toContain(thesis.id)
  })
})

describe("US-003-03 shortage is attributed to the later-created event", () => {
  it("flags only the later FX6 booking when CAM-001 is marked damaged", async () => {
    const h = createHarness()
    const later = insertCompetingFx6Event(h.db)
    const thesis = eventTitled(h.db, THESIS)
    const eli = await h.as("eli.manager")
    const cam1 = unitTagged(h.db, "CAM-001")

    const res = await eli.post(`/api/equipment/units/${cam1.id}/status`, {
      status: "damaged",
      reason: "Lens mount cracked",
    })
    expect(res.status).toBe(200)

    const laterRow = one(
      h.db.select().from(events).where(eq(events.id, later.id)).all()
    )
    const thesisRow = one(
      h.db.select().from(events).where(eq(events.id, thesis.id)).all()
    )
    expect(laterRow.reviewReasons).toContain("EQUIPMENT_SHORTAGE")
    expect(thesisRow.reviewReasons).not.toContain("EQUIPMENT_SHORTAGE")
  })
})

describe("US-004-02 blackouts flag events holding the studio", () => {
  it("flags the thesis STUDIO_BLACKOUT when a blackout covers its days", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const res = await ada.post("/api/studios/blackouts", {
      studioId: studioNamed(h.db, "Studio B").id,
      startDay: dayOffset(9),
      startTime: "09:00",
      endDay: dayOffset(10),
      endTime: "18:00",
      reason: "Stage refit",
    })
    expect(res.status).toBe(201)
    const thesis = eventTitled(h.db, THESIS)
    expect(thesis.needsReview).toBe(true)
    expect(thesis.reviewReasons).toContain("STUDIO_BLACKOUT")
  })
})

describe("studio staff boundaries", () => {
  it("cannot manage inventory", async () => {
    const h = createHarness()
    const sam = await h.as("sam.staff")
    const cam1 = unitTagged(h.db, "CAM-001")
    expect(
      (
        await sam.post("/api/equipment/classes", {
          name: "X",
          minLevelId: "nope",
        })
      ).status
    ).toBe(403)
    expect(
      (
        await sam.post("/api/equipment/types", {
          classId: "nope",
          name: "X",
          tracking: "bulk",
        })
      ).status
    ).toBe(403)
    expect(
      (
        await sam.post(`/api/equipment/units/${cam1.id}/status`, {
          status: "damaged",
          reason: "x",
        })
      ).status
    ).toBe(403)
  })

  it("sees schedule titles only for studios they staff", async () => {
    const h = createHarness()
    const studioB = studioNamed(h.db, "Studio B")
    const query = `/api/studios/${studioB.id}/schedule?from=${dayOffset(9)}&to=${dayOffset(10)}`
    const sam = await h.as("sam.staff")
    const tara = await h.as("tara.tech")

    const samBusy = (await sam.get(query)).body.busy
    expect(samBusy.length).toBeGreaterThan(0)
    for (const b of samBusy) expect(b.title).toBeUndefined()

    const taraBusy = (await tara.get(query)).body.busy
    expect(taraBusy.some((b: { title?: string }) => b.title === THESIS)).toBe(
      true
    )
  })
})

describe("role assignment guards", () => {
  it("requires a studio for STUDIO_STAFF", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const alice = userEmailed(h.db, "alice.student@university.edu")
    const res = await ada.post(`/api/users/${alice.id}/roles`, {
      role: "STUDIO_STAFF",
    })
    expect(res.status).toBe(400)
  })

  it("rejects removing the last active ADMIN", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const assignment = one(
      h.db
        .select()
        .from(roleAssignments)
        .where(eq(roleAssignments.role, "ADMIN"))
        .all()
    )
    const res = await ada.del(
      `/api/users/${ada.user.id}/roles/${assignment.id}`
    )
    expect(res.status).toBe(409)
    expect(
      one(
        h.db
          .select()
          .from(roleAssignments)
          .where(eq(roleAssignments.id, assignment.id))
          .all()
      ).id
    ).toBe(assignment.id)
  })
})

describe("equipment availability for the booking form", () => {
  it("marks the FX6 kit ineligible for a Level 1 student and eligible for a Level 3 student", async () => {
    const h = createHarness()
    const fx6 = typeNamed(h.db, "Sony FX6 Kit")
    const body = {
      days: [{ day: dayOffset(20), startTime: "10:00", endTime: "17:00" }],
    }
    const alice = await h.as("alice.student")
    const chloe = await h.as("chloe.student")

    const rowFor = (rows: { equipmentTypeId: string }[]) =>
      rows.find((r) => r.equipmentTypeId === fx6.id)
    const aliceRow = rowFor(
      (await alice.post("/api/equipment/availability", body)).body
    )
    const chloeRow = rowFor(
      (await chloe.post("/api/equipment/availability", body)).body
    )
    expect(aliceRow).toMatchObject({ eligible: false })
    expect(chloeRow).toMatchObject({ eligible: true })
  })
})

describe("approval queue and directory scope", () => {
  it("shows an admin every studio's requests in the studio queue", async () => {
    const h = createHarness()
    const ada = await h.as("ada.admin")
    const queue = await ada.get("/api/events?scope=studio")
    expect(queue.status).toBe(200)
    expect(queue.body.map((e: { title: string }) => e.title)).toContain(THESIS)
  })

  it("keeps the user directory from studio staff and from an untyped search", async () => {
    const h = createHarness()
    const sam = await h.as("sam.staff")
    expect((await sam.get("/api/users")).status).toBe(403)
    expect(
      (
        await sam.get(
          `/api/users/${userEmailed(h.db, "alice.student@university.edu").id}`
        )
      ).status
    ).toBe(404)
    expect((await sam.get("/api/users/search")).body).toEqual([])
    expect(
      (await sam.get("/api/users/search?q=ali")).body.map(
        (u: { displayName: string }) => u.displayName
      )
    ).toEqual(["Alice Student"])
  })
})

describe("studio staff stay inside their studios", () => {
  it("cannot move a booking into a studio they do not staff", async () => {
    const h = createHarness()
    const thesis = eventTitled(h.db, THESIS)
    const tara = await h.as("tara.tech")
    const moved = await tara.put(`/api/events/${thesis.id}`, {
      title: thesis.title,
      description: thesis.description,
      eventTypeId: thesis.eventTypeId,
      studioId: studioNamed(h.db, "Studio C").id,
      sponsorId: thesis.sponsorId,
      participantIds: [],
      days: h.db
        .select()
        .from(eventDays)
        .where(eq(eventDays.eventId, thesis.id))
        .all()
        .map((d) => ({
          day: d.day,
          startTime: d.startTime,
          endTime: d.endTime,
        })),
      lines: [],
    })
    expect(moved.status).toBe(403)
    expect(eventTitled(h.db, THESIS).studioId).toBe(thesis.studioId)
  })

  it("can place a hold only on someone who requested one of their studios", async () => {
    const h = createHarness()
    const alice = userEmailed(h.db, "alice.student@university.edu") // has requested Studio A only
    const hold = { userId: alice.id, note: "Left the booth unlocked" }
    expect(
      (await (await h.as("tara.tech")).post("/api/holds", hold)).status
    ).toBe(403)
    expect(
      (await (await h.as("sam.staff")).post("/api/holds", hold)).status
    ).toBe(201)
  })
})

describe("roster import guards", () => {
  it("rejects an empty or wholly unmatched roster and leaves enrolments alone", async () => {
    const h = createHarness()
    const eli = await h.as("eli.manager")
    const course = h.db.select().from(courseOfferings).all()[0]!
    const enrolled = () =>
      h.db
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.courseOfferingId, course.id),
            eq(enrollments.status, "enrolled")
          )
        )
        .all().length
    const before = enrolled()
    expect(before).toBeGreaterThan(0)
    expect(
      (
        await eli.post(`/api/levels/courses/${course.id}/roster`, {
          emails: [],
        })
      ).status
    ).toBe(400)
    expect(
      (
        await eli.post(`/api/levels/courses/${course.id}/roster`, {
          emails: ["nobody@elsewhere.edu"],
        })
      ).status
    ).toBe(400)
    expect(enrolled()).toBe(before)
  })
})
