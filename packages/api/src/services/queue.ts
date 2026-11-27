import {
  type EventState,
  type HoldReason,
  type ReviewReason,
  decisionDeadlines,
  localToUtc,
  nextDay,
  utcToLocal,
} from "@studio/domain"
import {
  type SQL,
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  checkoutRecords,
  equipmentLines,
  equipmentTypes,
  events,
  holds,
  levelGrants,
  levels,
  studios,
  users,
} from "../db/schema.ts"
import type { SessionUser } from "../env.ts"
import { now } from "../lib/clock.ts"
import {
  type EventRow,
  type RecordRow,
  addDaysIso,
  checkinComplete,
  daysOf,
  itemsOf,
  outstandingQty,
  packageOf,
  pickupOpensAt,
  recordsOf,
  stagesOf,
  typeOf,
} from "./lifecycle.ts"
import { type Policies, decisionPolicyOf, getPolicies } from "./policy.ts"

// The role-based work queue on the home page: what the signed-in user should act on or is waiting for.

export type QueueSeverity = "critical" | "soon" | "waiting"
/** What `due` means, so the client can word it ("Expires in 3 h", "Pickup in 45 min", "Overdue by 1 h 15 min"). */
export type QueueDueVerb =
  | "expires"
  | "pickup"
  | "due"
  | "ends"
  | "placed"
  | "ended"
  | "starts"
export type QueueKind =
  | "draft"
  | "own-task"
  | "own-pickup"
  | "own-return"
  | "own-results"
  | "own-hold"
  | "own-grant"
  | "waiting"
  | "sponsor-decision"
  | "signoff"
  | "staff-decision"
  | "escalation"
  | "overdue-return"
  | "return-due"
  | "checkout"
  | "publish"
  | "hold"
  | "grant"

export interface QueueAction {
  label: string
  /** An existing web route that does the work, e.g. `/events/<id>/checkin`. */
  href: string
}

export interface QueueItem {
  /** Stable and unique: `<kind>-<id>`. */
  key: string
  kind: QueueKind
  severity: QueueSeverity
  title: string
  /** Short lines under the title, most important first. */
  meta: string[]
  /** ISO instant `dueVerb` refers to; null when there is no time to show. */
  due: string | null
  dueVerb: QueueDueVerb | null
  /** Set when the item is about a booking: the title opens the quick look. */
  eventId: string | null
  action: QueueAction | null
}

export interface Queue {
  items: QueueItem[]
  counts: Record<QueueSeverity, number>
}

/** A deadline closer than this (or past) makes its item critical. */
export const ACT_NOW_WINDOW_MS = 4 * 3_600_000
const PICKUP_SOON_MS = 48 * 3_600_000

const OPEN_STATES: EventState[] = [
  "Draft",
  "Submitted",
  "SponsorApproved",
  "Confirmed",
  "InProgress",
  "PostEvent",
]
const OUT_STATES: EventState[] = ["InProgress", "PostEvent"]

const HOLD_REASON_TEXT: Record<HoldReason, string> = {
  LATE_RETURN: "Late equipment return",
  DAMAGE: "Damaged equipment",
  LOSS: "Lost equipment",
  MANUAL: "Placed by staff",
}
const REVIEW_REASON_TEXT: Record<ReviewReason, string> = {
  ELIGIBILITY_LOST: "eligibility lost",
  EQUIPMENT_SHORTAGE: "equipment shortage",
  STUDIO_BLACKOUT: "studio blackout",
  OUTSIDE_HOURS: "outside opening hours",
  SPONSOR_INACTIVE: "sponsor inactive",
  HOLD_ACTIVE: "account hold",
}

const HONORIFIC = /^(?:(?:Prof|Dr|Mrs|Mr|Ms)\.?\s+)+/i
/** "Prof. Priya Patel" → "Priya" (honorifics are skipped). */
export function firstName(name: string): string {
  return name.trim().replace(HONORIFIC, "").split(/\s+/)[0] || name
}

const dayFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: config.tz,
})
const clockFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: config.tz,
})

/** One booked event with the names its items show. */
interface Booking {
  ev: EventRow
  studio: string
  requester: string
  sponsor: string | null
}

const sponsors = alias(users, "sponsor")

/** Per-request loader: memoises per-event lookups shared by the role builders. */
class Ctx {
  readonly db: DB
  readonly policies: Policies
  readonly nowIso: string
  readonly nowMs: number
  private memo = new Map<string, Promise<unknown>>()

  constructor(db: DB, policies: Policies) {
    this.db = db
    this.policies = policies
    this.nowIso = now()
    this.nowMs = Date.parse(this.nowIso)
  }

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.memo.get(key) as Promise<T> | undefined
    if (!p) {
      p = load()
      this.memo.set(key, p)
    }
    return p
  }

  async bookings(where: SQL | undefined): Promise<Booking[]> {
    const rows = await this.db
      .select({
        ev: events,
        studio: studios.name,
        requester: users.displayName,
        sponsor: sponsors.displayName,
      })
      .from(events)
      .innerJoin(studios, eq(studios.id, events.studioId))
      .innerJoin(users, eq(users.id, events.requesterId))
      .leftJoin(sponsors, eq(sponsors.id, events.sponsorId))
      .where(where)
      .all()
    return rows.map((r) => ({ ...r, studio: r.studio.split(" – ")[0]! }))
  }

  days(id: string) {
    return this.once(`days:${id}`, () => daysOf(this.db, id))
  }
  /**
   * When a booking's equipment goes out: before the pickup window opens, the opening ("Pickup in 2 h"); once it is
   * open, the session start ("Starts in 10 min"), so an open window does not read as a missed pickup.
   */
  async pickupDue(
    ev: EventRow
  ): Promise<{ opensAt: string; due: string; dueVerb: QueueDueVerb } | null> {
    const opensAt = await pickupOpensAt(this.db, ev)
    if (!opensAt) return null
    const start = (await this.days(ev.id))[0]?.startsAt
    if (Date.parse(opensAt) > this.nowMs || !start)
      return { opensAt, due: opensAt, dueVerb: "pickup" }
    return { opensAt, due: start, dueVerb: "starts" }
  }
  pkg(id: string) {
    return this.once(`pkg:${id}`, () => packageOf(this.db, id))
  }
  typeNames(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)].sort()
    if (unique.length === 0) return Promise.resolve([])
    return this.once(`names:${unique.join(",")}`, async () =>
      (
        await this.db
          .select({ name: equipmentTypes.name })
          .from(equipmentTypes)
          .where(inArray(equipmentTypes.id, unique))
          .all()
      ).map((t) => t.name)
    )
  }
  lineNames(id: string): Promise<string[]> {
    return this.once(`lines:${id}`, async () =>
      this.typeNames(
        (
          await this.db
            .select({ typeId: equipmentLines.equipmentTypeId })
            .from(equipmentLines)
            .where(eq(equipmentLines.eventId, id))
            .all()
        ).map((l) => l.typeId)
      )
    )
  }

  severity(deadline: string): QueueSeverity {
    return Date.parse(deadline) - this.nowMs < ACT_NOW_WINDOW_MS
      ? "critical"
      : "soon"
  }

  async decideBy(ev: EventRow): Promise<string | null> {
    const days = await this.days(ev.id)
    return decisionDeadlines(
      ev,
      days[0]?.startsAt ?? null,
      decisionPolicyOf(this.policies)
    ).at
  }

  /** "Tue, Nov 24 · 2:00 PM–5:00 PM", with " (+N days)" for multi-day bookings. */
  async when(id: string): Promise<string> {
    const days = await this.days(id)
    const first = days[0]
    if (!first) return ""
    const extra = days.length - 1
    const more = extra > 0 ? ` (+${extra} ${extra === 1 ? "day" : "days"})` : ""
    return `${dayFmt.format(new Date(first.startsAt))} · ${clockFmt.format(new Date(first.startsAt))}–${clockFmt.format(new Date(first.endsAt))}${more}`
  }

  /** Outstanding equipment: earliest due time, whether any is past it, and the type names. */
  async outstanding(id: string) {
    const out = (await recordsOf(this.db, id)).filter(
      (r: RecordRow) => outstandingQty(r) > 0
    )
    if (out.length === 0) return null
    const dueAt = out.map((r) => r.dueAt).sort()[0]!
    return {
      dueAt,
      overdue: out.some((r) => Date.parse(r.dueAt) < this.nowMs),
      equipment: (await this.typeNames(out.map((r) => r.equipmentTypeId))).join(
        ", "
      ),
    }
  }

  /** Events with equipment still out past its due time (SQL-bounded). */
  overdueWhere(): SQL {
    return and(
      inArray(events.state, OUT_STATES),
      inArray(
        events.id,
        this.db
          .select({ id: checkoutRecords.eventId })
          .from(checkoutRecords)
          .where(
            and(
              lt(checkoutRecords.dueAt, this.nowIso),
              sql`${checkoutRecords.qty} > ${checkoutRecords.qtyOk} + ${checkoutRecords.qtyDamaged} + ${checkoutRecords.qtyLost}`
            )
          )
      )
    )!
  }
}

