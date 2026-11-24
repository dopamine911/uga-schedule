import {
  type GrantLike,
  REVIEWABLE,
  firstUncoveredDay,
  utcToLocal,
} from "@studio/domain"
import { and, eq, inArray, isNotNull, lt, lte } from "drizzle-orm"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  checkoutRecords,
  equipmentClasses,
  equipmentLines,
  equipmentTypes,
  equipmentUnits,
  events,
  holds,
  levelGrants,
  levels,
  notifications,
  resultPackages,
  stageInstances,
  studios,
} from "../db/schema.ts"
import { now } from "../lib/clock.ts"
import { eventAudience, notify } from "../lib/notify.ts"
import { recheckEvents } from "../services/review.ts"
import { getPolicies } from "../services/policy.ts"
import {
  type EventRow,
  addDaysIso,
  advancePostEvent,
  cancelOpenStages,
  clearHold,
  deletePackageFiles,
  ensurePackage,
  daysOf,
  eventSpan,
  getEvent,
  localLabel,
  moveBulk,
  moveEvent,
  outstandingQty,
  placeHold,
  renderMessage,
  setUnitStatus,
  stageAudience,
} from "../services/lifecycle.ts"

// Background rules (NFR-OPS-01). Every rule is idempotent: it only changes rows that are still in the state it
// selects, and notifications are deduplicated by key. Each returns how many rows it changed.

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const SLA_THRESHOLDS = [50, 90] as const
/** A reminder found this long after it was due is dropped instead of sent late (e.g. after downtime). */
const REMINDER_STALE_MS = HOUR_MS
/** Stages only run for booked events; one sent back for approval or already over is left alone. */
const STAGE_STATES: readonly EventRow["state"][] = ["Confirmed", "InProgress"]

/** Notifies recipients who have not yet received this notification key (notify itself is idempotent per key). */
function notifyOnce(
  db: DB,
  n: {
    code: string
    to: readonly string[]
    eventId: string | null
    subject: string
    body: string
    key: string
  }
): number {
  let sent = 0
  for (const to of new Set(n.to)) {
    const dedupeKey = `${n.key}:${to}`
    if (
      db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.dedupeKey, dedupeKey))
        .get()
    )
      continue
    notify(db, { ...n, to: [to] })
    sent++
  }
  return sent
}

function dayStartOf(db: DB, ev: EventRow): string | null {
  return eventSpan(db, ev.id)?.start ?? null
}

// ── Reminders and tasks (F-005) ──────────────────────────────────────

function sendDueReminders(db: DB, at: string): number {
  const due = db
    .select()
    .from(stageInstances)
    .where(
      and(
        eq(stageInstances.status, "scheduled"),
        eq(stageInstances.kind, "reminder"),
        lte(stageInstances.dueAt, at)
      )
    )
    .all()
  let sent = 0
  const nowMs = Date.parse(at)
  for (const s of due) {
    const ev = getEvent(db, s.eventId)
    if (!ev || !STAGE_STATES.includes(ev.state)) continue
    if (nowMs - Date.parse(s.dueAt) > REMINDER_STALE_MS) {
      db.update(stageInstances)
        .set({ status: "skipped" })
        .where(eq(stageInstances.id, s.id))
        .run()
      continue
    }
    db.update(stageInstances)
      .set({ status: "sent" })
      .where(eq(stageInstances.id, s.id))
      .run()
    notify(db, {
      code: "STAGE_REMINDER",
      to: stageAudience(db, s.eventId, s),
      eventId: s.eventId,
      subject: s.name,
      body: renderMessage(db, ev, s.message),
      key: `STAGE_REMINDER:${s.id}`,
    })
    sent++
  }
  return sent
}

