import { describe, expect, it } from "vitest"
import {
  type SubmissionContext,
  can,
  deniedStudios,
  editAction,
  effectivePermissions,
  effectiveLevel,
  eventLevel,
  hasUnscoped,
  localToUtc,
  nextState,
  planStages,
  reservedQty,
  serializedCapacity,
  softCodes,
  studiosFor,
  utcToLocal,
  validateSubmission,
} from "./index.ts"

const TZ = "America/Chicago"

describe("levels (F-002)", () => {
  const course = {
    levelRank: 1,
    validFrom: "2027-01-20",
    validUntil: "2027-05-15",
    revokedOn: null,
  }
  const manual = {
    levelRank: 3,
    validFrom: "2027-01-01",
    validUntil: "2027-03-01",
    revokedOn: null,
  }

  it("takes the highest active grant per day (US-002-03)", () => {
    expect(effectiveLevel([course, manual], "2027-02-01")).toBe(3)
    expect(effectiveLevel([course, manual], "2027-04-01")).toBe(1)
    expect(effectiveLevel([course, manual], "2027-05-16")).toBe(0)
  })

  it("requires coverage on every event day (US-002-05)", () => {
    const l3 = {
      levelRank: 3,
      validFrom: "2027-01-01",
      validUntil: "2027-05-15",
      revokedOn: null,
    }
    expect(eventLevel([l3], ["2027-05-14", "2027-05-15", "2027-05-16"])).toBe(0)
  })

  it("treats revocation as effective from the revocation day", () => {
    const g = { ...course, revokedOn: "2027-03-03" }
    expect(effectiveLevel([g], "2027-03-02")).toBe(1)
    expect(effectiveLevel([g], "2027-03-03")).toBe(0)
  })

  it("keeps open-ended grants active indefinitely", () => {
    expect(
      effectiveLevel(
        [
          {
            levelRank: 2,
            validFrom: "2027-01-01",
            validUntil: null,
            revokedOn: null,
          },
        ],
        "2035-01-01"
      )
    ).toBe(2)
  })
})

describe("time zone conversion", () => {
  it("round-trips across DST", () => {
    const iso = localToUtc("2027-03-14", "10:00", TZ) // DST starts 2027-03-14 in the US
    expect(iso).toBe("2027-03-14T15:00:00.000Z")
    expect(utcToLocal(iso, TZ)).toMatchObject({
      day: "2027-03-14",
      time: "10:00",
      weekday: 6,
    })
  })
})

describe("availability (F-003)", () => {
  it("counts in-repair units only when back before the window", () => {
    const units = [
      { status: "available" as const, expectedBack: null },
      { status: "in_repair" as const, expectedBack: "2027-03-20" },
      { status: "damaged" as const, expectedBack: null },
    ]
    expect(serializedCapacity(units, "2027-03-20")).toBe(1)
    expect(serializedCapacity(units, "2027-03-21")).toBe(2)
  })

  it("sums overlapping reservations, excluding the event under test", () => {
    const w = (s: string, e: string) => ({ start: s, end: e })
    const res = [
      {
        equipmentTypeId: "fx6",
        qty: 1,
        eventId: "a",
        window: w("2027-04-05T14:00:00Z", "2027-04-05T18:00:00Z"),
      },
      {
        equipmentTypeId: "fx6",
        qty: 1,
        eventId: "b",
        window: w("2027-04-05T18:00:00Z", "2027-04-05T20:00:00Z"),
      },
    ]
    expect(
      reservedQty(res, "fx6", w("2027-04-05T17:00:00Z", "2027-04-05T19:00:00Z"))
    ).toBe(2)
    expect(
      reservedQty(
        res,
        "fx6",
        w("2027-04-05T17:00:00Z", "2027-04-05T19:00:00Z"),
        "a"
      )
    ).toBe(1)
    expect(
      reservedQty(res, "fx6", w("2027-04-05T20:00:00Z", "2027-04-05T21:00:00Z"))
    ).toBe(0)
  })
})

