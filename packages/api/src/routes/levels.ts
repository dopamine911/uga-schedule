import { REVIEWABLE, effectiveLevel, isLocalDate } from "@studio/domain"
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  gte,
  sql,
} from "drizzle-orm"
import { Hono } from "hono"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { DB } from "../db/client.ts"
import {
  courseOfferings,
  enrollments,
  equipmentClasses,
  events,
  levelGrants,
  levels,
  studios,
  users,
} from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { audit } from "../lib/audit.ts"
import { authorize, requireUser } from "../lib/auth.ts"
import { conflict, badRequest, notFound } from "../lib/errors.ts"
import { notify } from "../lib/notify.ts"
import { v } from "../lib/validate.ts"
import { recheckEvents } from "../services/review.ts"
import { getPolicies } from "../services/policy.ts"
import { grantsFor } from "../services/booking.ts"
import { today } from "./users.ts"

// F-002: levels, courses, enrolments and manual grants.

export type GrantStatus =
  | "scheduled"
  | "active"
  | "expiring"
  | "expired"
  | "revoked"

/** Status label for a grant on `day` (F-002 §5). */
export function grantStatus(
  g: { validFrom: string; validUntil: string | null; revokedOn: string | null },
  day: string,
  warnDays: number
): GrantStatus {
  if (g.revokedOn !== null) return "revoked"
  if (g.validFrom > day) return "scheduled"
  if (g.validUntil !== null && g.validUntil < day) return "expired"
  if (g.validUntil !== null && daysBetween(day, g.validUntil) <= warnDays)
    return "expiring"
  return "active"
}

function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000
  )
}

export interface GrantView {
  id: string
  userId: string
  levelId: string
  levelName: string
  levelRank: number
  source: "course" | "manual"
  courseCode: string | null
  enrollmentId: string | null
  validFrom: string
  validUntil: string | null
  revokedOn: string | null
  reason: string
  revokeReason: string | null
  status: GrantStatus
}

/** Grants of one user with level and course, for the user's own view and staff views (BR-002-12). */
export function listGrants(db: DB, userId: string): GrantView[] {
  const day = today()
  const warnDays = getPolicies(db).GRANT_EXPIRY_WARN_DAYS
  const rows = db
    .select({
      id: levelGrants.id,
      userId: levelGrants.userId,
      levelId: levels.id,
      levelName: levels.name,
      levelRank: levels.rank,
      source: levelGrants.source,
      courseCode: courseOfferings.courseCode,
      enrollmentId: levelGrants.enrollmentId,
      validFrom: levelGrants.validFrom,
      validUntil: levelGrants.validUntil,
      revokedOn: levelGrants.revokedOn,
      reason: levelGrants.reason,
      revokeReason: levelGrants.revokeReason,
    })
    .from(levelGrants)
    .innerJoin(levels, eq(levels.id, levelGrants.levelId))
    .leftJoin(enrollments, eq(enrollments.id, levelGrants.enrollmentId))
    .leftJoin(
      courseOfferings,
      eq(courseOfferings.id, enrollments.courseOfferingId)
    )
    .where(eq(levelGrants.userId, userId))
    .orderBy(desc(levels.rank), desc(levelGrants.validFrom))
    .all()
  return rows.map((r) => ({ ...r, status: grantStatus(r, day, warnDays) }))
}

function courseOf(db: DB, id: string) {
  const c = db
    .select()
    .from(courseOfferings)
    .where(eq(courseOfferings.id, id))
    .get()
  if (!c) throw notFound("Course")
  return c
}

function levelOf(db: DB, id: string) {
  const l = db.select().from(levels).where(eq(levels.id, id)).get()
  if (!l) throw notFound("Level")
  return l
}

function reviewableEventIds(db: DB): string[] {
  return db
    .select({ id: events.id })
    .from(events)
    .where(inArray(events.state, [...REVIEWABLE]))
    .all()
    .map((r) => r.id)
}