function markOverdueTasks(db: DB, at: string): number {
  const late = db
    .select()
    .from(stageInstances)
    .where(
      and(
        eq(stageInstances.status, "open"),
        eq(stageInstances.kind, "task"),
        lte(stageInstances.dueAt, at)
      )
    )
    .all()
  let marked = 0
  for (const s of late) {
    const ev = getEvent(db, s.eventId)
    if (!ev || !STAGE_STATES.includes(ev.state)) continue
    db.update(stageInstances)
      .set({ status: "overdue" })
      .where(eq(stageInstances.id, s.id))
      .run()
    marked++
    notify(db, {
      code: "TASK_DUE",
      to: stageAudience(db, s.eventId, s),
      eventId: s.eventId,
      subject: `Overdue: ${s.name}`,
      body: renderMessage(db, ev, s.message, s.name),
      key: `TASK_DUE:${s.id}`,
    })
  }
  return marked
}

// ── Decision SLAs and cutoffs (BR-006-07) ────────────────────────────

function expireDecisions(db: DB, at: string): number {
  const p = getPolicies(db)
  const nowMs = Date.parse(at)
  let expired = 0
  for (const ev of db
    .select()
    .from(events)
    .where(inArray(events.state, ["Submitted", "SponsorApproved"]))
    .all()) {
    const start = dayStartOf(db, ev)
    const cutoffPassed =
      start !== null &&
      nowMs >= Date.parse(start) - p.DECISION_CUTOFF_HOURS * HOUR_MS
    const sponsorSlaPassed =
      ev.state === "Submitted" &&
      ev.submittedAt !== null &&
      nowMs - Date.parse(ev.submittedAt) >= p.SPONSOR_SLA_HOURS * HOUR_MS
    const staffSlaPassed =
      ev.state === "SponsorApproved" &&
      ev.sponsorDecidedAt !== null &&
      nowMs - Date.parse(ev.sponsorDecidedAt) >= p.STAFF_SLA_HOURS * HOUR_MS
    if (!cutoffPassed && !sponsorSlaPassed && !staffSlaPassed) continue
    moveEvent(
      db,
      ev,
      "expire",
      null,
      {},
      cutoffPassed ? "decision cutoff passed" : "decision SLA passed"
    )
    notify(db, {
      code: "EVENT_EXPIRED",
      to: eventAudience(db, ev.id, ["requester", "sponsor"]),
      eventId: ev.id,
      subject: `Expired: ${ev.title}`,
      body: cutoffPassed
        ? "The request was not decided before the decision cutoff."
        : "The request was not decided within the decision time limit.",
      key: `EVENT_EXPIRED:${ev.id}`,
    })
    expired++
  }
  return expired
}

function sendDecisionReminders(db: DB, at: string): number {
  const p = getPolicies(db)
  const nowMs = Date.parse(at)
  let sent = 0
  for (const ev of db
    .select()
    .from(events)
    .where(inArray(events.state, ["Submitted", "SponsorApproved"]))
    .all()) {
    const isSponsorStage = ev.state === "Submitted"
    const since = isSponsorStage ? ev.submittedAt : ev.sponsorDecidedAt
    const slaHours = isSponsorStage ? p.SPONSOR_SLA_HOURS : p.STAFF_SLA_HOURS
    if (!since) continue
    const elapsed = nowMs - Date.parse(since)
    for (const pct of SLA_THRESHOLDS) {
      if (elapsed < (slaHours * HOUR_MS * pct) / 100) continue
      sent += notifyOnce(db, {
        code: isSponsorStage ? "SPONSOR_DECISION_DUE" : "STAFF_DECISION_DUE",
        to: eventAudience(
          db,
          ev.id,
          isSponsorStage ? ["sponsor"] : ["studio_staff"]
        ),
        eventId: ev.id,
        subject: `Decision due: ${ev.title}`,
        body: `This request is ${pct}% of the way to its decision deadline.`,
        // Keyed by the clock start so a request sent back for approval is reminded again.
        key: `${isSponsorStage ? "SPONSOR_DECISION_DUE" : "STAFF_DECISION_DUE"}:${ev.id}:${since}:${pct}`,
      })
    }
  }
  return sent
}

// ── Event lifecycle ──────────────────────────────────────────────────

