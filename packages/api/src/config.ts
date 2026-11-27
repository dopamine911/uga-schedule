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
   * Outgoing email (lib/email.ts). EMAIL_PROVIDER "log" prints instead of sending; "smtp" sends through SMTP_URL, so
   * switching services is a change of URL. RESEND_API_KEY (set by the Vercel Resend integration) is enough on its own:
   * it selects Resend's SMTP server. EMAIL_FROM is "Name <address>" on a domain the service has verified (Resend allows
   * onboarding@resend.dev, to the account's own address only, until one is); invitations use it as the organizer.
   */
  email: (() => {
    const resendKey = process.env.RESEND_API_KEY
    const smtpUrl =
      process.env.SMTP_URL ??
      (resendKey
        ? `smtps://resend:${encodeURIComponent(resendKey)}@smtp.resend.com:465`
        : "")
    return {
      provider: process.env.EMAIL_PROVIDER ?? (smtpUrl ? "smtp" : "log"),
      smtpUrl,
      from: process.env.EMAIL_FROM ?? "Studio Scheduling <no-reply@localhost>",
    }
  })(),
  quietHours: { start: "22:00", end: "07:00" },
}
