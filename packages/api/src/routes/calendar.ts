import { can } from "@studio/domain"
import { and, eq, inArray, isNull } from "drizzle-orm"
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"
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
import type { AppEnv, SessionUser } from "../env.ts"
import { config } from "../config.ts"
import { loadSessionUser, requireUser } from "../lib/auth.ts"
import { now } from "../lib/clock.ts"
import { forbidden, notFound } from "../lib/errors.ts"
import { localLabel, pickupOpensAt, typeOf } from "../services/lifecycle.ts"

// F-009 calendar feeds (ICS only in v0). Feeds are token-authenticated (BR-009-06) and always belong to one
// user: a studio feed is that staff member's view of a studio, so it stops when their account or role does.

const DAY_MS = 86_400_000
/** Events shown in feeds: 30 days back to 180 days ahead (BR-009-06). */
const WINDOW_BACK_DAYS = 30
const WINDOW_AHEAD_DAYS = 180
const FEED_STATES = [
  "Submitted",
  "SponsorApproved",
  "Confirmed",
  "InProgress",
  "PostEvent",
  "Closed",
] as const
const PENDING = ["Submitted", "SponsorApproved"]

type FeedRow = typeof icsFeeds.$inferSelect

/**
 * The URL token is `<feed id>.<HMAC of id and stored nonce>`. The database holds only the nonce, so reading
 * the table does not yield a working feed link (NFR-SEC-02).
 */
function signature(feed: FeedRow): string {
  return createHmac("sha256", config.sessionSecret)
    .update(`ics:${feed.id}:${feed.token}`)
    .digest("base64url")
}

function feedUrl(feed: FeedRow): string {
  return `${config.publicBaseUrl}/ics/${feed.id}.${signature(feed)}.ics`
}

function feedOwner(userId: string, studioId: string | null) {
  return and(
    eq(icsFeeds.userId, userId),
    studioId ? eq(icsFeeds.studioId, studioId) : isNull(icsFeeds.studioId),
    isNull(icsFeeds.revokedAt)
  )
}

async function newFeed(
  db: DB,
  userId: string,
  studioId: string | null
): Promise<FeedRow> {
  return await db
    .insert(icsFeeds)
    .values({ userId, studioId, token: randomBytes(32).toString("base64url") })
    .returning()
    .get()
}

/** The caller's current feed link, created on first use; `rotate` revokes the old link first. */
async function feedFor(
  db: DB,
  userId: string,
  studioId: string | null,
  rotate = false
): Promise<FeedRow> {
  return db.transaction(async (tx) => {
    if (rotate)
      await tx
        .update(icsFeeds)
        .set({ revokedAt: now() })
        .where(feedOwner(userId, studioId))
        .run()
    return (
      (await tx
        .select()
        .from(icsFeeds)
        .where(feedOwner(userId, studioId))
        .get()) ?? (await newFeed(tx, userId, studioId))
    )
  })
}

/** Resolves a URL token to a live feed whose owner may still read it; undefined otherwise. */
async function feedByToken(
  db: DB,
  token: string
): Promise<FeedRow | undefined> {
  const dot = token.indexOf(".")
  if (dot < 0) return undefined
  const feed = await db
    .select()
    .from(icsFeeds)
    .where(
      and(eq(icsFeeds.id, token.slice(0, dot)), isNull(icsFeeds.revokedAt))
    )
    .get()
  if (!feed?.userId) return undefined
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(signature(feed))
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return undefined
  // Disabled accounts and staff who lost the studio lose the feed too (BR-001-09).
  const owner = await loadSessionUser(db, feed.userId)
  if (!owner) return undefined
  if (feed.studioId && !can(owner, "event.view", { studioId: feed.studioId }))
    return undefined
  return feed
}

// ── ICS formatting (RFC 5545) ────────────────────────────────────────

/** Text escaping: backslash, semicolon, comma, newline (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
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
  return new Date(iso)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
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
async function dayRows(db: DB, eventIds: string[]) {
  if (eventIds.length === 0) return []
  const back = new Date(
    Date.parse(now()) - WINDOW_BACK_DAYS * DAY_MS
  ).toISOString()
  const ahead = new Date(
    Date.parse(now()) + WINDOW_AHEAD_DAYS * DAY_MS
  ).toISOString()
  return (
    await db
      .select()
      .from(eventDays)
      .where(inArray(eventDays.eventId, eventIds))
      .all()
  ).filter((d) => d.endsAt >= back && d.startsAt <= ahead)
}

async function personalFeed(db: DB, userId: string): Promise<string> {
  const participantOf = new Set(
    (
      await db
        .select({ eventId: eventParticipants.eventId })
        .from(eventParticipants)
        .where(eq(eventParticipants.userId, userId))
        .all()
    ).map((r) => r.eventId)
  )
  const mine = (
    await db
      .select()
      .from(events)
      .where(inArray(events.state, [...FEED_STATES]))
      .all()
  ).filter(
    (e) =>
      e.requesterId === userId ||
      e.sponsorId === userId ||
      participantOf.has(e.id)
  )
  const visible = mine.filter(
    (e) =>
      !PENDING.includes(e.state) ||
      e.requesterId === userId ||
      e.sponsorId === userId
  )
  return renderCalendarFor(db, visible, { titlesOnly: false })
}

/** A staff member's view of one studio: booked time with titles; pending requests are left out (F-009 §5). */
async function studioFeed(db: DB, studioId: string): Promise<string> {
  const booked = FEED_STATES.filter((s) => !PENDING.includes(s))
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.studioId, studioId), inArray(events.state, booked)))
    .all()
  return renderCalendarFor(db, rows, { titlesOnly: true })
}

