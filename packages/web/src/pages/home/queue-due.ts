import { utcToLocal } from "@studio/domain"
import type { InferResponseType } from "hono/client"
import type { api } from "@/lib/api"

/** GET /api/queue, inferred from the route (type-only: this module stays free of runtime imports). */
export type QueueResponse = InferResponseType<typeof api.queue.$get>
export type QueueItem = QueueResponse["items"][number]
export type QueueSeverity = QueueItem["severity"]
export type QueueDueVerb = NonNullable<QueueItem["dueVerb"]>

// Pure wording for queue deadlines: the row's due text and the Next up countdown. Times render in the campus zone.

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** "45 min", "3 h", "3 h 45 min"; "3 days" from two days up. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / MINUTE_MS)
  if (totalMinutes >= 48 * 60)
    return `${Math.round(totalMinutes / (24 * 60))} days`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

/** "Thu, Nov 26" in the campus zone. */
function dayLabel(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(new Date(ms))
}

/** "Thu, Nov 26, 9:00 AM" in the campus zone. */
function dayTimeLabel(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(ms))
}

/** "today", "yesterday", or "Thu, Nov 26" by campus calendar day. */
function relativeDay(ms: number, now: number, tz: string): string {
  const day = utcToLocal(new Date(ms).toISOString(), tz).day
  if (day === utcToLocal(new Date(now).toISOString(), tz).day) return "today"
  if (day === utcToLocal(new Date(now - DAY_MS).toISOString(), tz).day)
    return "yesterday"
  return dayLabel(ms, tz)
}

/** Future word, and the past wording as a prefix and suffix around the elapsed time. */
const COUNTED: Partial<
  Record<QueueDueVerb, { future: string; past: [string, string] }>
> = {
  expires: { future: "Expires", past: ["Expired", " ago"] },
  pickup: { future: "Pickup", past: ["Pickup was", " ago"] },
  starts: { future: "Starts", past: ["Started", " ago"] },
  due: { future: "Due", past: ["Overdue by", ""] },
}

/**
 * The row's due text: "Expires in 3 h 45 min", "Overdue by 1 h 15 min", "Expires Thu, Nov 26, 9:00 AM",
 * "Placed yesterday", "Ended Tue, Nov 24", "Ends Thu, Nov 26". Empty when the item has no time.
 */
export function formatQueueDue(
  item: Pick<QueueItem, "due" | "dueVerb">,
  now: number,
  tz: string
): string {
  if (!item.due || !item.dueVerb) return ""
  const at = Date.parse(item.due)
  const difference = at - now
  switch (item.dueVerb) {
    case "placed":
      return `Placed ${relativeDay(at, now, tz)}`
    case "ended":
      return `Ended ${dayLabel(at, tz)}`
    case "ends":
      return difference < 0
        ? `Ended ${dayLabel(at, tz)}`
        : `Ends ${dayLabel(at, tz)}`
    default: {
      const words = COUNTED[item.dueVerb]!
      if (difference < 0)
        return `${words.past[0]} ${formatDuration(-difference)}${words.past[1]}`
      if (difference < DAY_MS)
        return `${words.future} in ${formatDuration(difference)}`
      return `${words.future} ${dayTimeLabel(at, tz)}`
    }
  }
}

/** Caption under the countdown, before and after the moment passes. */
const COUNTDOWN_CAPTIONS: Partial<
  Record<QueueDueVerb, { future: string; past: string }>
> = {
  expires: { future: "until it expires", past: "since it expired" },
  pickup: { future: "until pickup", past: "since pickup opened" },
  starts: { future: "until it starts", past: "since it started" },
  due: { future: "until it’s due", past: "overdue" },
  ends: { future: "until access ends", past: "since access ended" },
}

const RETURN_KINDS: Partial<Record<QueueItem["kind"], true>> = {
  "own-return": true,
  "overdue-return": true,
  "return-due": true,
}

export type Countdown =
  | { kind: "timer"; value: string; caption: string }
  /** No deadline to count down (a hold, a draft): the panel shows a status glyph and this text instead. */
  | { kind: "glyph"; caption: string }

/** The Next up countdown: time left (or elapsed) and what it counts to. */
export function queueCountdown(
  item: Pick<QueueItem, "due" | "dueVerb" | "kind">,
  now: number,
  tz: string
): Countdown {
  const captions = item.dueVerb ? COUNTDOWN_CAPTIONS[item.dueVerb] : undefined
  if (!item.due || !captions)
    return { kind: "glyph", caption: formatQueueDue(item, now, tz) }
  const difference = Date.parse(item.due) - now
  let caption = difference < 0 ? captions.past : captions.future
  if (item.dueVerb === "due" && difference >= 0 && RETURN_KINDS[item.kind])
    caption = "until it’s due back"
  return { kind: "timer", value: formatDuration(Math.abs(difference)), caption }
}
