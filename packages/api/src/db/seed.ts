import { localToUtc, planStages, utcToLocal } from "@studio/domain"
import { config } from "../config.ts"
import { seedEquipment } from "./seedEquipment.ts"
import { now } from "../lib/clock.ts"
import type { DB } from "./client.ts"
import * as s from "./schema.ts"

// Demo data. Dates are relative to "today" in the campus time zone so the demo never goes stale.

function dayOffset(n: number): string {
  const d = new Date(`${utcToLocal(now(), config.tz).day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function seed(db: DB): void {
  db.transaction((tx) => {
    const t = tx as unknown as DB

    // Levels (F-002)
    const [l1, l2, l3] = t
      .insert(s.levels)
      .values([
        {
          name: "Level 1 – Foundations",
          rank: 1,
          description: "Audio booth and basic audio kit.",
        },
        {
          name: "Level 2 – Intermediate",
          rank: 2,
          description: "Lighting and green screen.",
        },
        {
          name: "Level 3 – Advanced",
          rank: 3,
          description: "Cinema cameras and the sound stage.",
        },
      ])
      .returning()
      .all()

    // Studios (F-004)
    const [studioA, studioB, studioC] = t
      .insert(s.studios)
      .values([
        {
          name: "Studio A – Podcast Booth",
          location: "Media Bldg 101",
          capacityPeople: 4,
          minLevelId: l1!.id,
          turnaroundMinutes: 30,
        },
        {
          name: "Studio B – Sound Stage",
          location: "Media Bldg 140",
          capacityPeople: 20,
          minLevelId: l3!.id,
          turnaroundMinutes: 60,
        },
        {
          name: "Studio C – Green Screen",
          location: "Media Bldg 120",
          capacityPeople: 8,
          minLevelId: l2!.id,
          turnaroundMinutes: 30,
        },
      ])
      .returning()
      .all()
    const hours: (typeof s.openingHours.$inferInsert)[] = []
    for (let wd = 0; wd < 7; wd++) {
      hours.push({
        studioId: studioA!.id,
        weekday: wd,
        opens: "08:00",
        closes: "22:00",
      })
      hours.push({
        studioId: studioC!.id,
        weekday: wd,
        opens: "09:00",
        closes: "21:00",
      })
      if (wd < 5)
        hours.push({
          studioId: studioB!.id,
          weekday: wd,
          opens: "08:00",
          closes: "22:00",
        })
      else
        hours.push({
          studioId: studioB!.id,
          weekday: wd,
          opens: "10:00",
          closes: "18:00",
        })
    }
    t.insert(s.openingHours).values(hours).run()

    // Users and roles (F-001)
    const mk = (
      key: string,
      name: string,
      affiliation: "student" | "faculty" | "staff"
    ) => ({
      idpSubject: `dev|${key}`,
      email: `${key}@university.edu`,
      displayName: name,
      affiliation,
    })
    const [admin, manager, sam, tara, patel, nguyen, alice, ben, chloe, dan] = t
      .insert(s.users)
      .values([
        mk("ada.admin", "Ada Admin", "staff"),
        mk("eli.manager", "Eli Manager", "staff"),
        mk("sam.staff", "Sam Staff", "staff"),
        mk("tara.tech", "Tara Tech", "staff"),
        mk("priya.patel", "Prof. Priya Patel", "faculty"),
        mk("minh.nguyen", "Prof. Minh Nguyen", "faculty"),
        mk("alice.student", "Alice Student", "student"),
        mk("ben.student", "Ben Student", "student"),
        mk("chloe.student", "Chloe Student", "student"),
        mk("dan.student", "Dan Student", "student"),
      ])
      .returning()
      .all()
    t.insert(s.roleAssignments)
      .values([
        { userId: admin!.id, role: "ADMIN" },
        { userId: manager!.id, role: "EQUIPMENT_MANAGER" },
        { userId: sam!.id, role: "STUDIO_STAFF", studioId: studioA!.id },
        { userId: sam!.id, role: "STUDIO_STAFF", studioId: studioC!.id },
        { userId: tara!.id, role: "STUDIO_STAFF", studioId: studioB!.id },
        { userId: patel!.id, role: "SPONSOR", source: "auto" },
        { userId: nguyen!.id, role: "SPONSOR", source: "auto" },
        { userId: alice!.id, role: "STUDENT", source: "auto" },
        { userId: ben!.id, role: "STUDENT", source: "auto" },
        { userId: chloe!.id, role: "STUDENT", source: "auto" },
        { userId: dan!.id, role: "STUDENT", source: "auto" },
      ])
      .run()

    // Courses and grants (F-002)
    const termStart = dayOffset(-30)
    const termEnd = dayOffset(90)
    const [film101, film201, film301] = t
      .insert(s.courseOfferings)
      .values([
        {
          courseCode: "FILM 101",
          section: "01",
          term: "Current",
          startDate: termStart,
          endDate: termEnd,
          levelId: l1!.id,
        },
        {
          courseCode: "FILM 201",
          section: "01",
          term: "Current",
          startDate: termStart,
          endDate: termEnd,
          levelId: l2!.id,
        },
        {
          courseCode: "FILM 301",
          section: "01",
          term: "Current",
          startDate: termStart,
          endDate: termEnd,
          levelId: l3!.id,
        },
      ])
      .returning()
      .all()
    const enroll = (courseId: string, levelId: string, userId: string) => {
      const e = t
        .insert(s.enrollments)
        .values({ courseOfferingId: courseId, userId })
        .returning()
        .get()
      t.insert(s.levelGrants)
        .values({
          userId,
          levelId,
          source: "course",
          enrollmentId: e.id,
          validFrom: termStart,
          validUntil: termEnd,
          grantedBy: manager!.id,
        })
        .run()
    }
    enroll(film101!.id, l1!.id, alice!.id)
    enroll(film201!.id, l2!.id, ben!.id)
    enroll(film301!.id, l3!.id, chloe!.id)
    // Manual Level 3 grant ending the day before Ben's Green screen interview, which books a
    // Level 3 FX6: the first job run sends GRANT_EXPIRING to Ben and his sponsor (BR-002-10).
    t.insert(s.levelGrants)
      .values({
        userId: ben!.id,
        levelId: l3!.id,
        source: "manual",
        validFrom: dayOffset(-10),
        validUntil: dayOffset(5),
        reason: "Assisting on a thesis shoot",
        grantedBy: manager!.id,
      })
      .run()

    // Equipment (F-003): see seedEquipment.ts for the full sample catalog.
    const catalog = seedEquipment(
      t,
      { 1: l1!.id, 2: l2!.id, 3: l3!.id },
      dayOffset
    )
    const typeNamed = (name: string) => {
      const type = catalog.get(name)
      if (!type) throw new Error(`seed: no equipment type ${name}`)
      return type
    }
    const sm7b = typeNamed("Shure SM7B Microphone")
    const xlr = typeNamed("XLR Cable 25ft")
    const aputure = typeNamed("Aputure 300d LED")
    const cstand = typeNamed("C-Stand")
    const fx6 = typeNamed("Sony FX6 Kit")

    // Event types and stage schedules (F-005)
    const [podcast, shoot, thesis] = t
      .insert(s.eventTypes)
      .values([
        {
          name: "Podcast Recording",
          description: "Single-session audio recording.",
          maxDays: 1,
          maxHoursPerDay: 4,
          pickupWindowMinutes: 30,
        },
        {
          name: "Class Project Shoot",
          description: "Coursework video shoot.",
          maxDays: 2,
          maxHoursPerDay: 8,
          requiresResults: true,
          resultsDueDays: 7,
          requesterCanUpload: true,
        },
        {
          name: "Thesis Production",
          description: "Multi-day thesis production.",
          maxDays: 5,
          maxHoursPerDay: 10,
          requiresResults: true,
          resultsDueDays: 14,
          requesterCanUpload: true,
          requiresSponsorSignoff: true,
        },
      ])
      .returning()
      .all()
    t.insert(s.eventTypeStudios)
      .values([
        { eventTypeId: podcast!.id, studioId: studioA!.id },
        { eventTypeId: shoot!.id, studioId: studioB!.id },
        { eventTypeId: shoot!.id, studioId: studioC!.id },
        { eventTypeId: thesis!.id, studioId: studioB!.id },
        { eventTypeId: thesis!.id, studioId: studioC!.id },
      ])
      .run()
    const D = 1440
    const st = (
      eventTypeId: string,
      rows: Omit<typeof s.stageTemplates.$inferInsert, "eventTypeId">[]
    ) =>
      t
        .insert(s.stageTemplates)
        .values(rows.map((r) => ({ ...r, eventTypeId })))
        .run()
    st(podcast!.id, [
      {
        seq: 1,
        name: "Your session: what to expect",
        kind: "reminder",
        anchor: "event_start",
        offsetMinutes: -7 * D,
        recipients: ["requester", "sponsor"],
        message:
          "Your podcast session in {studio.name} is on {event.first_day}. Pickup opens {pickup.window}.",
      },
      {
        seq: 2,
        name: "Tomorrow: session details",
        kind: "reminder",
        anchor: "event_start",
        offsetMinutes: -D,
        recipients: ["requester", "participants"],
        message:
          "Reminder: {event.title} starts tomorrow. Pickup opens {pickup.window}.",
      },
      {
        seq: 3,
        name: "Return equipment",
        kind: "reminder",
        anchor: "event_end",
        offsetMinutes: -30,
        recipients: ["requester"],
        message: "Please return all equipment for {event.title} on time.",
      },
    ])
    st(shoot!.id, [
      {
        seq: 1,
        name: "Your shoot: what to expect",
        kind: "reminder",
        anchor: "event_start",
        offsetMinutes: -14 * D,
        recipients: ["requester", "sponsor"],
        message:
          "{event.title} in {studio.name} starts {event.first_day}. Pickup opens {pickup.window}.",
      },
      {
        seq: 2,
        name: "Submit shot list",
        kind: "task",
        anchor: "event_start",
        offsetMinutes: -3 * D,
        recipients: ["requester"],
        assigneeRole: "requester",
        message: "Upload or share your shot list with studio staff.",
      },
      {
        seq: 3,
        name: "Tomorrow: pickup details",
        kind: "reminder",
        anchor: "event_start",
        offsetMinutes: -D,
        recipients: ["requester", "participants"],
        message: "Pickup opens {pickup.window}.",
      },
      {
        seq: 4,
        name: "Daily start reminder",
        kind: "reminder",
        anchor: "each_day_start",
        offsetMinutes: -60,
        recipients: ["requester", "participants"],
        message: "Your shoot day starts in one hour.",
      },
    ])
    st(thesis!.id, [
      {
        seq: 1,
        name: "Your production: what to expect",
        kind: "reminder",
        anchor: "event_start",
        offsetMinutes: -14 * D,
        recipients: ["requester", "sponsor"],
        message:
          "{event.title} in {studio.name} starts {event.first_day}. Pickup opens {pickup.window}.",
      },
      {
        seq: 2,
        name: "Submit shot list",
        kind: "task",
        anchor: "event_start",
        offsetMinutes: -7 * D,
        recipients: ["requester"],
        assigneeRole: "requester",
        message: "Share your shot list.",
      },
      {
        seq: 3,
        name: "Safety briefing acknowledged",
        kind: "task",
        anchor: "event_start",
        offsetMinutes: -3 * D,
        recipients: ["requester", "studio_staff"],
        assigneeRole: "requester",
        blocksCheckout: true,
        message: "Complete the sound stage safety briefing.",
      },
      {
        seq: 4,
        name: "Tomorrow: pickup details",
        kind: "reminder",
        anchor: "event_start",
        offsetMinutes: -D,
        recipients: ["requester", "participants"],
        message: "Pickup opens {pickup.window}.",
      },
      {
        seq: 5,
        name: "Equipment ready for pickup",
        kind: "reminder",
        anchor: "event_start",
        offsetMinutes: -60,
        recipients: ["requester"],
        message: "Your equipment is ready.",
      },
      {
        seq: 6,
        name: "Daily start reminder",
        kind: "reminder",
        anchor: "each_day_start",
        offsetMinutes: -60,
        recipients: ["requester", "participants"],
        message: "Your shoot day starts in one hour.",
      },
      {
        seq: 7,
        name: "Return equipment",
        kind: "reminder",
        anchor: "event_end",
        offsetMinutes: -30,
        recipients: ["requester"],
        message: "Return all equipment on time.",
      },
    ])

    // Sample events (F-006) so every role has something to look at.
    const mkEvent = (
      e: Omit<typeof s.events.$inferInsert, "id">,
      days: { day: string; startTime: string; endTime: string }[],
      lines: { equipmentTypeId: string; qty: number }[]
    ) => {
      const ev = t.insert(s.events).values(e).returning().get()
      const dayRows = days.map((d) => ({
        eventId: ev.id,
        ...d,
        startsAt: localToUtc(d.day, d.startTime, config.tz),
        endsAt: localToUtc(d.day, d.endTime, config.tz),
      }))
      t.insert(s.eventDays).values(dayRows).run()
      if (lines.length)
        t.insert(s.equipmentLines)
          .values(lines.map((l) => ({ ...l, eventId: ev.id })))
          .run()
      return { ev, dayRows }
    }
    const ts = now()
    mkEvent(
      {
        title: "Episode 4: Campus Food",
        eventTypeId: podcast!.id,
        studioId: studioA!.id,
        requesterId: alice!.id,
        sponsorId: patel!.id,
        state: "Submitted",
        submittedAt: ts,
      },
      [{ day: dayOffset(4), startTime: "14:00", endTime: "16:00" }],
      [
        { equipmentTypeId: sm7b.id, qty: 2 },
        { equipmentTypeId: xlr.id, qty: 2 },
      ]
    )
    mkEvent(
      {
        title: "Green screen interview",
        eventTypeId: shoot!.id,
        studioId: studioC!.id,
        requesterId: ben!.id,
        sponsorId: nguyen!.id,
        state: "SponsorApproved",
        submittedAt: ts,
        sponsorDecidedAt: ts,
      },
      [{ day: dayOffset(6), startTime: "10:00", endTime: "15:00" }],
      [
        { equipmentTypeId: aputure.id, qty: 2 },
        { equipmentTypeId: cstand.id, qty: 2 },
        // Level 3 class: depends on Ben's expiring manual grant (BR-002-10 demo).
        { equipmentTypeId: fx6.id, qty: 1 },
      ]
    )
    const thesisEvent = mkEvent(
      {
        title: "Thesis: The Last Projectionist",
        eventTypeId: thesis!.id,
        studioId: studioB!.id,
        requesterId: chloe!.id,
        sponsorId: patel!.id,
        state: "Confirmed",
        submittedAt: ts,
        sponsorDecidedAt: ts,
        staffDecidedAt: ts,
      },
      [
        { day: dayOffset(9), startTime: "10:00", endTime: "17:00" },
        { day: dayOffset(10), startTime: "10:00", endTime: "17:00" },
      ],
      [
        { equipmentTypeId: fx6.id, qty: 1 },
        { equipmentTypeId: aputure.id, qty: 1 },
        { equipmentTypeId: sm7b.id, qty: 1 },
      ]
    )
    t.insert(s.eventParticipants)
      .values({ eventId: thesisEvent.ev.id, userId: ben!.id })
      .run()
    const templates = t
      .select()
      .from(s.stageTemplates)
      .all()
      .filter((x) => x.eventTypeId === thesis!.id)
    const planned = planStages(
      templates,
      thesisEvent.dayRows.map((d) => ({ start: d.startsAt, end: d.endsAt })),
      ts,
      config.tz,
      config.quietHours
    )
    t.insert(s.stageInstances)
      .values(
        planned.map((p) => {
          const tpl = templates.find((x) => x.id === p.templateId)!
          return {
            eventId: thesisEvent.ev.id,
            stageTemplateId: tpl.id,
            dayIndex: p.dayIndex,
            name: tpl.name,
            kind: tpl.kind,
            recipients: tpl.recipients,
            assigneeRole: tpl.assigneeRole,
            blocksCheckout: tpl.blocksCheckout,
            message: tpl.message,
            dueAt: p.dueAt,
            status: p.status,
          }
        })
      )
      .run()
  })
}
