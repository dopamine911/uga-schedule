import { can } from "@studio/domain"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { createHash, randomBytes } from "node:crypto"
import { Hono } from "hono"
import type { DB } from "../db/client.ts"
import {
  equipmentLines,
  equipmentTypes,
  eventDays,
  eventParticipants,
  events,
  icsFeeds,
  studios,
  users,
} from "../db/schema.ts"
import type { AppEnv } from "../env.ts"
import { config } from "../config.ts"
import { requireUser } from "../lib/auth.ts"
import { now } from "../lib/clock.ts"
import { forbidden, notFound } from "../lib/errors.ts"
import { localLabel, pickupOpensAt, typeOf } from "../services/lifecycle.ts"

// F-009 calendar feeds (ICS only in v0). Personal and studio feeds are token-authenticated (BR-009-06).

const DAY_MS = 86_400_000
/** Events shown in feeds: 30 days back to 180 days ahead (BR-009-06). */
const WINDOW_BACK_DAYS = 30
const WINDOW_AHEAD_DAYS = 180
const FEED_STATES = ["Submitted", "SponsorApproved", "Confirmed", "InProgress", "PostEvent", "Closed"] as const
const PENDING = ["Submitted", "SponsorApproved"]

function newToken(): string {
  return randomBytes(24).toString("base64url")
}

function originOf(url: string): string {
  return new URL(url).origin
}

function feedUrl(origin: string, token: string): string {
  return `${origin}/ics/${token}.ics`
}

function activeFeed(db: DB, where: { userId: string } | { studioId: string }) {
  const cond =
    "userId" in where ? and(eq(icsFeeds.userId, where.userId), isNull(icsFeeds.revokedAt)) : and(eq(icsFeeds.studioId, where.studioId), isNull(icsFeeds.revokedAt))
  return db.select().from(icsFeeds).where(cond).get()
}

// ── ICS formatting (RFC 5545) ────────────────────────────────────────

/** Text escaping: backslash, semicolon, comma, newline (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
}

/** Folds a content line to 75 octets, never splitting a UTF-8 character (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let current = ""
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > limit) {
      out.push(current)
      current = ""
      bytes = 0
      limit = 74
    }
    current += ch
    bytes += n
  }
  out.push(current)
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join("\r\n")
}

/** UTC ISO instant → 20261128T140000Z. */
export function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "")
}

interface VEventInput {
  uid: string
  stamp: string
  start: string
  end: string
  sequence: number
  tentative: boolean
  summary: string
  location?: string
  description?: string
}

