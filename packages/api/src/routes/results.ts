import { can } from "@studio/domain"
import {
  type HandleUploadPresignedBody,
  handleUploadPresigned,
} from "@vercel/blob/client"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
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
import {
  type UploadRules,
  blobPutToken,
  deleteObject,
  downloadResponse,
  matchesContentType,
  statObject,
  uploadTarget,
} from "../lib/storage.ts"
import { getPolicies } from "../services/policy.ts"
import { participantIds } from "../services/booking.ts"
import {
  type EventRow,
  type PackageRow,
  checkinComplete,
  getEvent,
  itemsOf,
  localLabel,
  packageOf,
  publishPackage,
  typeOf,
} from "../services/lifecycle.ts"
import { v } from "../lib/validate.ts"

// F-008 post-event results. Package viewing follows BR-008-05; uploads follow BR-008-02.
// A file upload takes three requests: POST …/uploads checks the file and picks its storage key, the browser sends
// the bytes straight to storage (lib/storage.ts), then POST …/items records the item once the file is there.

const DAY_MS = 86_400_000
const UPLOAD_RULES: UploadRules = {
  contentTypes: [
    "video/*",
    "audio/*",
    "image/*",
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
  ],
  maxBytes: config.maxUploadBytes,
}
const FILE_TYPE_MESSAGE =
  "Only video, audio, image, PDF or ZIP files can be uploaded."

const uploadBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1),
  size: z.number().int().nonnegative(),
})
const itemBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("link"),
    title: z.string().trim().min(1).max(200),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("file"),
    title: z.string().trim().min(1).max(200),
    /** The key POST …/uploads returned. */
    key: z.string().min(1),
    /** What the browser declared; local storage keeps no type of its own. */
    contentType: z.string().trim().min(1),
  }),
])
const signoffBody = z.object({ comment: z.string().default("") })
const publishBody = z.object({ overrideReason: z.string().trim().optional() })

/** "<packageId>/<itemId>/<file name>"; the file name ends the download URL, and Blob types the file by its extension. */
function storageKey(packageId: string, itemId: string, fileName: string) {
  const safe =
    fileName
      .replace(/[^\w.-]+/g, "-")
      .replace(/^[-.]+/, "")
      .slice(-120) || "file"
  return `${packageId}/${itemId}/${safe}`
}

/** The item id inside a key of this package, or null when the key is not one POST …/uploads could have issued for it. */
function itemIdOfKey(packageId: string, key: string): string | null {
  const [pkgId, itemId, name, ...rest] = key.split("/")
  if (pkgId !== packageId || !itemId || !name || rest.length) return null
  return z.uuid().safeParse(itemId).success ? itemId : null
}

/** Who may view a package (BR-008-05): studio staff, EM, admin; the requester while collecting if allowed to upload. */
async function canViewPackage(
  db: DB,
  user: SessionUser,
  ev: EventRow,
  pkg: PackageRow
): Promise<boolean> {
  if (can(user, "results.view", { studioId: ev.studioId })) return true
  const requester = ev.requesterId === user.id
  if (pkg.status === "collecting")
    return requester && (await typeOf(db, ev.eventTypeId)).requesterCanUpload
  return (
    requester ||
    ev.sponsorId === user.id ||
    (await participantIds(db, ev.id)).includes(user.id)
  )
}

/** Loads a package the caller may view; 404 otherwise (US-008-02 AC2). */
async function visiblePackage(
  db: DB,
  user: SessionUser,
  eventId: string
): Promise<{ ev: EventRow; pkg: PackageRow }> {
  const ev = await getEvent(db, eventId)
  const pkg = await packageOf(db, eventId)
  if (!ev || !pkg || !(await canViewPackage(db, user, ev, pkg)))
    throw notFound("Result package")
  return { ev, pkg }
}