const viewBooking = (id: string): QueueAction => ({
  label: "View booking",
  href: `/events/${id}`,
})
const review = (id: string): QueueAction => ({
  label: "Review",
  href: `/events/${id}`,
})
const openResults = (id: string): QueueAction => ({
  label: "Open results",
  href: `/results/${id}`,
})

// ── Own items (user is the requester) ─────────────────────────────────

async function ownItems(ctx: Ctx, user: SessionUser): Promise<QueueItem[]> {
  const items: QueueItem[] = []
  const mine = await ctx.bookings(
    and(eq(events.requesterId, user.id), inArray(events.state, OPEN_STATES))
  )
  for (const b of mine) {
    const { ev } = b
    switch (ev.state) {
      case "Draft":
        items.push({
          key: `draft-${ev.id}`,
          kind: "draft",
          severity: "soon",
          title: `Finish and submit “${ev.title}”`,
          meta: [`${b.studio} · ${await ctx.when(ev.id)}`],
          due: null,
          dueVerb: null,
          eventId: ev.id,
          action: { label: "Open request", href: `/events/${ev.id}/edit` },
        })
        break
      case "Submitted":
      case "SponsorApproved": {
        const who =
          ev.state === "Submitted"
            ? (b.sponsor ?? "your sponsor")
            : `${b.studio} staff`
        const due = await ctx.decideBy(ev)
        items.push({
          key: `waiting-${ev.id}`,
          kind: "waiting",
          severity: "waiting",
          title: ev.title,
          meta: [`Waiting on ${who}`, `${b.studio} · ${await ctx.when(ev.id)}`],
          due,
          dueVerb: due ? "expires" : null,
          eventId: ev.id,
          action: null,
        })
        break
      }
      case "Confirmed": {
        const task = (await stagesOf(ctx.db, ev.id)).find(
          (s) =>
            s.kind === "task" &&
            s.assigneeRole === "requester" &&
            (s.status === "open" || s.status === "overdue")
        )
        if (task)
          items.push({
            key: `own-task-${ev.id}`,
            kind: "own-task",
            severity: ctx.severity(task.dueAt),
            title: `Complete: ${task.name}`,
            meta: [`For “${ev.title}” · ${b.studio}`],
            due: task.dueAt,
            dueVerb: "due",
            eventId: ev.id,
            action: { label: "Open request", href: `/events/${ev.id}` },
          })
        const pickup = await ctx.pickupDue(ev)
        if (pickup && Date.parse(pickup.opensAt) - ctx.nowMs < PICKUP_SOON_MS)
          items.push({
            key: `own-pickup-${ev.id}`,
            kind: "own-pickup",
            severity: ctx.severity(pickup.due),
            title: `Pick up equipment for “${ev.title}”`,
            meta: [`Equipment desk, ${b.studio}`],
            due: pickup.due,
            dueVerb: pickup.dueVerb,
            eventId: ev.id,
            action: viewBooking(ev.id),
          })
        break
      }
      case "InProgress":
      case "PostEvent": {
        const out = await ctx.outstanding(ev.id)
        if (out?.overdue)
          items.push({
            key: `own-return-${ev.id}`,
            kind: "own-return",
            severity: "critical",
            title: `Return ${out.equipment}`,
            meta: [
              `From “${ev.title}” · Equipment desk, ${b.studio}`,
              "Late returns can place a hold on your account.",
            ],
            due: out.dueAt,
            dueVerb: "due",
            eventId: ev.id,
            action: viewBooking(ev.id),
          })
        if (ev.state === "PostEvent") {
          const type = await typeOf(ctx.db, ev.eventTypeId)
          const pkg = await ctx.pkg(ev.id)
          if (
            pkg &&
            pkg.status === "collecting" &&
            type.requiresResults &&
            type.requesterCanUpload &&
            (await itemsOf(ctx.db, pkg.id)).length === 0
          )
            items.push({
              key: `own-results-${ev.id}`,
              kind: "own-results",
              severity: "soon",
              title: `Upload results for “${ev.title}”`,
              meta: [b.studio],
              due: pkg.resultsDueAt,
              dueVerb: pkg.resultsDueAt ? "due" : null,
              eventId: ev.id,
              action: openResults(ev.id),
            })
        }
        break
      }
    }
  }

  for (const h of await activeHolds(ctx, eq(holds.userId, user.id)))
    items.push({
      key: `own-hold-${h.id}`,
      kind: "own-hold",
      severity: "critical",
      title: "A hold is pausing new requests",
      meta: [holdText(h), "Your existing bookings are not affected."],
      due: h.createdAt,
      dueVerb: "placed",
      eventId: h.eventId,
      action: null,
    })

  for (const g of await endingGrants(ctx, eq(levelGrants.userId, user.id)))
    items.push({
      key: `own-grant-${g.id}`,
      kind: "own-grant",
      severity: "soon",
      title: `Your ${g.level} access is ending`,
      meta: ["Bookings after this date will need the level renewed."],
      due: g.endsAt,
      dueVerb: "ends",
      eventId: null,
      action: { label: "See my access", href: "/me/access" },
    })
  return items
}