/** BR-006-13: a confirmed event not started by the end of its first day is a no-show. */
function markNoShows(db: DB, at: string): number {
  let count = 0
  for (const ev of db
    .select()
    .from(events)
    .where(eq(events.state, "Confirmed"))
    .all()) {
    const span = eventSpan(db, ev.id)
    if (!span || span.firstEnd > at) continue
    moveEvent(
      db,
      ev,
      "no_show",
      null,
      {},
      "not started by the end of the first day"
    )
    cancelOpenStages(db, ev.id)
    count++
  }
  return count
}

/** Events whose last day has ended move to PostEvent (BR-006-15); their package is created here (F-008). */
function endEvents(db: DB, at: string): number {
  let count = 0
  for (const ev of db
    .select()
    .from(events)
    .where(eq(events.state, "InProgress"))
    .all()) {
    const span = eventSpan(db, ev.id)
    if (!span || span.end > at) continue
    const updated = moveEvent(db, ev, "end", null, {}, "last day ended")
    ensurePackage(db, updated)
    count++
  }
  return count
}

/** PostEvent events whose check-in is complete publish and close when no later step is required (F-008 §3). */
function advanceFinishedEvents(db: DB): number {
  let closed = 0
  for (const ev of db
    .select()
    .from(events)
    .where(eq(events.state, "PostEvent"))
    .all()) {
    advancePostEvent(db, ev.id, null)
    if (getEvent(db, ev.id)?.state === "Closed") closed++
  }
  return closed
}

// ── Equipment (F-007) ────────────────────────────────────────────────

/** Overdue returns: mark late; notify the requester at most once per 24 h (lastOverdueNoticeAt). */
function flagOverdueReturns(db: DB, at: string): number {
  const overdue = db
    .select()
    .from(checkoutRecords)
    .where(lt(checkoutRecords.dueAt, at))
    .all()
    .filter((r) => outstandingQty(r) > 0)
  let notified = 0
  for (const r of overdue) {
    const ev = getEvent(db, r.eventId)
    if (!ev || (ev.state !== "InProgress" && ev.state !== "PostEvent")) continue
    const last = r.lastOverdueNoticeAt
    const due = !last || Date.parse(at) - Date.parse(last) >= DAY_MS
    db.update(checkoutRecords)
      .set({ late: true, ...(due ? { lastOverdueNoticeAt: at } : {}) })
      .where(eq(checkoutRecords.id, r.id))
      .run()
    if (!due) continue
    notify(db, {
      code: "RETURN_OVERDUE",
      to: [ev.requesterId],
      eventId: ev.id,
      subject: `Equipment overdue: ${ev.title}`,
      body: `Please return ${outstandingQty(r)} item(s) now. They were due ${localLabel(r.dueAt)}.`,
      key: `RETURN_OVERDUE:${r.id}:${at.slice(0, 10)}`,
    })
    notified++
  }
  return notified
}

/** BR-003-07: items still out LOST_AFTER_DAYS after their due time are written off and a LOSS hold is placed. */
function writeOffLost(db: DB, at: string): number {
  const cutoff = new Date(
    Date.parse(at) - getPolicies(db).LOST_AFTER_DAYS * DAY_MS
  ).toISOString()
  const stale = db
    .select()
    .from(checkoutRecords)
    .where(lt(checkoutRecords.dueAt, cutoff))
    .all()
    .filter((r) => outstandingQty(r) > 0)
  const touched = new Set<string>()
  for (const r of stale) {
    const ev = getEvent(db, r.eventId)
    if (!ev) continue
    const qty = outstandingQty(r)
    const type = db
      .select()
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, r.equipmentTypeId))
      .get()!
    if (type.tracking === "serialized") {
      const unit = db
        .select()
        .from(equipmentUnits)
        .where(eq(equipmentUnits.id, r.unitId!))
        .get()!
      setUnitStatus(db, unit, "lost", null, ev.id, "not returned: written off")
    } else {
      moveBulk(
        db,
        type.id,
        "qtyInUse",
        "qtyLost",
        qty,
        null,
        ev.id,
        "not returned: written off"
      )
    }
    db.update(checkoutRecords)
      .set({ qtyLost: r.qtyLost + qty })
      .where(eq(checkoutRecords.id, r.id))
      .run()
    placeHold(db, {
      userId: ev.requesterId,
      reason: "LOSS",
      eventId: ev.id,
      source: "system",
      note: `Not returned: ${type.name} ×${qty}.`,
      actorId: null,
    })
    touched.add(ev.id)
  }
  for (const id of touched) advancePostEvent(db, id, null)
  return stale.length
}