function baseCtx(
  overrides: Partial<SubmissionContext> = {}
): SubmissionContext {
  return {
    now: "2027-04-01T15:00:00.000Z",
    tz: TZ,
    requesterId: "stu",
    requesterHasActiveHold: false,
    sponsor: { id: "prof", active: true, isSponsor: true },
    eventType: {
      active: true,
      maxDays: 3,
      maxHoursPerDay: 8,
      allowedStudioIds: ["A"],
    },
    studio: {
      id: "A",
      active: true,
      minLevelRank: 1,
      minLevelName: "Level 1",
      turnaroundMinutes: 30,
      slotGranularityMinutes: 30,
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        opens: "08:00",
        closes: "22:00",
      })),
      blackouts: [],
    },
    studioBusy: [],
    days: [{ day: "2027-04-06", startTime: "10:00", endTime: "13:00" }],
    grants: [
      {
        levelRank: 2,
        validFrom: "2027-01-01",
        validUntil: null,
        revokedOn: null,
      },
    ],
    lines: [],
    policy: {
      leadTimeHours: 48,
      advanceDays: 60,
      weeklyHours: 10,
      openCap: 3,
      decisionCutoffHours: 24,
    },
    requesterWeeklyHours: {},
    requesterOpenEvents: 0,
    ...overrides,
  }
}

describe("validateSubmission (F-006 §5)", () => {
  it("accepts a valid request", () => {
    expect(validateSubmission(baseCtx())).toEqual([])
  })

  it("rejects non-consecutive days (US-006-02 AC2)", () => {
    const issues = validateSubmission(
      baseCtx({
        days: [
          { day: "2027-04-06", startTime: "10:00", endTime: "12:00" },
          { day: "2027-04-08", startTime: "10:00", endTime: "12:00" },
        ],
      })
    )
    expect(issues.map((i) => i.code)).toContain("DAYS_NOT_CONSECUTIVE")
  })

  it("enforces turnaround against existing bookings (US-004-01)", () => {
    const busy = [
      {
        start: localToUtc("2027-04-06", "08:00", TZ),
        end: localToUtc("2027-04-06", "10:00", TZ),
      },
    ]
    expect(
      validateSubmission(baseCtx({ studioBusy: busy })).map((i) => i.code)
    ).toContain("STUDIO_CONFLICT")
    const later = baseCtx({
      studioBusy: busy,
      days: [{ day: "2027-04-06", startTime: "10:30", endTime: "12:00" }],
    })
    expect(validateSubmission(later)).toEqual([])
  })

  it("treats lead time as soft but the decision cutoff as hard", () => {
    const soon = validateSubmission(
      baseCtx({
        days: [{ day: "2027-04-02", startTime: "16:00", endTime: "18:00" }],
      })
    )
    expect(soon.find((i) => i.code === "LEAD_TIME")?.severity).toBe("soft")
    expect(softCodes(soon)).toEqual(["LEAD_TIME"])
    const tooSoon = validateSubmission(
      baseCtx({
        days: [{ day: "2027-04-02", startTime: "09:00", endTime: "10:00" }],
      })
    )
    expect(tooSoon.find((i) => i.code === "DECISION_CUTOFF")?.severity).toBe(
      "hard"
    )
  })

  it("flags equipment above the student's level and shortages", () => {
    const issues = validateSubmission(
      baseCtx({
        lines: [
          {
            equipmentTypeId: "fx6",
            qty: 2,
            typeName: "Sony FX6",
            typeActive: true,
            classMinLevelRank: 3,
            classMinLevelName: "Level 3",
            maxPerEvent: null,
            availableQty: 1,
          },
        ],
      })
    )
    expect(issues.map((i) => i.code).sort()).toEqual([
      "EQUIPMENT_SHORTAGE",
      "LEVEL_EQUIPMENT",
    ])
  })

  it("blocks self-sponsorship and active holds", () => {
    const issues = validateSubmission(
      baseCtx({
        requesterHasActiveHold: true,
        sponsor: { id: "stu", active: true, isSponsor: true },
      })
    )
    expect(issues.map((i) => i.code).sort()).toEqual([
      "HOLD_ACTIVE",
      "SPONSOR_SELF",
    ])
  })

  it("counts existing weekly hours toward the cap", () => {
    const issues = validateSubmission(
      baseCtx({ requesterWeeklyHours: { "2027-W14": 8 } })
    )
    expect(issues.map((i) => i.code)).toEqual(["WEEKLY_HOURS"])
  })
})

