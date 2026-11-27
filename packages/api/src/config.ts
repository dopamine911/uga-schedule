import { resolve } from "node:path"

const dataDir = resolve(import.meta.dirname, "../data")

/** Dev login and clock controls. Off unless asked for, so a deployment that sets nothing is closed. */
const devMode = process.env.DEV_MODE === "1"

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Turso (libsql://…) or a local SQLite file (file:…). Names match what the Vercel Turso integration sets. */
  dbUrl:
    process.env.TURSO_DATABASE_URL ?? `file:${resolve(dataDir, "studio.db")}`,
  dbAuthToken: process.env.TURSO_AUTH_TOKEN,
  /** Result files go to Vercel Blob when a store is connected, else to this local directory. */
  blob: Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN),
  uploadDir: process.env.UPLOAD_DIR ?? resolve(dataDir, "uploads"),
  /** Campus time zone (overview §8). */
  tz: process.env.CAMPUS_TZ ?? "America/New_York",
  /** Signs session cookies and calendar feed links. Required outside dev mode (checked at server start). */
  sessionSecret:
    process.env.SESSION_SECRET ?? (devMode ? "dev-only-secret-change-me" : ""),
  /** SSO replaces dev login in production (F-001). */
  devMode,
  /** Background job interval. */
  tickMs: Number(process.env.TICK_MS ?? 30_000),
  termsVersion: "2026-11",
  /** Origin for links in emails and calendar feeds. On Vercel without PUBLIC_BASE_URL, the deployment's own URL. */
  publicBaseUrl:
    process.env.PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5173"),
  maxUploadBytes: 500 * 1024 * 1024,
  /**
   * Outgoing email (lib/email.ts). EMAIL_PROVIDER "log" (default) prints instead of sending; "smtp" sends through
   * SMTP_URL, e.g. smtps://resend:<api key>@smtp.resend.com:465, so switching providers is a change of URL.
   * EMAIL_FROM is "Name <address>" on a domain the provider has verified; invitations use it as the organizer.
   */
  email: {
    provider: process.env.EMAIL_PROVIDER ?? "log",
    smtpUrl: process.env.SMTP_URL ?? "",
    from: process.env.EMAIL_FROM ?? "Studio Scheduling <no-reply@localhost>",
  },
  quietHours: { start: "22:00", end: "07:00" },
}
