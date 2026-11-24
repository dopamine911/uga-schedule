import { createHmac, timingSafeEqual } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import {
  BlobNotFoundError,
  del,
  head,
  issueSignedToken,
  list,
  presignUrl,
} from "@vercel/blob"
import type { Context } from "hono"
import { Hono } from "hono"
import { config } from "../config.ts"
import { badRequest, conflict, notFound } from "./errors.ts"

// File storage for result uploads. With a Vercel Blob store connected (config.blob) files live in a private store
// and move between the browser and Blob directly, so no file passes through a function (4.5 MB body limit).
// Without one (local dev, tests) they live under config.uploadDir and pass through the API.
// Keys look like "<packageId>/<itemId>/<file name>"; the file name ends the URL a browser downloads from.

export interface UploadRules {
  /** MIME types; "type/*" wildcards allowed. */
  contentTypes: readonly string[]
  maxBytes: number
}

/** Where the browser sends the file: Blob through `upload` from `@vercel/blob/client`, or a PUT to the local URL. */
export type UploadTarget =
  | { storage: "blob" }
  | { storage: "local"; url: string }

const UPLOAD_TTL_MS = 3_600_000
const DOWNLOAD_TTL_MS = 5 * 60_000
/** Mounted under /api; createApp keeps these requests out of the request transaction. */
export const LOCAL_UPLOAD_PATH = "/api/uploads/"

export function matchesContentType(
  type: string,
  allowed: readonly string[]
): boolean {
  return allowed.some((a) =>
    a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : a === type
  )
}

export async function uploadTarget(
  key: string,
  rules: UploadRules
): Promise<UploadTarget> {
  if (config.blob) return { storage: "blob" }
  const token = signLocal({
    key,
    maxBytes: rules.maxBytes,
    exp: Date.now() + UPLOAD_TTL_MS,
  })
  return { storage: "local", url: `${LOCAL_UPLOAD_PATH}${token}` }
}

/**
 * For `handleUpload`'s `onBeforeGenerateToken`: limits for the client token, which Blob enforces on the upload. The
 * token is minted from BLOB_READ_WRITE_TOKEN for exactly the pathname the browser asked for (checked by the caller).
 */
export function blobUploadLimits(rules: UploadRules) {
  return {
    allowedContentTypes: [...rules.contentTypes],
    maximumSizeInBytes: rules.maxBytes,
    validUntil: Date.now() + UPLOAD_TTL_MS,
    addRandomSuffix: false,
    allowOverwrite: false,
  }
}

/** Size and type of a stored file, or null when nothing was uploaded under `key`. Local files report no type. */
export async function statObject(
  key: string
): Promise<{ size: number; contentType: string | null } | null> {
  if (config.blob) {
    try {
      const b = await head(key)
      return { size: b.size, contentType: b.contentType }
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null
      throw e
    }
  }
  try {
    const s = await stat(localPath(key))
    return s.isFile() ? { size: s.size, contentType: null } : null
  } catch {
    return null
  }
}

/** Sends the file: a short-lived signed Blob URL to redirect to, or the local bytes. */
export async function downloadResponse(
  c: Context,
  key: string,
  meta: { contentType: string; fileName: string }
): Promise<Response> {
  if (config.blob) {
    const validUntil = Date.now() + DOWNLOAD_TTL_MS
    const token = await issueSignedToken({
      pathname: key,
      operations: ["get"],
      validUntil,
    })
    const { presignedUrl } = await presignUrl(token, {
      operation: "get",
      pathname: key,
      access: "private",
      validUntil,
    })
    return c.redirect(presignedUrl, 302)
  }
  const path = localPath(key)
  const s = await stat(path).catch(() => null)
  if (!s?.isFile()) throw notFound("File")
  return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream, 200, {
    "content-type": meta.contentType,
    "content-length": String(s.size),
    "content-disposition": `attachment; filename="${meta.fileName}"`,
    "cache-control": "private, no-store",
  })
}

export async function deleteObject(key: string): Promise<void> {
  if (config.blob) await del(key)
  else await rm(localPath(key), { force: true })
}

/** Deletes every file whose key starts with `prefix/`. */
export async function deletePrefix(prefix: string): Promise<void> {
  if (!config.blob) {
    await rm(localPath(prefix), { recursive: true, force: true })
    return
  }
  let cursor: string | undefined
  do {
    const page = await list({ prefix: `${prefix}/`, cursor })
    if (page.blobs.length) await del(page.blobs.map((b) => b.url))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
}

// ── Local storage ────────────────────────────────────────────────────

interface LocalGrant {
  key: string
  maxBytes: number
  exp: number
}

function hmac(data: string): Buffer {
  return createHmac("sha256", config.sessionSecret).update(data).digest()
}

function signLocal(grant: LocalGrant): string {
  const data = Buffer.from(JSON.stringify(grant)).toString("base64url")
  return `${data}.${hmac(data).toString("base64url")}`
}

function verifyLocal(token: string): LocalGrant | null {
  const [data, sig] = token.split(".")
  if (!data || !sig) return null
  const given = Buffer.from(sig, "base64url")
  const want = hmac(data)
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null
  const grant = JSON.parse(
    Buffer.from(data, "base64url").toString()
  ) as LocalGrant
  return grant.exp > Date.now() ? grant : null
}

function localPath(key: string): string {
  const root = resolve(config.uploadDir)
  const path = resolve(root, key)
  if (!path.startsWith(root + sep)) throw badRequest("BAD_KEY", "Bad file key.")
  return path
}

/** PUT /api/uploads/:token — the local stand-in for a presigned Blob upload URL. */
export const localUploadRoutes = new Hono().put("/:token", async (c) => {
  if (config.blob) throw notFound("Upload")
  const grant = verifyLocal(c.req.param("token"))
  if (!grant)
    throw badRequest("UPLOAD_EXPIRED", "The upload link is invalid or expired.")
  const body = c.req.raw.body
  if (!body) throw badRequest("FILE_REQUIRED", "Choose a file to upload.")
  const path = localPath(grant.key)
  await mkdir(dirname(path), { recursive: true })
  let size = 0
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) {
      size += chunk.byteLength
      if (size > grant.maxBytes)
        out.error(badRequest("FILE_TOO_LARGE", "The file is too large."))
      else out.enqueue(chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(body.pipeThrough(limit) as NodeReadableStream),
      createWriteStream(path, { flags: "wx" })
    )
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "EEXIST")
      throw conflict("ALREADY_UPLOADED", "This file was already uploaded.")
    await rm(path, { force: true })
    throw e
  }
  return c.body(null, 204)
})