/** One equipment line that is bookable on the base request unless a field is overridden. */
const line = (o: Partial<SubmissionContext["lines"][number]> = {}) => ({
  equipmentTypeId: "sm58",
  qty: 1,
  typeName: "Shure SM58",
  typeActive: true,
  classMinLevelRank: 1,
  classMinLevelName: "Level 1",
  maxPerEvent: null,
  availableQty: 5,
  ...o,
})

// Every rule in F-006 §5 / BR-006-05, one row each. Each row changes one thing on the otherwise valid
// base request and pins the exact issues it raises: dropping a rule, raising it as the wrong severity
// (soft rules can be justified, hard ones can't), or a rule firing when it shouldn't all fail a row.
describe("validateSubmission rule table (F-006 §5)", () => {
  const H = "hard" as const
  const S = "soft" as const
  it.each<{
    rule: string
    ctx: Partial<SubmissionContext>
    expected: [string, "hard" | "soft"][]
  }>([
    { rule: "no days", ctx: { days: [] }, expected: [["NO_DAYS", H]] },
    {
      rule: "end before start",
      ctx: {
        days: [{ day: "2027-04-06", startTime: "13:00", endTime: "10:00" }],
      },
      expected: [["DAY_INVALID", H]],
    },
    {
      rule: "starts in the past",
      ctx: {
        days: [{ day: "2027-03-31", startTime: "10:00", endTime: "11:00" }],
      },
      expected: [
        ["IN_PAST", H],
        ["DECISION_CUTOFF", H],
      ],
    },
    {
      rule: "event type retired",
      ctx: { eventType: { ...baseCtx().eventType, active: false } },
      expected: [["TYPE_INACTIVE", H]],
    },
    {
      rule: "studio not allowed for the event type",
      ctx: {
        eventType: { ...baseCtx().eventType, allowedStudioIds: ["B"] },
      },
      expected: [["TYPE_STUDIO_NOT_ALLOWED", H]],
    },
    {
      rule: "more days than the event type allows",
      ctx: {
        eventType: { ...baseCtx().eventType, maxDays: 1 },
        days: [
          { day: "2027-04-06", startTime: "10:00", endTime: "12:00" },
          { day: "2027-04-07", startTime: "10:00", endTime: "12:00" },
        ],
      },
      expected: [["TYPE_MAX_DAYS", H]],
    },
    {
      rule: "longer day than the event type allows",
      ctx: { eventType: { ...baseCtx().eventType, maxHoursPerDay: 2 } },
      expected: [["TYPE_MAX_HOURS", H]],
    },
    {
      rule: "booked further ahead than the advance window",
      ctx: {
        days: [{ day: "2027-06-15", startTime: "10:00", endTime: "13:00" }],
      },
      expected: [["ADVANCE", S]],
    },
    {
      rule: "one open request over the cap",
      ctx: { requesterOpenEvents: 3 },
      expected: [["OPEN_CAP", S]],
    },
    {
      rule: "at the open-request cap",
      ctx: { requesterOpenEvents: 2 },
      expected: [],
    },
    {
      rule: "studio closed for bookings",
      ctx: { studio: { ...baseCtx().studio, active: false } },
      expected: [["STUDIO_INACTIVE", H]],
    },
    {
      rule: "times off the studio's slot grid",
      ctx: {
        days: [{ day: "2027-04-06", startTime: "10:15", endTime: "12:15" }],
      },
      expected: [["SLOT_GRANULARITY", H]],
    },
    {
      rule: "starts before opening",
      ctx: {
        days: [{ day: "2027-04-06", startTime: "07:00", endTime: "09:00" }],
      },
      expected: [["OUTSIDE_HOURS", H]],
    },
    {
      rule: "studio closed that weekday",
      ctx: {
        studio: {
          ...baseCtx().studio,
          // 2027-04-06 is a Tuesday (weekday 1); open every other day.
          openingHours: [0, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            opens: "08:00",
            closes: "22:00",
          })),
        },
      },
      expected: [["OUTSIDE_HOURS", H]],
    },
    {
      rule: "overlaps a blackout",
      ctx: {
        studio: {
          ...baseCtx().studio,
          blackouts: [
            {
              start: localToUtc("2027-04-06", "11:00", TZ),
              end: localToUtc("2027-04-06", "12:00", TZ),
            },
          ],
        },
      },
      expected: [["BLACKOUT", H]],
    },
    {
      rule: "studio needs a higher level",
      ctx: {
        studio: {
          ...baseCtx().studio,
          minLevelRank: 3,
          minLevelName: "Level 3",
        },
      },
      expected: [["LEVEL_STUDIO", H]],
    },
    {
      rule: "studio level lapses before the last day",
      ctx: {
        grants: [
          {
            levelRank: 2,
            validFrom: "2027-01-01",
            validUntil: "2027-04-06",
            revokedOn: null,
          },
        ],
        days: [
          { day: "2027-04-06", startTime: "10:00", endTime: "12:00" },
          { day: "2027-04-07", startTime: "10:00", endTime: "12:00" },
        ],
      },
      expected: [["LEVEL_STUDIO", H]],
    },
    {
      rule: "equipment type retired",
      ctx: { lines: [line({ typeActive: false })] },
      expected: [["EQUIPMENT_INACTIVE", H]],
    },
    {
      rule: "more of an item than the per-event limit",
      ctx: { lines: [line({ qty: 3, maxPerEvent: 2 })] },
      expected: [["MAX_PER_EVENT", S]],
    },
    {
      rule: "exactly the per-event limit",
      ctx: { lines: [line({ qty: 2, maxPerEvent: 2 })] },
      expected: [],
    },
    {
      rule: "no sponsor",
      ctx: { sponsor: null },
      expected: [["SPONSOR_REQUIRED", H]],
    },
    {
      rule: "sponsor account disabled",
      ctx: { sponsor: { id: "prof", active: false, isSponsor: true } },
      expected: [["SPONSOR_INVALID", H]],
    },
    {
      rule: "sponsor lacks the Sponsor role",
      ctx: { sponsor: { id: "prof", active: true, isSponsor: false } },
      expected: [["SPONSOR_INVALID", H]],
    },
  ])("$rule", ({ ctx, expected }) => {
    const issues = validateSubmission(baseCtx(ctx))
    expect(issues.map((i) => [i.code, i.severity])).toEqual(expected)
  })
})