// ── SPONSOR ──────────────────────────────────────────────────────────

async function sponsorItems(ctx: Ctx, user: SessionUser): Promise<QueueItem[]> {
  const items: QueueItem[] = []
  const sponsored = await ctx.bookings(
    and(
      eq(events.sponsorId, user.id),
      inArray(events.state, ["Submitted", "SponsorApproved", "PostEvent"])
    )
  )
  for (const b of sponsored) {
    const { ev } = b
    if (ev.state === "Submitted") {
      const due = await ctx.decideBy(ev)
      items.push({
        key: `sponsor-decision-${ev.id}`,
        kind: "sponsor-decision",
        severity: due ? ctx.severity(due) : "soon",
        title: `${firstName(b.requester)} — ${ev.title}`,
        meta: [b.studio, await ctx.when(ev.id)],
        due,
        dueVerb: due ? "expires" : null,
        eventId: ev.id,
        action: review(ev.id),
      })
    } else if (ev.state === "SponsorApproved") {
      const due = await ctx.decideBy(ev)
      items.push({
        key: `waiting-${ev.id}`,
        kind: "waiting",
        severity: "waiting",
        title: ev.title,
        meta: [
          `Waiting on ${b.studio} staff`,
          `${firstName(b.requester)} · ${await ctx.when(ev.id)}`,
        ],
        due,
        dueVerb: due ? "expires" : null,
        eventId: ev.id,
        action: null,
      })
    } else {
      const pkg = await ctx.pkg(ev.id)
      const type = await typeOf(ctx.db, ev.eventTypeId)
      if (
        pkg?.status === "collecting" &&
        pkg.sponsorSignoff === "pending" &&
        type.requiresSponsorSignoff
      )
        items.push({
          key: `signoff-${ev.id}`,
          kind: "signoff",
          severity: "soon",
          title: `Sign off results — ${ev.title}`,
          meta: [`${firstName(b.requester)} · ${b.studio}`],
          due: null,
          dueVerb: null,
          eventId: ev.id,
          action: openResults(ev.id),
        })
    }
  }
  return items
}

