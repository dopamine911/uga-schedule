import { type EventState, TERMINAL } from "@studio/domain"

// Pure derivations for the home page sections that are not the work queue (upcoming events, notifications, greeting).
// Row shapes are the structural subset each helper reads; API rows satisfy them.

/** Event row as the dashboard reads it (the events list endpoint, any scope). */
export interface EventSummary {
  id: string
  title: string
  state: EventState
  nextAction: string | null
  days: readonly {
    day: string
    startTime: string
    endTime: string
    startsAt: string
  }[]
  studio: { name: string }
}

export interface NotificationRow {
  id: string
  subject: string
  createdAt: string
  readAt: string | null
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

/** Unread notifications, newest page only. */
export function unreadOf(
  notifications: readonly NotificationRow[] | undefined
): NotificationRow[] {
  return (notifications ?? []).filter((n) => n.readAt === null).slice(0, 5)
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