describe("event state machine (F-006 §4, BR-006-11)", () => {
  it("returns confirmed events to staff on material change, to sponsor on sponsor change", () => {
    const material = editAction({
      sponsorChanged: false,
      typeChanged: false,
      daysChanged: true,
      studioChanged: false,
      equipmentIncreased: false,
    })
    expect(nextState("Confirmed", material!)).toBe("SponsorApproved")
    const approval = editAction({
      sponsorChanged: true,
      typeChanged: false,
      daysChanged: true,
      studioChanged: false,
      equipmentIncreased: false,
    })
    expect(nextState("Confirmed", approval!)).toBe("Submitted")
    expect(
      editAction({
        sponsorChanged: false,
        typeChanged: false,
        daysChanged: false,
        studioChanged: false,
        equipmentIncreased: false,
      })
    ).toBeNull()
  })

  it("does not allow cancelling once checked out", () => {
    expect(nextState("InProgress", "cancel")).toBeNull()
  })
})

describe("planStages (F-005)", () => {
  const quiet = { start: "22:00", end: "07:00" }
  const days = [
    {
      start: localToUtc("2027-04-10", "10:00", TZ),
      end: localToUtc("2027-04-10", "18:00", TZ),
    },
    {
      start: localToUtc("2027-04-11", "10:00", TZ),
      end: localToUtc("2027-04-11", "18:00", TZ),
    },
  ]
  const tpl = [
    {
      id: "confirm",
      seq: 1,
      kind: "reminder" as const,
      anchor: "event_start" as const,
      offsetMinutes: -14 * 1440,
    },
    {
      id: "wk",
      seq: 2,
      kind: "reminder" as const,
      anchor: "event_start" as const,
      offsetMinutes: -7 * 1440,
    },
    {
      id: "day",
      seq: 3,
      kind: "reminder" as const,
      anchor: "event_start" as const,
      offsetMinutes: -1440,
    },
    {
      id: "safety",
      seq: 4,
      kind: "task" as const,
      anchor: "event_start" as const,
      offsetMinutes: -3 * 1440,
    },
    {
      id: "daily",
      seq: 5,
      kind: "reminder" as const,
      anchor: "each_day_start" as const,
      offsetMinutes: -60,
    },
  ]

  it("sends the first stage now, skips other past reminders, opens tasks (US-005-02)", () => {
    const now = localToUtc("2027-04-08", "12:00", TZ)
    const planned = planStages(tpl, days, now, TZ, quiet)
    const by = (id: string) => planned.filter((p) => p.templateId === id)
    expect(by("confirm")[0]).toMatchObject({ status: "scheduled", dueAt: now })
    expect(by("wk")[0]?.status).toBe("skipped")
    expect(by("day")[0]?.status).toBe("scheduled")
    expect(by("safety")[0]?.status).toBe("open")
    expect(by("daily")).toHaveLength(2) // US-005-04
  })

  it("moves reminders out of quiet hours", () => {
    const early = [
      {
        id: "x",
        seq: 1,
        kind: "reminder" as const,
        anchor: "event_start" as const,
        offsetMinutes: -60 * 12,
      },
    ]
    // 10:00 − 12h = 22:00 the previous evening → moved to 07:00 the event day
    const [p] = planStages(
      early,
      days,
      localToUtc("2027-04-01", "12:00", TZ),
      TZ,
      quiet
    )
    expect(utcToLocal(p!.dueAt, TZ)).toMatchObject({
      day: "2027-04-10",
      time: "07:00",
    })
  })
})

