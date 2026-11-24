import { type EventState, TERMINAL } from "@studio/domain"

// Pure derivations for the home page: which events matter, what needs the user, and count text.
// Row shapes are the structural subset each helper reads; API rows satisfy them.

/** Event row as the dashboard reads it (the events list endpoint, any scope). */
export interface EventSummary {
  id: string
  title: string
  state: EventState
  nextAction: string | null
  needsReview: boolean
  days: readonly {
    day: string
    startTime: string
    endTime: string
    startsAt: string
  }[]
  studio: { name: string }
}

export interface HoldRow {
  id: string
  status: string
  reason: string
  eventTitle?: string | null
}

export interface GrantRow {
  id: string
  status: string
  levelName: string
  validUntil?: string | null
}

export interface NotificationRow {
  id: string
  subject: string
  createdAt: string
  readAt: string | null
}

export interface CheckoutSummary {
  outstanding: readonly { dueAt: string }[]
}

/** A queue query as the desk and dashboard cards read it. */
export interface CountSource {
  data: readonly unknown[] | undefined
  error: unknown
}

export interface DashboardAction {
  id: string
  title: string
  action: string
  /** When the request's first session starts (UTC ISO), or null if it has no days yet. */
  startsAt: string | null
}

/** Next-action text that asks the user to do something (the rest describe waiting on others). */
export function needsUser(nextAction: string | null): nextAction is string {
  return nextAction !== null && !/^(Waiting|Event in progress)/.test(nextAction)
}

/** A queue count for a card: "—" when the query failed, "…" while it loads. */
export function countOf(q: CountSource) {
  return q.error ? "—" : (q.data?.length ?? "…")
}

/** Greeting for the campus-local hour. */
export function greeting(now: number, tz: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: tz,
    }).format(new Date(now))
  )
  return hour < 12
    ? "Good morning"
    : hour < 17
      ? "Good afternoon"
      : "Good evening"
}

/** Sentence naming the access level the user is cleared for today, or "" when none. */
export function clearanceSentence(
  level: { name: string } | null | undefined
): string {
  return level ? `You're cleared for ${level.name}. ` : ""
}

/** Holds that currently block new requests. */
export function activeHoldsOf(
  holds: readonly HoldRow[] | undefined
): HoldRow[] {
  return (holds ?? []).filter((h) => h.status === "active")
}

/** Access grants that are about to run out. */
export function expiringGrantsOf(
  grants: readonly GrantRow[] | undefined
): GrantRow[] {
  return (grants ?? []).filter((g) => g.status === "expiring")
}

/** Checkouts with at least one outstanding item past its due time. */
export function countOverdue(
  checks: readonly { data: CheckoutSummary | undefined }[],
  now: number
): number {
  return checks.filter((c) =>
    (c.data?.outstanding ?? []).some((r) => Date.parse(r.dueAt) < now)
  ).length
}

/** Unread notifications, newest page only. */
export function unreadOf(
  notifications: readonly NotificationRow[] | undefined
): NotificationRow[] {
  return (notifications ?? []).filter((n) => n.readAt === null).slice(0, 5)
}

function startOf(e: EventSummary): string | null {
  return e.days[0]?.startsAt ?? null
}

/**
 * Actions for me: my own requests needing a step, sponsor approvals, and staff decisions,
 * soonest session first (the rows carry no decision deadline, so how soon the session starts is
 * the honest measure of urgency). Requests without days sort last.
 */
export function buildActions(
  mine: readonly EventSummary[] | undefined,
  sponsoring: readonly EventSummary[] | undefined,
  studio: readonly EventSummary[] | undefined
): DashboardAction[] {
  const actions: DashboardAction[] = [
    ...(mine ?? []).flatMap((e) =>
      needsUser(e.nextAction)
        ? [
            {
              id: e.id,
              title: e.title,
              action: e.nextAction,
              startsAt: startOf(e),
            },
          ]
        : []
    ),
    ...(sponsoring ?? [])
      .filter((e) => e.state === "Submitted")
      .map((e) => ({
        id: e.id,
        title: e.title,
        action: "Approve or reject this request",
        startsAt: startOf(e),
      })),
    ...(studio ?? [])
      .filter((e) => e.state === "SponsorApproved" || e.needsReview)
      .map((e) => ({
        id: e.id,
        title: e.title,
        action: e.needsReview
          ? "Review the flagged request"
          : "Confirm or reject this request",
        startsAt: startOf(e),
      })),
  ]
  return actions.sort((a, b) => {
    if (a.startsAt === b.startsAt) return 0
    if (a.startsAt === null) return 1
    if (b.startsAt === null) return -1
    return a.startsAt.localeCompare(b.startsAt)
  })
}