async function renderCalendarFor(
  db: DB,
  rows: (typeof events.$inferSelect)[],
  opts: { titlesOnly: boolean }
): Promise<string> {
  const days = await dayRows(
    db,
    rows.map((r) => r.id)
  )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const studioNames = new Map(
    (
      await db
        .select({
          id: studios.id,
          name: studios.name,
          location: studios.location,
        })
        .from(studios)
        .all()
    ).map((s) => [s.id, s])
  )
  const userNames = new Map(
    (
      await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .all()
    ).map((u) => [u.id, u.displayName])
  )
  const items: VEventInput[] = []
  for (const d of days) {
    const ev = byId.get(d.eventId)
    if (!ev) continue
    const pending = PENDING.includes(ev.state)
    const studio = studioNames.get(ev.studioId)
    const title = `${pending ? "[Pending] " : ""}[${studio?.name ?? ""}] ${ev.title}`
    const base: VEventInput = {
      uid: `${d.id}@studio-scheduling`,
      // Last revision, not fetch time, so an unchanged feed keeps its ETag (RFC 5545 §3.8.7.2).
      stamp: icsUtc(ev.updatedAt),
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
    const lines = (
      await db
        .select({ qty: equipmentLines.qty, name: equipmentTypes.name })
        .from(equipmentLines)
        .innerJoin(
          equipmentTypes,
          eq(equipmentTypes.id, equipmentLines.equipmentTypeId)
        )
        .where(eq(equipmentLines.eventId, ev.id))
        .all()
    ).filter((l) => l.qty > 0)
    const pickup = await pickupOpensAt(db, ev)
    const type = await typeOf(db, ev.eventTypeId)
    const description = [
      `Type: ${type.name}`,
      ev.sponsorId ? `Sponsor: ${userNames.get(ev.sponsorId) ?? ""}` : "",
      pickup ? `Pickup opens: ${localLabel(pickup)}` : "",
      lines.length
        ? `Equipment: ${lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}`
        : "",
      `Details: ${config.publicBaseUrl}/events/${ev.id}`,
    ]
      .filter(Boolean)
      .join("\n")
    items.push({ ...base, location: studio?.location, description })
  }
  return renderCalendar(
    opts.titlesOnly ? "Studio bookings" : "Studio bookings",
    items
  )
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex")
}

// ── Routes ───────────────────────────────────────────────────────────

async function requireStudioAccess(
  db: DB,
  user: SessionUser,
  studioId: string
): Promise<void> {
  if (!can(user, "event.view", { studioId })) throw forbidden()
  if (
    !(await db
      .select({ id: studios.id })
      .from(studios)
      .where(eq(studios.id, studioId))
      .get())
  )
    throw notFound("Studio")
}

export const routes = new Hono<AppEnv>()
  .get("/feed", async (c) => {
    const user = requireUser(c)
    return c.json({
      url: feedUrl(await feedFor(c.var.db, user.id, null)),
    })
  })
  .post("/feed/regenerate", async (c) => {
    const user = requireUser(c)
    return c.json({
      url: feedUrl(await feedFor(c.var.db, user.id, null, true)),
    })
  })
  .get("/studio-feed/:studioId", async (c) => {
    const user = requireUser(c)
    const studioId = c.req.param("studioId")
    await requireStudioAccess(c.var.db, user, studioId)
    return c.json({
      url: feedUrl(await feedFor(c.var.db, user.id, studioId)),
    })
  })
  .post("/studio-feed/:studioId/regenerate", async (c) => {
    const user = requireUser(c)
    const studioId = c.req.param("studioId")
    await requireStudioAccess(c.var.db, user, studioId)
    return c.json({
      url: feedUrl(await feedFor(c.var.db, user.id, studioId, true)),
    })
  })

/** /ics — public, token-authenticated ICS feeds (BR-009-06). */
export const icsRoutes = new Hono<AppEnv>().get("/:file", async (c) => {
  const file = c.req.param("file")
  if (!file.endsWith(".ics")) throw notFound("Feed")
  const db = c.var.db
  const feed = await feedByToken(db, file.slice(0, -".ics".length))
  if (!feed) throw notFound("Feed")
  const body = feed.studioId
    ? await studioFeed(db, feed.studioId)
    : await personalFeed(db, feed.userId!)
  const etag = `"${sha1(body)}"`
  const headers = {
    etag,
    "cache-control": "private, no-cache",
    "x-published-ttl": "PT15M",
    "content-type": "text/calendar; charset=utf-8",
  }
  if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers)
  return c.body(body, 200, headers)
})