/** LATE_RETURN holds clear automatically at their auto_clear_at (BR-007-10). */
function clearExpiredLateHolds(db: DB, at: string): number {
  const due = db
    .select()
    .from(holds)
    .where(
      and(
        eq(holds.reason, "LATE_RETURN"),
        eq(holds.status, "active"),
        isNotNull(holds.autoClearAt),
        lte(holds.autoClearAt, at)
      )
    )
    .all()
  for (const h of due)
    clearHold(
      db,
      h,
      null,
      "Cleared automatically after the late-return period."
    )
  return due.length
}

// ── Grants (BR-002-10) ───────────────────────────────────────────────

interface GrantRow extends GrantLike {
  id: string
  userId: string
  expiryWarnedAt: string | null
}

function allGrants(db: DB): GrantRow[] {
  return db
    .select({
      id: levelGrants.id,
      userId: levelGrants.userId,
      levelRank: levels.rank,
      validFrom: levelGrants.validFrom,
      validUntil: levelGrants.validUntil,
      revokedOn: levelGrants.revokedOn,
      expiryWarnedAt: levelGrants.expiryWarnedAt,
    })
    .from(levelGrants)
    .innerJoin(levels, eq(levels.id, levelGrants.levelId))
    .all()
}

/**
 * Open events of a student that would lose eligibility once `expiring` stops counting: a day after its end that no
 * other grant covers (BR-002-10). Days before the grant ends stay covered by it, so they do not count.
 */
function eventsLosingEligibility(db: DB, expiring: GrantRow): EventRow[] {
  const others = allGrants(db).filter(
    (g) => g.userId === expiring.userId && g.id !== expiring.id
  )
  const end = expiring.validUntil!
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.requesterId, expiring.userId),
        inArray(events.state, [...REVIEWABLE])
      )
    )
    .all()
    .filter((ev) => {
      const after = daysOf(db, ev.id)
        .map((d) => d.day)
        .filter((day) => day > end)
      if (after.length === 0) return false
      const studioRank = db
        .select({ rank: levels.rank })
        .from(studios)
        .innerJoin(levels, eq(levels.id, studios.minLevelId))
        .where(eq(studios.id, ev.studioId))
        .get()
      if (studioRank && firstUncoveredDay(others, after, studioRank.rank))
        return true
      const classRanks = db
        .select({ rank: levels.rank })
        .from(equipmentLines)
        .innerJoin(
          equipmentTypes,
          eq(equipmentTypes.id, equipmentLines.equipmentTypeId)
        )
        .innerJoin(
          equipmentClasses,
          eq(equipmentClasses.id, equipmentTypes.classId)
        )
        .innerJoin(levels, eq(levels.id, equipmentClasses.minLevelId))
        .where(eq(equipmentLines.eventId, ev.id))
        .all()
      return classRanks.some(
        (l) => firstUncoveredDay(others, after, l.rank) !== null
      )
    })
}