function renderCalendar(name: string, events: VEventInput[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//studio-scheduling//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ]
  for (const e of events) {
    lines.push("BEGIN:VEVENT")
    lines.push(`UID:${e.uid}`)
    lines.push(`DTSTAMP:${e.stamp}`)
    lines.push(`DTSTART:${e.start}`)
    lines.push(`DTEND:${e.end}`)
    lines.push(`SEQUENCE:${e.sequence}`)
    lines.push(`STATUS:${e.tentative ? "TENTATIVE" : "CONFIRMED"}`)
    lines.push(`SUMMARY:${escapeText(e.summary)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return lines.map(foldLine).join("\r\n") + "\r\n"
}

/** Event days inside the feed window, for the given events. */
function dayRows(db: DB, eventIds: string[]) {
  if (eventIds.length === 0) return []
  const back = new Date(Date.parse(now()) - WINDOW_BACK_DAYS * DAY_MS).toISOString()
  const ahead = new Date(Date.parse(now()) + WINDOW_AHEAD_DAYS * DAY_MS).toISOString()
  return db
    .select()
    .from(eventDays)
    .where(inArray(eventDays.eventId, eventIds))
    .all()
    .filter((d) => d.endsAt >= back && d.startsAt <= ahead)
}

function personalFeed(db: DB, userId: string): string {
  const participantOf = new Set(
    db.select({ eventId: eventParticipants.eventId }).from(eventParticipants).where(eq(eventParticipants.userId, userId)).all().map((r) => r.eventId),
  )
  const mine = db
    .select()
    .from(events)
    .where(inArray(events.state, [...FEED_STATES]))
    .all()
    .filter((e) => e.requesterId === userId || e.sponsorId === userId || participantOf.has(e.id))
  const visible = mine.filter((e) => !PENDING.includes(e.state) || e.requesterId === userId || e.sponsorId === userId)
  return renderCalendarFor(db, visible, { titlesOnly: false })
}

function studioFeed(db: DB, studioId: string): string {
  const rows = db.select().from(events).where(and(eq(events.studioId, studioId), inArray(events.state, [...FEED_STATES]))).all()
  return renderCalendarFor(db, rows, { titlesOnly: true })
}

function renderCalendarFor(
  db: DB,
  rows: (typeof events.$inferSelect)[],
  opts: { titlesOnly: boolean },
): string {
  const stamp = icsUtc(now())
  const days = dayRows(db, rows.map((r) => r.id))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const studioNames = new Map(db.select({ id: studios.id, name: studios.name, location: studios.location }).from(studios).all().map((s) => [s.id, s]))
  const userNames = new Map(db.select({ id: users.id, displayName: users.displayName }).from(users).all().map((u) => [u.id, u.displayName]))
  const items: VEventInput[] = []
  for (const d of days) {
    const ev = byId.get(d.eventId)
    if (!ev) continue
    const pending = PENDING.includes(ev.state)
    const studio = studioNames.get(ev.studioId)
    const title = `${pending ? "[Pending] " : ""}[${studio?.name ?? ""}] ${ev.title}`
    const base: VEventInput = {
      uid: `${d.id}@studio-scheduling`,
      stamp,
      start: icsUtc(d.startsAt),
      end: icsUtc(d.endsAt),
      sequence: ev.sequence,
      tentative: pending,
      summary: title,
    }
    if (opts.titlesOnly) {
      items.push(base)
      continue
    }
    const lines = db
      .select({ qty: equipmentLines.qty, name: equipmentTypes.name })
      .from(equipmentLines)
      .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipmentLines.equipmentTypeId))
      .where(eq(equipmentLines.eventId, ev.id))
      .all()
      .filter((l) => l.qty > 0)
    const pickup = pickupOpensAt(db, ev)
    const type = typeOf(db, ev.eventTypeId)
    const description = [
      `Type: ${type.name}`,
      ev.sponsorId ? `Sponsor: ${userNames.get(ev.sponsorId) ?? ""}` : "",
      pickup ? `Pickup opens: ${localLabel(pickup)}` : "",
      lines.length ? `Equipment: ${lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}` : "",
      `Details: ${config.publicBaseUrl}/events/${ev.id}`,
    ]
      .filter(Boolean)
      .join("\n")
    items.push({ ...base, location: studio?.location, description })
  }
  return renderCalendar(opts.titlesOnly ? "Studio bookings" : "Studio bookings", items)
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex")
}

// ── Routes ───────────────────────────────────────────────────────────

export const routes = new Hono<AppEnv>()
  .get("/feed", (c) => {
    const user = requireUser(c)
    const db = c.var.db
    let feed = activeFeed(db, { userId: user.id })
    if (!feed) feed = db.insert(icsFeeds).values({ userId: user.id, token: newToken() }).returning().get()
    return c.json({ url: feedUrl(originOf(c.req.url), feed.token) })
  })
  .post("/feed/regenerate", (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const feed = db.transaction(() => {
      db.update(icsFeeds).set({ revokedAt: now() }).where(and(eq(icsFeeds.userId, user.id), isNull(icsFeeds.revokedAt))).run()
      return db.insert(icsFeeds).values({ userId: user.id, token: newToken() }).returning().get()
    })
    return c.json({ url: feedUrl(originOf(c.req.url), feed.token) })
  })
  .get("/studio-feed/:studioId", (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const studioId = c.req.param("studioId")
    if (!can(user.roles, "event.view", { studioId })) throw forbidden()
    if (!db.select({ id: studios.id }).from(studios).where(eq(studios.id, studioId)).get()) throw notFound("Studio")
    let feed = activeFeed(db, { studioId })
    if (!feed) feed = db.insert(icsFeeds).values({ studioId, token: newToken() }).returning().get()
    return c.json({ url: feedUrl(originOf(c.req.url), feed.token) })
  })

/** /ics — public, token-authenticated ICS feeds (BR-009-06). */
export const icsRoutes = new Hono<AppEnv>().get("/:file", (c) => {
  const file = c.req.param("file")
  if (!file.endsWith(".ics")) throw notFound("Feed")
  const token = file.slice(0, -".ics".length)
  const db = c.var.db
  const feed = db
    .select()
    .from(icsFeeds)
    .where(and(eq(icsFeeds.token, token), isNull(icsFeeds.revokedAt)))
    .get()
  if (!feed) throw notFound("Feed")
  const body = feed.userId ? personalFeed(db, feed.userId) : studioFeed(db, feed.studioId!)
  const etag = `"${sha1(body)}"`
  const headers = {
    etag,
    "cache-control": "no-cache",
    "x-published-ttl": "PT15M",
    "content-type": "text/calendar; charset=utf-8",
  }
  if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers)
  return c.body(body, 200, headers)
})