// ── STUDIO_STAFF / shared desk items ─────────────────────────────────

async function overdueItem(
  ctx: Ctx,
  b: Booking,
  canCheckIn: boolean
): Promise<QueueItem | null> {
  const out = await ctx.outstanding(b.ev.id)
  if (!out?.overdue) return null
  return {
    key: `overdue-return-${b.ev.id}`,
    kind: "overdue-return",
    severity: "critical",
    title: `Return overdue: ${out.equipment}`,
    meta: [`${firstName(b.requester)} · “${b.ev.title}” · ${b.studio}`],
    due: out.dueAt,
    dueVerb: "due",
    eventId: b.ev.id,
    action: canCheckIn
      ? { label: "Check in", href: `/events/${b.ev.id}/checkin` }
      : viewBooking(b.ev.id),
  }
}

async function staffDecisionItem(ctx: Ctx, b: Booking): Promise<QueueItem> {
  const { ev } = b
  const due = await ctx.decideBy(ev)
  const meta = [
    b.studio,
    await ctx.when(ev.id),
    `Approved by ${b.sponsor ?? "sponsor"}`,
  ]
  if (ev.needsReview)
    meta.unshift(
      `Needs review: ${ev.reviewReasons.map((r) => REVIEW_REASON_TEXT[r]).join(", ")}`
    )
  return {
    key: `staff-decision-${ev.id}`,
    kind: "staff-decision",
    severity: due ? ctx.severity(due) : "soon",
    title: `${ev.needsReview ? "Review" : "Confirm"} ${firstName(b.requester)} — ${ev.title}`,
    meta,
    due,
    dueVerb: due ? "expires" : null,
    eventId: ev.id,
    action: review(ev.id),
  }
}