function warnExpiringGrants(db: DB, at: string): number {
  const warnDays = getPolicies(db).GRANT_EXPIRY_WARN_DAYS
  const today = utcToLocal(at, config.tz).day
  const horizon = utcToLocal(addDaysIso(at, warnDays), config.tz).day
  let warned = 0
  for (const g of allGrants(db)) {
    if (g.expiryWarnedAt || g.revokedOn || !g.validUntil) continue
    if (g.validUntil < today || g.validUntil > horizon) continue
    const affected = eventsLosingEligibility(db, g)
    if (affected.length === 0) continue
    const to = new Set<string>([g.userId])
    for (const ev of affected) if (ev.sponsorId) to.add(ev.sponsorId)
    notify(db, {
      code: "GRANT_EXPIRING",
      to: [...to],
      eventId: affected[0]!.id,
      subject: "A level grant is about to expire",
      body: `Your access ends on ${g.validUntil}. Affected requests: ${affected.map((e) => e.title).join(", ")}.`,
      key: `GRANT_EXPIRING:${g.id}`,
    })
    db.update(levelGrants)
      .set({ expiryWarnedAt: at })
      .where(eq(levelGrants.id, g.id))
      .run()
    warned++
  }
  return warned
}

/** Users whose grants have already ended are rechecked so their open events get ELIGIBILITY_LOST (BR-002-09). */
function recheckEndedGrants(db: DB, at: string): number {
  const today = utcToLocal(at, config.tz).day
  const users = new Set(
    allGrants(db)
      .filter(
        (g) => !g.revokedOn && g.validUntil !== null && g.validUntil < today
      )
      .map((g) => g.userId)
  )
  let flagged = 0
  for (const userId of users)
    flagged += recheckEvents(db, { requesterId: userId }).length
  return flagged
}

// ── Results retention (BR-008-09) ────────────────────────────────────

function warnResultsExpiring(db: DB, at: string): number {
  const horizon = addDaysIso(at, 30)
  let sent = 0
  for (const pkg of db
    .select()
    .from(resultPackages)
    .where(eq(resultPackages.status, "published"))
    .all()) {
    if (!pkg.retainUntil || pkg.retainUntil > horizon || pkg.retainUntil <= at)
      continue
    const ev = getEvent(db, pkg.eventId)
    if (!ev) continue
    sent += notifyOnce(db, {
      code: "RESULTS_EXPIRING",
      to: eventAudience(db, ev.id, ["requester", "sponsor"]),
      eventId: ev.id,
      subject: `Results expire soon: ${ev.title}`,
      body: `Download your results before ${localLabel(pkg.retainUntil)}.`,
      key: `RESULTS_EXPIRING:${pkg.id}`,
    })
  }
  return sent
}

function expirePublishedResults(db: DB, at: string): number {
  const due = db
    .select()
    .from(resultPackages)
    .where(
      and(
        eq(resultPackages.status, "published"),
        isNotNull(resultPackages.retainUntil),
        lte(resultPackages.retainUntil, at)
      )
    )
    .all()
  for (const pkg of due) {
    db.update(resultPackages)
      .set({ status: "expired" })
      .where(eq(resultPackages.id, pkg.id))
      .run()
    deletePackageFiles(pkg.id)
  }
  return due.length
}

/** Runs every background rule once (NFR-OPS-01). Idempotent; safe to call repeatedly. */
export function runJobs(db: DB): Record<string, number> {
  const at = now()
  return db.transaction(() => {
    const ran: Record<string, number> = {}
    ran.reminders_sent = sendDueReminders(db, at)
    ran.tasks_overdue = markOverdueTasks(db, at)
    ran.events_expired = expireDecisions(db, at)
    ran.decision_reminders = sendDecisionReminders(db, at)
    ran.no_shows = markNoShows(db, at)
    ran.events_post_event = endEvents(db, at)
    ran.overdue_returns = flagOverdueReturns(db, at)
    ran.units_lost = writeOffLost(db, at)
    ran.late_holds_cleared = clearExpiredLateHolds(db, at)
    ran.grants_expiring = warnExpiringGrants(db, at)
    ran.grant_rechecks = recheckEndedGrants(db, at)
    ran.results_expiring = warnResultsExpiring(db, at)
    ran.results_expired = expirePublishedResults(db, at)
    ran.events_closed = advanceFinishedEvents(db)
    return ran
  })
}