/** Enrols users in a course with a course grant (BR-002-03). Idempotent; returns ids newly enrolled. */
function enrollUsers(
  db: DB,
  courseId: string,
  userIds: readonly string[],
  actorId: string
): string[] {
  const course = courseOf(db, courseId)
  const active = new Set(
    db
      .select({ userId: enrollments.userId })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseOfferingId, courseId),
          eq(enrollments.status, "enrolled")
        )
      )
      .all()
      .map((r) => r.userId)
  )
  const added: string[] = []
  for (const userId of new Set(userIds)) {
    if (active.has(userId)) continue
    const e = db
      .insert(enrollments)
      .values({ courseOfferingId: courseId, userId })
      .returning()
      .get()
    db.insert(levelGrants)
      .values({
        userId,
        levelId: course.levelId,
        source: "course",
        enrollmentId: e.id,
        validFrom: course.startDate,
        validUntil: course.endDate,
        reason: `Enrolled in ${course.courseCode}`,
        grantedBy: actorId,
      })
      .run()
    audit(db, {
      actorId,
      action: "enrollment.create",
      entityType: "enrollment",
      entityId: e.id,
      after: { courseId, userId },
    })
    added.push(userId)
  }
  return added
}

/** Drops an enrollment and revokes its course grant from today (US-002-04). Returns flagged event ids. */
function dropEnrollment(
  db: DB,
  enrollmentId: string,
  actorId: string
): string[] {
  const e = db
    .select()
    .from(enrollments)
    .where(eq(enrollments.id, enrollmentId))
    .get()
  if (!e) throw notFound("Enrollment")
  const day = today()
  db.update(enrollments)
    .set({ status: "dropped", droppedOn: day })
    .where(eq(enrollments.id, e.id))
    .run()
  db.update(levelGrants)
    .set({
      revokedOn: day,
      revokedBy: actorId,
      revokeReason: "Dropped from course",
    })
    .where(
      and(eq(levelGrants.enrollmentId, e.id), isNull(levelGrants.revokedOn))
    )
    .run()
  audit(db, {
    actorId,
    action: "enrollment.drop",
    entityType: "enrollment",
    entityId: e.id,
    before: { status: e.status },
    after: { status: "dropped", droppedOn: day },
  })
  return recheckEvents(db, { requesterId: e.userId })
}

function activeEnrollments(db: DB, courseId: string) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseOfferingId, courseId),
        eq(enrollments.status, "enrolled")
      )
    )
    .all()
}

const isoDate = z.string().refine(isLocalDate, "Use YYYY-MM-DD.")
const levelBody = z.object({
  name: z.string().trim().min(1),
  rank: z.number().int().positive(),
  description: z.string().optional(),
})
const levelPatch = z.object({
  name: z.string().trim().min(1).optional(),
  rank: z.number().int().positive().optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
})
const courseBody = z.object({
  courseCode: z.string().trim().min(1),
  section: z.string().optional(),
  term: z.string().trim().min(1),
  startDate: isoDate,
  endDate: isoDate,
  levelId: z.string(),
})
const coursePatch = courseBody.partial()
const enrollBody = z.object({ userIds: z.array(z.string()).min(1) })
const rosterBody = z.object({ emails: z.array(z.string()).min(1) })
const grantBody = z.object({
  userId: z.string(),
  levelId: z.string(),
  validFrom: isoDate.optional(),
  validUntil: isoDate.nullish(),
  reason: z.string().trim().min(1, "A reason is required."),
})
const reasonBody = z.object({
  reason: z.string().trim().min(1, "A reason is required."),
})

function assertRange(from: string, until: string | null | undefined): void {
  if (until && until < from)
    throw badRequest(
      "INVALID_DATES",
      "The end date must be on or after the start date."
    )
}