async function staffItems(ctx: Ctx, user: SessionUser): Promise<QueueItem[]> {
  const studioIds = [
    ...new Set(
      user.roles
        .filter((r) => r.role === "STUDIO_STAFF" && r.studioId)
        .map((r) => r.studioId!)
    ),
  ]
  if (studioIds.length === 0) return []
  const items: QueueItem[] = []
  const today = utcToLocal(ctx.nowIso, config.tz).day
  const booked = await ctx.bookings(
    and(
      inArray(events.studioId, studioIds),
      inArray(
        events.state,
        OPEN_STATES.filter((s) => s !== "Draft")
      )
    )
  )
  for (const b of booked) {
    const { ev } = b
    const who = firstName(b.requester)
    switch (ev.state) {
      case "InProgress":
      case "PostEvent": {
        const overdue = await overdueItem(ctx, b, true)
        if (overdue) items.push(overdue)
        const out = await ctx.outstanding(ev.id)
        if (
          ev.state === "InProgress" &&
          out &&
          !out.overdue &&
          Date.parse(out.dueAt) - ctx.nowMs < ACT_NOW_WINDOW_MS
        )
          items.push({
            key: `return-due-${ev.id}`,
            kind: "return-due",
            severity: "soon",
            title: `Return expected — ${out.equipment}`,
            meta: [`${who} · “${ev.title}” · ${b.studio}`],
            due: out.dueAt,
            dueVerb: "due",
            eventId: ev.id,
            action: { label: "Check in", href: `/events/${ev.id}/checkin` },
          })
        if (ev.state === "PostEvent") {
          const pkg = await ctx.pkg(ev.id)
          if (
            pkg?.status === "collecting" &&
            (await checkinComplete(ctx.db, ev.id))
          ) {
            const days = await ctx.days(ev.id)
            items.push({
              key: `publish-${ev.id}`,
              kind: "publish",
              severity: "soon",
              title: `Publish results — ${ev.title}`,
              meta: [`${who} · ${b.studio}`, "Equipment is back"],
              due: days.at(-1)?.endsAt ?? null,
              dueVerb: days.length ? "ended" : null,
              eventId: ev.id,
              action: openResults(ev.id),
            })
          }
        }
        break
      }
      case "Confirmed": {
        const pickup = await ctx.pickupDue(ev)
        if (
          pickup &&
          (Date.parse(pickup.opensAt) <= ctx.nowMs ||
            utcToLocal(pickup.opensAt, config.tz).day === today)
        )
          items.push({
            key: `checkout-${ev.id}`,
            kind: "checkout",
            severity: ctx.severity(pickup.due),
            title: `Check out for ${who} — ${ev.title}`,
            meta: [b.studio, (await ctx.lineNames(ev.id)).join(", ")],
            due: pickup.due,
            dueVerb: pickup.dueVerb,
            eventId: ev.id,
            action: { label: "Check out", href: `/events/${ev.id}/checkout` },
          })
        break
      }
      case "SponsorApproved":
        items.push(await staffDecisionItem(ctx, b))
        break
      case "Submitted": {
        const due = await ctx.decideBy(ev)
        items.push({
          key: `waiting-${ev.id}`,
          kind: "waiting",
          severity: "waiting",
          title: `${who} — ${ev.title}`,
          meta: [
            `Waiting on ${b.sponsor ?? "the sponsor"}`,
            `${b.studio} · ${await ctx.when(ev.id)}`,
          ],
          due,
          dueVerb: due ? "expires" : null,
          eventId: ev.id,
          action: null,
        })
        break
      }
    }
  }
  return items
}

// ── EQUIPMENT_MANAGER ────────────────────────────────────────────────

async function allOverdue(ctx: Ctx): Promise<QueueItem[]> {
  const items: QueueItem[] = []
  for (const b of await ctx.bookings(ctx.overdueWhere())) {
    const item = await overdueItem(ctx, b, false)
    if (item) items.push(item)
  }
  return items
}

async function managerItems(ctx: Ctx): Promise<QueueItem[]> {
  const items = await allOverdue(ctx)
  for (const h of await activeHolds(ctx))
    items.push({
      key: `hold-${h.id}`,
      kind: "hold",
      severity: "soon",
      title: `Hold on ${firstName(h.userName)}’s account`,
      meta: [holdText(h), "Blocks new requests"],
      due: h.createdAt,
      dueVerb: "placed",
      eventId: h.eventId,
      action: { label: "Open holds", href: "/holds" },
    })
  for (const g of await endingGrants(ctx))
    items.push({
      key: `grant-${g.id}`,
      kind: "grant",
      severity: "soon",
      title: `${firstName(g.userName)}’s ${g.level} access is ending`,
      meta: ["Bookings after this date will need the level renewed"],
      due: g.endsAt,
      dueVerb: "ends",
      eventId: null,
      action: { label: "Open user", href: `/admin/users/${g.userId}` },
    })
  return items
}

// ── ADMIN ────────────────────────────────────────────────────────────

