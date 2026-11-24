import { can } from "@studio/domain"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import { config } from "../config.ts"
import type { DB } from "../db/client.ts"
import {
  events,
  resultAccessLog,
  resultItems,
  resultPackages,
} from "../db/schema.ts"
import type { AppEnv, SessionUser } from "../env.ts"
import { requireUser } from "../lib/auth.ts"
import { audit } from "../lib/audit.ts"
import { now } from "../lib/clock.ts"
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts"
import { getPolicies } from "../services/policy.ts"
import { participantIds } from "../services/booking.ts"
import {
  type EventRow,
  type PackageRow,
  checkinComplete,
  getEvent,
  itemsOf,
  packageOf,
  publishPackage,
  typeOf,
} from "../services/lifecycle.ts"
import { v } from "../lib/validate.ts"

// F-008 post-event results. Package viewing follows BR-008-05; uploads follow BR-008-02.

const DAY_MS = 86_400_000
const ALLOWED_MIME = [/^video\//, /^audio\//, /^image\//]
const ALLOWED_EXACT = new Set(["application/pdf", "application/zip", "application/x-zip-compressed"])

const linkBody = z.object({
  kind: z.literal("link"),
  title: z.string().trim().min(1).max(200),
  url: z.string().url(),
})
const signoffBody = z.object({ comment: z.string().default("") })
const publishBody = z.object({ overrideReason: z.string().trim().optional() })

/** Who may view a package (BR-008-05): studio staff, EM, admin; the requester while collecting if allowed to upload. */
function canViewPackage(db: DB, user: SessionUser, ev: EventRow, pkg: PackageRow): boolean {
  if (can(user.roles, "results.view", { studioId: ev.studioId })) return true
  const requester = ev.requesterId === user.id
  if (pkg.status === "collecting") return requester && typeOf(db, ev.eventTypeId).requesterCanUpload
  return requester || ev.sponsorId === user.id || participantIds(db, ev.id).includes(user.id)
}

/** Loads a package the caller may view; 404 otherwise (US-008-02 AC2). */
function visiblePackage(db: DB, user: SessionUser, eventId: string): { ev: EventRow; pkg: PackageRow } {
  const ev = getEvent(db, eventId)
  const pkg = packageOf(db, eventId)
  if (!ev || !pkg || !canViewPackage(db, user, ev, pkg)) throw notFound("Result package")
  return { ev, pkg }
}

function canUpload(db: DB, user: SessionUser, ev: EventRow, pkg: PackageRow): boolean {
  if (pkg.status !== "collecting") return false
  return (
    can(user.roles, "results.upload", { studioId: ev.studioId }) ||
    (ev.requesterId === user.id && typeOf(db, ev.eventTypeId).requesterCanUpload)
  )
}

function daysLeft(retainUntil: string | null): number | null {
  if (!retainUntil) return null
  return Math.max(0, Math.ceil((Date.parse(retainUntil) - Date.parse(now())) / DAY_MS))
}

function itemOut(i: typeof resultItems.$inferSelect) {
  return {
    id: i.id,
    kind: i.kind,
    title: i.title,
    url: i.url,
    mimeType: i.mimeType,
    sizeBytes: i.sizeBytes,
    uploadedBy: i.uploadedBy,
    uploadedAt: i.uploadedAt,
  }
}

export const routes = new Hono<AppEnv>()
  .get("/", (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const rows = db
      .select({ pkg: resultPackages, ev: events })
      .from(resultPackages)
      .innerJoin(events, eq(events.id, resultPackages.eventId))
      .all()
      .filter(({ pkg, ev }) => canViewPackage(db, user, ev, pkg))
      .map(({ pkg, ev }) => ({
        eventId: ev.id,
        title: ev.title,
        status: pkg.status,
        publishedAt: pkg.publishedAt,
        retainUntil: pkg.retainUntil,
        daysLeft: daysLeft(pkg.retainUntil),
        sortAt: pkg.publishedAt ?? pkg.createdAt,
      }))
      .sort((a, b) => b.sortAt.localeCompare(a.sortAt))
      .map(({ sortAt: _sortAt, ...row }) => row)
    return c.json(rows)
  })
  .get("/events/:eventId", (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const { ev, pkg } = visiblePackage(db, user, c.req.param("eventId"))
    const type = typeOf(db, ev.eventTypeId)
    const isSponsor = ev.sponsorId === user.id
    const items = itemsOf(db, pkg.id)
    return c.json({
      eventId: ev.id,
      title: ev.title,
      status: pkg.status,
      publishedAt: pkg.publishedAt,
      retainUntil: pkg.retainUntil,
      daysLeft: daysLeft(pkg.retainUntil),
      requiresResults: type.requiresResults,
      resultsDueAt: pkg.resultsDueAt,
      sponsorSignoff: pkg.sponsorSignoff,
      sponsorComment: pkg.sponsorComment,
      signedOffAt: pkg.signedOffAt,
      checkinReport: pkg.checkinReport ?? null,
      items: items.map(itemOut),
      can: {
        upload: canUpload(db, user, ev, pkg),
        publish:
          pkg.status === "collecting" &&
          ev.state === "PostEvent" &&
          checkinComplete(db, ev.id) &&
          can(user.roles, "results.upload", { studioId: ev.studioId }),
        signoff: pkg.sponsorSignoff === "pending" && isSponsor && type.requiresSponsorSignoff,
      },
    })
  })
  .post("/events/:eventId/items", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const { ev, pkg } = visiblePackage(db, user, c.req.param("eventId"))
    if (!canUpload(db, user, ev, pkg)) {
      if (pkg.status !== "collecting") throw conflict("NOT_COLLECTING", "Results are closed for uploads.")
      throw forbidden()
    }
    const contentType = c.req.header("content-type") ?? ""
    const itemId = crypto.randomUUID()

    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.parseBody()
      const file = form.file
      const title = typeof form.title === "string" ? form.title.trim() : ""
      if (!(file instanceof File)) throw badRequest("FILE_REQUIRED", "Choose a file to upload.")
      if (!title) throw badRequest("TITLE_REQUIRED", "Give the file a title.")
      if (file.size > config.maxUploadBytes) throw badRequest("FILE_TOO_LARGE", "The file is too large.")
      const mime = file.type || "application/octet-stream"
      if (!ALLOWED_MIME.some((re) => re.test(mime)) && !ALLOWED_EXACT.has(mime))
        throw badRequest("FILE_TYPE", "Only video, audio, image, PDF or ZIP files can be uploaded.")
      const storageKey = `${pkg.id}/${itemId}`
      const path = resolve(config.uploadDir, storageKey)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.from(await file.arrayBuffer()))
      const item = db.transaction(() => {
        const row = db
          .insert(resultItems)
          .values({ id: itemId, packageId: pkg.id, kind: "file", title, storageKey, mimeType: mime, sizeBytes: file.size, uploadedBy: user.id })
          .returning()
          .get()
        audit(db, { actorId: user.id, action: "results.item_add", entityType: "result_item", entityId: row.id, after: { title, kind: "file" } })
        return row
      })
      return c.json(itemOut(item), 201)
    }

    const body = linkBody.parse(await c.req.json())
    if (!body.url.startsWith("https://")) throw badRequest("LINK_HTTPS_ONLY", "Links must use https.")
    const item = db.transaction(() => {
      const row = db
        .insert(resultItems)
        .values({ id: itemId, packageId: pkg.id, kind: "link", title: body.title, url: body.url, uploadedBy: user.id })
        .returning()
        .get()
      audit(db, { actorId: user.id, action: "results.item_add", entityType: "result_item", entityId: row.id, after: { title: body.title, kind: "link" } })
      return row
    })
    return c.json(itemOut(item), 201)
  })
  .delete("/items/:id", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const item = db.select().from(resultItems).where(eq(resultItems.id, c.req.param("id"))).get()
    if (!item) throw notFound("Item")
    const { ev, pkg } = visiblePackage(db, user, item.packageId)
    if (pkg.status !== "collecting") throw conflict("NOT_COLLECTING", "Results are closed for changes.")
    const isUploader = item.uploadedBy === user.id && canUpload(db, user, ev, pkg)
    if (!isUploader && !can(user.roles, "results.upload", { studioId: ev.studioId })) throw forbidden()
    db.transaction(() => {
      db.delete(resultItems).where(eq(resultItems.id, item.id)).run()
      audit(db, { actorId: user.id, action: "results.item_remove", entityType: "result_item", entityId: item.id, before: { title: item.title } })
    })
    if (item.storageKey) await rm(resolve(config.uploadDir, item.storageKey), { force: true })
    return c.json({ ok: true as const })
  })
  .post("/events/:eventId/signoff", v("json", signoffBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const { ev, pkg } = visiblePackage(db, user, c.req.param("eventId"))
    if (ev.sponsorId !== user.id) throw forbidden("Only the sponsor can sign off.")
    if (!typeOf(db, ev.eventTypeId).requiresSponsorSignoff) throw conflict("SIGNOFF_NOT_REQUIRED", "This event type has no sponsor sign-off.")
    if (pkg.status !== "collecting") throw conflict("NOT_COLLECTING", "Results are already published.")
    if (pkg.sponsorSignoff !== "pending") throw conflict("ALREADY_SIGNED", "Sign-off is already recorded.")
    db.transaction(() => {
      db.update(resultPackages)
        .set({ sponsorSignoff: "accepted", sponsorComment: body.comment, signedOffAt: now() })
        .where(eq(resultPackages.id, pkg.id))
        .run()
      audit(db, { actorId: user.id, action: "results.signoff", entityType: "result_package", entityId: pkg.id, after: { sponsorSignoff: "accepted" }, reason: body.comment })
    })
    return c.json({ ok: true as const })
  })
  .post("/events/:eventId/publish", v("json", publishBody), (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const { ev, pkg } = visiblePackage(db, user, c.req.param("eventId"))
    if (!can(user.roles, "results.upload", { studioId: ev.studioId })) throw forbidden()
    if (pkg.status !== "collecting") throw conflict("NOT_COLLECTING", "The package is already published.")
    if (ev.state !== "PostEvent") throw conflict("INVALID_STATE", `Publishing is not available while the event is ${ev.state}.`)
    if (!checkinComplete(db, ev.id)) throw conflict("CHECKIN_INCOMPLETE", "Check-in must be complete before publishing.")

    const type = typeOf(db, ev.eventTypeId)
    const reasons: string[] = []
    if (type.requiresResults && itemsOf(db, pkg.id).length === 0) reasons.push("no results uploaded")
    const daysSinceCreated = (Date.parse(now()) - Date.parse(pkg.createdAt)) / DAY_MS
    if (type.requiresSponsorSignoff && pkg.sponsorSignoff === "pending") {
      const after = getPolicies(db).SIGNOFF_PUBLISH_AFTER_DAYS
      if (daysSinceCreated < after)
        throw conflict("SIGNOFF_PENDING", `Sponsor sign-off is pending; publish without it after ${after} days.`)
      reasons.push("sponsor sign-off pending")
    }
    const override = body.overrideReason?.trim() ?? ""
    if (reasons.length && !override)
      throw conflict("OVERRIDE_REASON_REQUIRED", `Give a reason to publish: ${reasons.join(", ")}.`, { reasons })

    db.transaction(() => {
      publishPackage(db, pkg, user.id, override || null)
    })
    const updated = packageOf(db, ev.id)!
    return c.json({ id: updated.id, status: updated.status, publishedAt: updated.publishedAt, retainUntil: updated.retainUntil })
  })
  .get("/items/:id/download", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const item = db.select().from(resultItems).where(eq(resultItems.id, c.req.param("id"))).get()
    if (!item) throw notFound("Item")
    const { pkg } = visiblePackage(db, user, item.packageId)
    if (pkg.status === "expired") throw conflict("EXPIRED", "These files have expired and were removed.")
    if (item.kind === "link") return c.json({ url: item.url })
    if (!item.storageKey) throw notFound("File")
    let bytes: Buffer
    try {
      bytes = await readFile(resolve(config.uploadDir, item.storageKey))
    } catch {
      throw notFound("File")
    }
    db.insert(resultAccessLog).values({ itemId: item.id, userId: user.id }).run()
    const safeName = item.title.replace(/[^\w.\- ]+/g, "_")
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": item.mimeType ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "private, no-store",
    })
  })