export const routes = new Hono<AppEnv>()
  .get("/", (c) => {
    requireUser(c)
    return c.json(
      c.var.db.select().from(levels).orderBy(asc(levels.rank)).all()
    )
  })
  .post("/", v("json", levelBody), (c) => {
    const me = authorize(c, "level.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    if (
      db
        .select({ id: levels.id })
        .from(levels)
        .where(eq(levels.rank, body.rank))
        .get()
    )
      throw conflict("RANK_TAKEN", "Another level already has this rank.")
    const level = db.transaction(() => {
      const row = db
        .insert(levels)
        .values({
          name: body.name,
          rank: body.rank,
          description: body.description ?? "",
        })
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "level.create",
        entityType: "level",
        entityId: row.id,
        after: row,
      })
      return row
    })
    return c.json(level, 201)
  })
  .patch("/:id", v("json", levelPatch), (c) => {
    const me = authorize(c, "level.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = levelOf(db, id)
    const body = c.req.valid("json")
    if (body.rank !== undefined && body.rank !== before.rank) {
      if (
        db
          .select({ id: levels.id })
          .from(levels)
          .where(eq(levels.rank, body.rank))
          .get()
      )
        throw conflict("RANK_TAKEN", "Another level already has this rank.")
    }
    if (body.active === false && before.active) {
      const day = today()
      const activeGrants = db
        .select({ id: levelGrants.id })
        .from(levelGrants)
        .where(
          and(
            eq(levelGrants.levelId, id),
            isNull(levelGrants.revokedOn),
            or(isNull(levelGrants.validUntil), gte(levelGrants.validUntil, day))
          )
        )
        .all().length
      const classes = db
        .select({ id: equipmentClasses.id })
        .from(equipmentClasses)
        .where(eq(equipmentClasses.minLevelId, id))
        .all().length
      const studioCount = db
        .select({ id: studios.id })
        .from(studios)
        .where(eq(studios.minLevelId, id))
        .all().length
      if (activeGrants || classes || studioCount)
        throw conflict(
          "LEVEL_IN_USE",
          "This level is still used by active grants, equipment classes, or studios.",
          {
            activeGrants,
            classes,
            studios: studioCount,
          }
        )
    }
    const flaggedEvents = db.transaction(() => {
      const after = db
        .update(levels)
        .set({
          name: body.name ?? before.name,
          rank: body.rank ?? before.rank,
          description: body.description ?? before.description,
          active: body.active ?? before.active,
        })
        .where(eq(levels.id, id))
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "level.update",
        entityType: "level",
        entityId: id,
        before,
        after,
      })
      // BR-002-01: rank changes re-evaluate every open event.
      return body.rank !== undefined && body.rank !== before.rank
        ? recheckEvents(db, { eventIds: reviewableEventIds(db) })
        : []
    })
    return c.json({ ...levelOf(db, id), flaggedEvents })
  })
  .get("/me", (c) => {
    const me = requireUser(c)
    const db = c.var.db
    const day = today()
    const grants = listGrants(db, me.id)
    const rank = effectiveLevel(grantsFor(db, me.id), day)
    const level =
      rank > 0
        ? db.select().from(levels).where(eq(levels.rank, rank)).get()
        : undefined
    return c.json({
      grants,
      effectiveLevelToday: level
        ? { id: level.id, name: level.name, rank: level.rank }
        : null,
    })
  })
  .get("/courses", (c) => {
    authorize(c, "course.manage")
    const db = c.var.db
    const rows = db
      .select({ course: courseOfferings, level: levels })
      .from(courseOfferings)
      .innerJoin(levels, eq(levels.id, courseOfferings.levelId))
      .orderBy(asc(courseOfferings.courseCode), asc(courseOfferings.section))
      .all()
    // One grouped query for every course's active (enrolled, not dropped) headcount.
    const enrolled = new Map(
      db
        .select({ courseId: enrollments.courseOfferingId, n: count() })
        .from(enrollments)
        .where(eq(enrollments.status, "enrolled"))
        .groupBy(enrollments.courseOfferingId)
        .all()
        .map((r) => [r.courseId, r.n] as const)
    )
    return c.json(
      rows.map((r) => ({
        ...r.course,
        level: { id: r.level.id, name: r.level.name, rank: r.level.rank },
        enrolledCount: enrolled.get(r.course.id) ?? 0,
      }))
    )
  })
  .get("/courses/:id", (c) => {
    authorize(c, "course.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const course = courseOf(db, id)
    const level = levelOf(db, course.levelId)
    const rows = db
      .select({
        id: enrollments.id,
        status: enrollments.status,
        droppedOn: enrollments.droppedOn,
        userId: users.id,
        name: users.displayName,
        email: users.email,
        grantId: levelGrants.id,
      })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .leftJoin(levelGrants, eq(levelGrants.enrollmentId, enrollments.id))
      .where(eq(enrollments.courseOfferingId, id))
      .orderBy(asc(users.displayName))
      .all()
    return c.json({
      ...course,
      level: { id: level.id, name: level.name, rank: level.rank },
      enrollments: rows.map((r) => ({
        id: r.id,
        status: r.status,
        droppedOn: r.droppedOn,
        user: { id: r.userId, displayName: r.name, email: r.email },
        grantId: r.grantId,
      })),
    })
  })
  .post("/courses", v("json", courseBody), (c) => {
    const me = authorize(c, "course.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    assertRange(body.startDate, body.endDate)
    levelOf(db, body.levelId)
    const course = db.transaction(() => {
      const row = db
        .insert(courseOfferings)
        .values({ ...body, section: body.section ?? "" })
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "course.create",
        entityType: "course",
        entityId: row.id,
        after: row,
      })
      return row
    })
    return c.json(course, 201)
  })
  .patch("/courses/:id", v("json", coursePatch), (c) => {
    const me = authorize(c, "course.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const before = courseOf(db, id)
    const body = c.req.valid("json")
    const startDate = body.startDate ?? before.startDate
    const endDate = body.endDate ?? before.endDate
    assertRange(startDate, endDate)
    if (body.levelId) levelOf(db, body.levelId)
    const datesChanged =
      startDate !== before.startDate || endDate !== before.endDate
    const levelChanged =
      body.levelId !== undefined && body.levelId !== before.levelId
    const flaggedEvents = db.transaction(() => {
      const after = db
        .update(courseOfferings)
        .set({
          courseCode: body.courseCode ?? before.courseCode,
          section: body.section ?? before.section,
          term: body.term ?? before.term,
          startDate,
          endDate,
          levelId: body.levelId ?? before.levelId,
        })
        .where(eq(courseOfferings.id, id))
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "course.update",
        entityType: "course",
        entityId: id,
        before,
        after,
      })
      if (!datesChanged && !levelChanged) return 0
      // BR-002-03: course grants follow the course offering.
      const enrolled = db
        .select({ enrollmentId: enrollments.id, userId: enrollments.userId })
        .from(enrollments)
        .where(eq(enrollments.courseOfferingId, id))
        .all()
      if (enrolled.length === 0) return 0
      db.update(levelGrants)
        .set({
          validFrom: startDate,
          validUntil: endDate,
          levelId: after.levelId,
        })
        .where(
          inArray(
            levelGrants.enrollmentId,
            enrolled.map((e) => e.enrollmentId)
          )
        )
        .run()
      let flagged = 0
      for (const userId of new Set(enrolled.map((e) => e.userId)))
        flagged += recheckEvents(db, { requesterId: userId }).length
      return flagged
    })
    return c.json({ ...courseOf(db, id), flaggedEvents })
  })
  .post("/courses/:id/enrollments", v("json", enrollBody), (c) => {
    const me = authorize(c, "course.manage")
    const db = c.var.db
    const id = c.req.param("id")
    courseOf(db, id)
    const { userIds } = c.req.valid("json")
    const known = new Set(
      db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, userIds))
        .all()
        .map((r) => r.id)
    )
    const unknown = userIds.filter((u) => !known.has(u))
    if (unknown.length)
      throw badRequest("UNKNOWN_USER", "Some users do not exist.", {
        userIds: unknown,
      })
    const added = db.transaction(() => enrollUsers(db, id, userIds, me.id))
    return c.json({
      added: added.length,
      unchanged: new Set(userIds).size - added.length,
    })
  })
  .post("/courses/:id/enrollments/:enrollmentId/drop", (c) => {
    const me = authorize(c, "course.manage")
    const db = c.var.db
    const id = c.req.param("id")
    courseOf(db, id)
    const e = db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.id, c.req.param("enrollmentId")),
          eq(enrollments.courseOfferingId, id)
        )
      )
      .get()
    if (!e) throw notFound("Enrollment")
    if (e.status !== "enrolled")
      throw conflict("NOT_ENROLLED", "This enrolment is already dropped.")
    const flagged = db.transaction(() => dropEnrollment(db, e.id, me.id))
    return c.json({ id: e.id, status: "dropped", flaggedEvents: flagged })
  })
  .post("/courses/:id/roster", v("json", rosterBody), (c) => {
    const me = authorize(c, "course.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const course = courseOf(db, id)
    const wanted = [
      ...new Set(
        c.req
          .valid("json")
          .emails.map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      ),
    ]
    // Disabled accounts still match, so a roster that lists them does not drop their enrolment.
    const matched = wanted.length
      ? db
          .select({ id: users.id, email: users.email, status: users.status })
          .from(users)
          .where(inArray(sql`lower(${users.email})`, wanted))
          .all()
      : []
    // A roster matching nobody is a wrong file or a typo, not a request to drop the whole course.
    if (matched.length === 0)
      throw badRequest(
        "ROSTER_NO_MATCH",
        "None of these emails match a user, so nothing was changed."
      )
    const idByEmail = new Map(matched.map((u) => [u.email.toLowerCase(), u.id]))
    const unmatched = wanted.filter((e) => !idByEmail.has(e))
    const wantedIds = new Set(idByEmail.values())
    const activeIds = new Set(
      matched.filter((u) => u.status === "active").map((u) => u.id)
    )

    const result = db.transaction(() => {
      const current = activeEnrollments(db, id)
      const currentIds = new Set(current.map((e) => e.userId))
      const toAdd = [...activeIds].filter((u) => !currentIds.has(u))
      const toDrop = current.filter((e) => !wantedIds.has(e.userId))
      const added = enrollUsers(db, id, toAdd, me.id)
      let flaggedEvents = 0
      for (const e of toDrop)
        flaggedEvents += dropEnrollment(db, e.id, me.id).length
      const summary = {
        added: added.length,
        dropped: toDrop.length,
        unchanged: current.length - toDrop.length,
        unmatched,
        flaggedEvents,
      }
      audit(db, {
        actorId: me.id,
        action: "roster.import",
        entityType: "course",
        entityId: id,
        after: { ...summary, unmatched: unmatched.length },
      })
      notify(db, {
        code: "ROSTER_IMPORT_SUMMARY",
        to: [me.id],
        subject:
          `Roster imported: ${course.courseCode} ${course.section}`.trim(),
        body: `Added ${summary.added}, dropped ${summary.dropped}, unchanged ${summary.unchanged}, unmatched ${summary.unmatched.length}. Events flagged for review: ${flaggedEvents}.`,
        key: `ROSTER_IMPORT:${id}:${randomUUID()}`,
      })
      return summary
    })
    return c.json(result)
  })
  .get(
    "/grants",
    v("query", z.object({ userId: z.string().optional() })),
    (c) => {
      authorize(c, "grant.manage")
      const db = c.var.db
      const userId = c.req.valid("query").userId
      const rows = db
        .select({
          id: levelGrants.id,
          userId: levelGrants.userId,
          name: users.displayName,
          email: users.email,
        })
        .from(levelGrants)
        .innerJoin(users, eq(users.id, levelGrants.userId))
        .where(userId ? eq(levelGrants.userId, userId) : undefined)
        .orderBy(asc(users.displayName))
        .all()
      const byUser = new Map<
        string,
        { id: string; displayName: string; email: string; grants: GrantView[] }
      >()
      for (const r of rows) {
        if (byUser.has(r.userId)) continue
        byUser.set(r.userId, {
          id: r.userId,
          displayName: r.name,
          email: r.email,
          grants: listGrants(db, r.userId),
        })
      }
      return c.json([...byUser.values()])
    }
  )
  .post("/grants", v("json", grantBody), (c) => {
    const me = authorize(c, "grant.manage")
    const db = c.var.db
    const body = c.req.valid("json")
    const validFrom = body.validFrom ?? today()
    const validUntil = body.validUntil ?? null
    assertRange(validFrom, validUntil)
    if (
      !db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, body.userId))
        .get()
    )
      throw notFound("User")
    levelOf(db, body.levelId)
    const row = db.transaction(() => {
      const g = db
        .insert(levelGrants)
        .values({
          userId: body.userId,
          levelId: body.levelId,
          source: "manual",
          validFrom,
          validUntil,
          reason: body.reason,
          grantedBy: me.id,
        })
        .returning()
        .get()
      audit(db, {
        actorId: me.id,
        action: "grant.create",
        entityType: "grant",
        entityId: g.id,
        after: { userId: g.userId, levelId: g.levelId, validFrom, validUntil },
        reason: body.reason,
      })
      return g
    })
    return c.json(row, 201)
  })
  .post("/grants/:id/revoke", v("json", reasonBody), (c) => {
    const me = authorize(c, "grant.manage")
    const db = c.var.db
    const id = c.req.param("id")
    const g = db.select().from(levelGrants).where(eq(levelGrants.id, id)).get()
    if (!g) throw notFound("Grant")
    if (g.revokedOn)
      throw conflict("ALREADY_REVOKED", "This grant is already revoked.")
    const { reason } = c.req.valid("json")
    const flaggedEvents = db.transaction(() => {
      db.update(levelGrants)
        .set({ revokedOn: today(), revokedBy: me.id, revokeReason: reason })
        .where(eq(levelGrants.id, id))
        .run()
      audit(db, {
        actorId: me.id,
        action: "grant.revoke",
        entityType: "grant",
        entityId: id,
        before: { revokedOn: null },
        after: { revokedOn: today() },
        reason,
      })
      return recheckEvents(db, { requesterId: g.userId })
    })
    return c.json({ id, revokedOn: today(), flaggedEvents })
  })