/** Loads an item with its package and event, for a caller who may view the package; 404 otherwise. */
async function visibleItem(db: DB, user: SessionUser, itemId: string) {
  const item = await db
    .select()
    .from(resultItems)
    .where(eq(resultItems.id, itemId))
    .get()
  const owner =
    item &&
    (await db
      .select({ eventId: resultPackages.eventId })
      .from(resultPackages)
      .where(eq(resultPackages.id, item.packageId))
      .get())
  if (!item || !owner) throw notFound("Item")
  return { item, ...(await visiblePackage(db, user, owner.eventId)) }
}

async function canUpload(
  db: DB,
  user: SessionUser,
  ev: EventRow,
  pkg: PackageRow
): Promise<boolean> {
  if (pkg.status !== "collecting") return false
  return (
    can(user, "results.upload", { studioId: ev.studioId }) ||
    (ev.requesterId === user.id &&
      (await typeOf(db, ev.eventTypeId)).requesterCanUpload)
  )
}

/** The package the caller may add items to; 409 once it stops collecting, 403/404 otherwise. */
async function uploadablePackage(
  db: DB,
  user: SessionUser,
  eventId: string
): Promise<{ ev: EventRow; pkg: PackageRow }> {
  const { ev, pkg } = await visiblePackage(db, user, eventId)
  if (!(await canUpload(db, user, ev, pkg))) {
    if (pkg.status !== "collecting")
      throw conflict("NOT_COLLECTING", "Results are closed for uploads.")
    throw forbidden()
  }
  return { ev, pkg }
}