async function adminItems(ctx: Ctx): Promise<QueueItem[]> {
  const items = await allOverdue(ctx)
  for (const b of await ctx.bookings(
    inArray(events.state, ["Submitted", "SponsorApproved"])
  )) {
    const { ev } = b
    if (ev.state === "SponsorApproved") {
      items.push(await staffDecisionItem(ctx, b))
      continue
    }
    const due = await ctx.decideBy(ev)
    if (!due || Date.parse(due) - ctx.nowMs >= ACT_NOW_WINDOW_MS) continue
    items.push({
      key: `escalation-${ev.id}`,
      kind: "escalation",
      severity: "critical",
      title: `No sponsor decision yet — ${ev.title}`,
      meta: [
        `${firstName(b.requester)} · ${b.studio} · ${await ctx.when(ev.id)}`,
      ],
      due,
      dueVerb: "expires",
      eventId: ev.id,
      action: review(ev.id),
    })
  }
  return items
}

// ── Holds and grants ─────────────────────────────────────────────────

function activeHolds(ctx: Ctx, where?: SQL) {
  return ctx.db
    .select({
      id: holds.id,
      userId: holds.userId,
      userName: users.displayName,
      reason: holds.reason,
      note: holds.note,
      eventId: holds.eventId,
      createdAt: holds.createdAt,
    })
    .from(holds)
    .innerJoin(users, eq(users.id, holds.userId))
    .where(and(eq(holds.status, "active"), where))
    .all()
}

function holdText(h: { reason: HoldReason; note: string }): string {
  const reason = HOLD_REASON_TEXT[h.reason]
  return h.note ? `${reason} — ${h.note}` : reason
}

/** Unrevoked grants whose last valid campus day falls within GRANT_EXPIRY_WARN_DAYS. */
async function endingGrants(ctx: Ctx, where?: SQL) {
  const today = utcToLocal(ctx.nowIso, config.tz).day
  const horizon = utcToLocal(
    addDaysIso(ctx.nowIso, ctx.policies.GRANT_EXPIRY_WARN_DAYS),
    config.tz
  ).day
  const rows = await ctx.db
    .select({
      id: levelGrants.id,
      userId: levelGrants.userId,
      userName: users.displayName,
      level: levels.name,
      validUntil: levelGrants.validUntil,
    })
    .from(levelGrants)
    .innerJoin(users, eq(users.id, levelGrants.userId))
    .innerJoin(levels, eq(levels.id, levelGrants.levelId))
    .where(
      and(
        isNull(levelGrants.revokedOn),
        gte(levelGrants.validUntil, today),
        lte(levelGrants.validUntil, horizon),
        where
      )
    )
    .all()
  // A grant is valid through its last day: it ends at the start of the next campus day.
  return rows.map((g) => ({
    ...g,
    endsAt: localToUtc(nextDay(g.validUntil!), "00:00", config.tz),
  }))
}

// ── Assembly ─────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<QueueSeverity, number> = {
  critical: 0,
  soon: 1,
  waiting: 2,
}

function compareItems(a: QueueItem, b: QueueItem): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (a.due === null ? 1 : 0) - (b.due === null ? 1 : 0) ||
    (a.due !== null && b.due !== null
      ? Date.parse(a.due) - Date.parse(b.due)
      : 0) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  )
}

/** The signed-in user's queue: union over their roles, deduped by key (first wins), sorted, with tier counts. */
export async function buildQueue(db: DB, user: SessionUser): Promise<Queue> {
  const ctx = new Ctx(db, await getPolicies(db))
  const has = (role: string) => user.roles.some((r) => r.role === role)
  const all = [...(await ownItems(ctx, user))]
  if (has("SPONSOR")) all.push(...(await sponsorItems(ctx, user)))
  if (has("STUDIO_STAFF")) all.push(...(await staffItems(ctx, user)))
  if (has("EQUIPMENT_MANAGER")) all.push(...(await managerItems(ctx)))
  if (has("ADMIN")) all.push(...(await adminItems(ctx)))

  const byKey = new Map<string, QueueItem>()
  for (const item of all) if (!byKey.has(item.key)) byKey.set(item.key, item)
  const items = [...byKey.values()].sort(compareItems)
  const counts: Record<QueueSeverity, number> = {
    critical: 0,
    soon: 0,
    waiting: 0,
  }
  for (const item of items) counts[item.severity]++
  return { items, counts }
}