describe("permissions (F-001)", () => {
  it("limits studio staff to their studio", () => {
    const staff = { roles: [{ role: "STUDIO_STAFF" as const, studioId: "A" }] }
    expect(can(staff, "event.staff_decide", { studioId: "A" })).toBe(true)
    expect(can(staff, "event.staff_decide", { studioId: "B" })).toBe(false)
    expect(can(staff, "grant.manage")).toBe(false)
  })

  it("limits students to their own records", () => {
    const stu = { roles: [{ role: "STUDENT" as const, studioId: null }] }
    expect(can(stu, "event.view", { own: true })).toBe(true)
    expect(can(stu, "event.view", { own: false, studioId: "A" })).toBe(false)
  })

  it("removes an individually denied permission in every scope, whatever roles grant it (BR-001-14)", () => {
    const sam = {
      roles: [
        { role: "STUDIO_STAFF" as const, studioId: "A" },
        { role: "EQUIPMENT_MANAGER" as const, studioId: null },
      ],
      denied: [{ permission: "checkout.perform" as const, studioId: null }],
    }
    expect(can(sam, "checkout.perform", { studioId: "A" })).toBe(false)
    expect(can(sam, "checkout.perform")).toBe(false)
    expect(studiosFor(sam, "checkout.perform")).toEqual([])
    expect(hasUnscoped(sam, "checkout.perform")).toBe(false)
    // Other permissions from the same roles are untouched.
    expect(can(sam, "event.staff_decide", { studioId: "A" })).toBe(true)
    expect(
      effectivePermissions(sam).find((g) => g.permission === "checkout.perform")
    ).toMatchObject({
      denied: true,
      sources: [
        { role: "STUDIO_STAFF", scope: "studio" },
        { role: "EQUIPMENT_MANAGER", scope: "all" },
      ],
    })
  })

  it("removes a permission for one studio only, including access an 'all' scope would give (BR-001-15)", () => {
    const staffAC = {
      roles: [
        { role: "STUDIO_STAFF" as const, studioId: "A" },
        { role: "STUDIO_STAFF" as const, studioId: "C" },
      ],
      denied: [{ permission: "checkout.perform" as const, studioId: "A" }],
    }
    expect(can(staffAC, "checkout.perform", { studioId: "A" })).toBe(false)
    expect(can(staffAC, "checkout.perform", { studioId: "C" })).toBe(true)
    expect(can(staffAC, "checkout.perform")).toBe(true)
    expect(studiosFor(staffAC, "checkout.perform")).toEqual(["C"])

    const manager = {
      roles: [{ role: "EQUIPMENT_MANAGER" as const, studioId: null }],
      denied: [{ permission: "checkout.perform" as const, studioId: "A" }],
    }
    expect(can(manager, "checkout.perform", { studioId: "A" })).toBe(false)
    expect(can(manager, "checkout.perform", { studioId: "B" })).toBe(true)
    expect(hasUnscoped(manager, "checkout.perform")).toBe(true)
    expect(deniedStudios(manager, "checkout.perform")).toEqual(["A"])

    // Removing the only studio a staff member works in leaves no access at all.
    const staffA = { roles: [staffAC.roles[0]!], denied: staffAC.denied }
    expect(can(staffA, "checkout.perform")).toBe(false)
  })
})