function daysLeft(retainUntil: string | null): number | null {
  if (!retainUntil) return null
  return Math.max(
    0,
    Math.ceil((Date.parse(retainUntil) - Date.parse(now())) / DAY_MS)
  )
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

/** When a pending sponsor sign-off may be bypassed with a reason (BR-008-06); null when none is pending. */
async function signoffOverrideAt(
  db: DB,
  required: boolean,
  pkg: PackageRow
): Promise<string | null> {
  if (!required || pkg.sponsorSignoff !== "pending") return null
  return new Date(
    Date.parse(pkg.createdAt) +
      (await getPolicies(db)).SIGNOFF_PUBLISH_AFTER_DAYS * DAY_MS
  ).toISOString()
}

export const routes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const visible = []
    for (const row of await db
      .select({ pkg: resultPackages, ev: events })
      .from(resultPackages)
      .innerJoin(events, eq(events.id, resultPackages.eventId))
      .all())
      if (await canViewPackage(db, user, row.ev, row.pkg)) visible.push(row)
    const rows = visible
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
  .get("/events/:eventId", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const { ev, pkg } = await visiblePackage(db, user, c.req.param("eventId"))
    const type = await typeOf(db, ev.eventTypeId)
    const isSponsor = ev.sponsorId === user.id
    const items = await itemsOf(db, pkg.id)
    const overrideAt = await signoffOverrideAt(
      db,
      type.requiresSponsorSignoff,
      pkg
    )
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
      /** While sign-off is pending: when staff may publish without it (BR-008-06). */
      signoffOverrideAt: overrideAt,
      signoffBlocksPublish: overrideAt !== null && now() < overrideAt,
      checkinReport: pkg.checkinReport ?? null,
      items: items.map(itemOut),
      can: {
        upload: await canUpload(db, user, ev, pkg),
        publish:
          pkg.status === "collecting" &&
          ev.state === "PostEvent" &&
          (await checkinComplete(db, ev.id)) &&
          can(user, "results.upload", { studioId: ev.studioId }),
        signoff:
          pkg.sponsorSignoff === "pending" &&
          isSponsor &&
          type.requiresSponsorSignoff,
      },
    })
  })
  /** Step 1 of a file upload: checks the file and returns its storage key and where to send the bytes. */
  .post("/events/:eventId/uploads", v("json", uploadBody), async (c) => {
    const user = requireUser(c)
    const body = c.req.valid("json")
    const { pkg } = await uploadablePackage(
      c.var.db,
      user,
      c.req.param("eventId")
    )
    if (body.size > UPLOAD_RULES.maxBytes)
      throw badRequest("FILE_TOO_LARGE", "The file is too large.")
    if (!matchesContentType(body.contentType, UPLOAD_RULES.contentTypes))
      throw badRequest("FILE_TYPE", FILE_TYPE_MESSAGE)
    const key = storageKey(pkg.id, crypto.randomUUID(), body.fileName)
    return c.json({ key, target: await uploadTarget(key, UPLOAD_RULES) })
  })
  /** Blob only: the `handleUploadUrl` of `uploadPresigned` in the browser; signs a PUT for one issued key. */
  .post("/events/:eventId/uploads/presign", async (c) => {
    if (!config.blob) throw notFound("Upload")
    const user = requireUser(c)
    const { pkg } = await uploadablePackage(
      c.var.db,
      user,
      c.req.param("eventId")
    )
    const result = await handleUploadPresigned({
      body: (await c.req.json()) as HandleUploadPresignedBody,
      request: c.req.raw,
      getSignedToken: async (pathname) => {
        if (!itemIdOfKey(pkg.id, pathname))
          throw badRequest("BAD_KEY", "Bad file key.")
        return blobPutToken(pathname, UPLOAD_RULES)
      },
    })
    return c.json(result)
  })
  .post("/events/:eventId/items", v("json", itemBody), async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const { pkg } = await uploadablePackage(db, user, c.req.param("eventId"))

    if (body.kind === "link") {
      if (!body.url.startsWith("https://"))
        throw badRequest("LINK_HTTPS_ONLY", "Links must use https.")
      const row = await db
        .insert(resultItems)
        .values({
          id: crypto.randomUUID(),
          packageId: pkg.id,
          kind: "link",
          title: body.title,
          url: body.url,
          uploadedBy: user.id,
        })
        .returning()
        .get()
      await audit(db, {
        actorId: user.id,
        action: "results.item_add",
        entityType: "result_item",
        entityId: row.id,
        after: { title: body.title, kind: "link" },
      })
      return c.json(itemOut(row), 201)
    }

    // Step 3 of a file upload: the bytes must already be in storage under a key issued for this package.
    const itemId = itemIdOfKey(pkg.id, body.key)
    if (!itemId) throw badRequest("BAD_KEY", "Bad file key.")
    const stored = await statObject(body.key)
    if (!stored)
      throw badRequest("FILE_REQUIRED", "The file has not been uploaded.")
    const mime = stored.contentType ?? body.contentType
    if (!matchesContentType(mime, UPLOAD_RULES.contentTypes)) {
      await deleteObject(body.key)
      throw badRequest("FILE_TYPE", FILE_TYPE_MESSAGE)
    }
    if (stored.size > UPLOAD_RULES.maxBytes) {
      await deleteObject(body.key)
      throw badRequest("FILE_TOO_LARGE", "The file is too large.")
    }
    if (
      await db
        .select({ id: resultItems.id })
        .from(resultItems)
        .where(eq(resultItems.id, itemId))
        .get()
    )
      throw conflict("ALREADY_ADDED", "This file is already in the package.")
    const row = await db
      .insert(resultItems)
      .values({
        id: itemId,
        packageId: pkg.id,
        kind: "file",
        title: body.title,
        storageKey: body.key,
        mimeType: mime,
        sizeBytes: stored.size,
        uploadedBy: user.id,
      })
      .returning()
      .get()
    await audit(db, {
      actorId: user.id,
      action: "results.item_add",
      entityType: "result_item",
      entityId: row.id,
      after: { title: body.title, kind: "file" },
    })
    return c.json(itemOut(row), 201)
  })
  .delete("/items/:id", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const { item, ev, pkg } = await visibleItem(db, user, c.req.param("id"))
    if (pkg.status !== "collecting")
      throw conflict("NOT_COLLECTING", "Results are closed for changes.")
    const isUploader =
      item.uploadedBy === user.id && (await canUpload(db, user, ev, pkg))
    if (!isUploader && !can(user, "results.upload", { studioId: ev.studioId }))
      throw forbidden()
    // Its download log goes with it; nothing reads the log of an item that no longer exists.
    await db
      .delete(resultAccessLog)
      .where(eq(resultAccessLog.itemId, item.id))
      .run()
    await db.delete(resultItems).where(eq(resultItems.id, item.id)).run()
    await audit(db, {
      actorId: user.id,
      action: "results.item_remove",
      entityType: "result_item",
      entityId: item.id,
      before: { title: item.title },
    })
    if (item.storageKey) await deleteObject(item.storageKey)
    return c.json({ ok: true as const })
  })
  .post("/events/:eventId/signoff", v("json", signoffBody), async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const { ev, pkg } = await visiblePackage(db, user, c.req.param("eventId"))
    if (ev.sponsorId !== user.id)
      throw forbidden("Only the sponsor can sign off.")
    if (!(await typeOf(db, ev.eventTypeId)).requiresSponsorSignoff)
      throw conflict(
        "SIGNOFF_NOT_REQUIRED",
        "This event type has no sponsor sign-off."
      )
    if (pkg.status !== "collecting")
      throw conflict("NOT_COLLECTING", "Results are already published.")
    if (pkg.sponsorSignoff !== "pending")
      throw conflict("ALREADY_SIGNED", "Sign-off is already recorded.")
    await db
      .update(resultPackages)
      .set({
        sponsorSignoff: "accepted",
        sponsorComment: body.comment,
        signedOffAt: now(),
      })
      .where(eq(resultPackages.id, pkg.id))
      .run()
    await audit(db, {
      actorId: user.id,
      action: "results.signoff",
      entityType: "result_package",
      entityId: pkg.id,
      after: { sponsorSignoff: "accepted" },
      reason: body.comment,
    })
    return c.json({ ok: true as const })
  })
  .post("/events/:eventId/publish", v("json", publishBody), async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const body = c.req.valid("json")
    const { ev, pkg } = await visiblePackage(db, user, c.req.param("eventId"))
    if (!can(user, "results.upload", { studioId: ev.studioId }))
      throw forbidden()
    if (pkg.status !== "collecting")
      throw conflict("NOT_COLLECTING", "The package is already published.")
    if (ev.state !== "PostEvent")
      throw conflict(
        "INVALID_STATE",
        `Publishing is not available while the event is ${ev.state}.`
      )
    if (!(await checkinComplete(db, ev.id)))
      throw conflict(
        "CHECKIN_INCOMPLETE",
        "Check-in must be complete before publishing."
      )

    const type = await typeOf(db, ev.eventTypeId)
    const reasons: string[] = []
    if (type.requiresResults && (await itemsOf(db, pkg.id)).length === 0)
      reasons.push("no results uploaded")
    const overrideAt = await signoffOverrideAt(
      db,
      type.requiresSponsorSignoff,
      pkg
    )
    if (overrideAt !== null) {
      if (now() < overrideAt)
        throw conflict(
          "SIGNOFF_PENDING",
          `Sponsor sign-off is pending; publish without it after ${localLabel(overrideAt)}.`
        )
      reasons.push("sponsor sign-off pending")
    }
    const override = body.overrideReason?.trim() ?? ""
    if (reasons.length && !override)
      throw conflict(
        "OVERRIDE_REASON_REQUIRED",
        `Give a reason to publish: ${reasons.join(", ")}.`,
        { reasons }
      )

    await publishPackage(db, pkg, user.id, override || null)
    const updated = (await packageOf(db, ev.id))!
    return c.json({
      id: updated.id,
      status: updated.status,
      publishedAt: updated.publishedAt,
      retainUntil: updated.retainUntil,
    })
  })
  .get("/items/:id/download", async (c) => {
    const user = requireUser(c)
    const db = c.var.db
    const { item, pkg } = await visibleItem(db, user, c.req.param("id"))
    if (pkg.status === "expired")
      throw conflict("EXPIRED", "These files have expired and were removed.")
    if (item.kind === "link") return c.json({ url: item.url })
    if (!item.storageKey) throw notFound("File")
    if (!(await statObject(item.storageKey))) throw notFound("File")
    await db
      .insert(resultAccessLog)
      .values({ itemId: item.id, userId: user.id })
      .run()
    return downloadResponse(c, item.storageKey, {
      contentType: item.mimeType ?? "application/octet-stream",
      fileName: item.storageKey.split("/").pop()!,
    })
  })