/** Events (mine or sponsored, counted once) whose next step is someone else's. */
export function waitingCountOf(
  mine: readonly EventSummary[] | undefined,
  sponsoring: readonly EventSummary[] | undefined
): number {
  const waiting = [...(mine ?? []), ...(sponsoring ?? [])].filter(
    (e) => e.nextAction !== null && e.nextAction.startsWith("Waiting")
  )
  return new Set(waiting.map((e) => e.id)).size
}

/** One coloured count chip in the dashboard header. Tone follows the colour jobs in index.css. */
export interface AttentionChip {
  tone: "act-now" | "needs-you" | "waiting"
  label: string
  value: number
}

/**
 * Header chips, most urgent first, leaving out zero counts.
 * The dashboard rows carry no deadlines, so urgency comes from the kind of item, not from time left:
 * - Act now (red): late equipment returns and holds that block new requests.
 * - Needs you (amber): decisions or steps waiting on this user, and access that is about to expire.
 * - Waiting on others (blue): the user's or sponsored requests whose next step is someone else's.
 */
export function attentionChips(counts: {
  overdueReturns: number
  activeHolds: number
  actions: number
  expiringGrants: number
  waiting: number
}): AttentionChip[] {
  const chips: AttentionChip[] = [
    {
      tone: "act-now",
      label: "Act now",
      value: counts.overdueReturns + counts.activeHolds,
    },
    {
      tone: "needs-you",
      label: "Needs you",
      value: counts.actions + counts.expiringGrants,
    },
    { tone: "waiting", label: "Waiting on others", value: counts.waiting },
  ]
  return chips.filter((chip) => chip.value > 0)
}

/**
 * Sponsors see the events they sponsor alongside their own; one entry per event, soonest first,
 * next five upcoming (not terminal, starting at or after now).
 */
export function buildUpcoming(
  mine: readonly EventSummary[] | undefined,
  sponsoring: readonly EventSummary[] | undefined,
  now: number
): EventSummary[] {
  return [
    ...new Map(
      [...(mine ?? []), ...(sponsoring ?? [])].map((e) => [e.id, e] as const)
    ).values(),
  ]
    .filter(
      (e) =>
        !TERMINAL.includes(e.state) &&
        e.days[0] &&
        Date.parse(e.days[0].startsAt) >= now
    )
    .sort((a, b) =>
      (a.days[0]?.startsAt ?? "").localeCompare(b.days[0]?.startsAt ?? "")
    )
    .slice(0, 5)
}

/** A query's failure and loading flags, as the cards read them. */
export interface QueryFlags {
  error: unknown
  isPending: boolean
}

/** Actions card is loading while a list it reads is still pending (sponsor and staff lists only when shown). */
export function actionsPending(
  mine: QueryFlags,
  sponsoring: QueryFlags,
  studio: QueryFlags,
  isSponsor: boolean,
  canStaffDecide: boolean
): boolean {
  return (
    mine.isPending ||
    (isSponsor && sponsoring.isPending) ||
    (canStaffDecide && studio.isPending)
  )
}

/** Upcoming card's query state: the first failure, loading while my or sponsored events load. */
export function upcomingState(
  mine: QueryFlags,
  sponsoring: QueryFlags,
  isSponsor: boolean,
  upcoming: EventSummary[]
) {
  return {
    data: upcoming,
    error: mine.error ?? sponsoring.error,
    isPending: mine.isPending || (isSponsor && sponsoring.isPending),
  }
}
