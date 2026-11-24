import { resolve } from "node:path"

const dataDir = resolve(import.meta.dirname, "../data")

/** Dev login and clock controls. Off unless asked for, so a deployment that sets nothing is closed. */
const devMode = process.env.DEV_MODE === "1"

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** SQLite file; ":memory:" in tests. */
  dbFile: process.env.DB_FILE ?? resolve(dataDir, "studio.db"),
  uploadDir: process.env.UPLOAD_DIR ?? resolve(dataDir, "uploads"),
  /** Campus time zone (overview §8). */
  tz: process.env.CAMPUS_TZ ?? "America/New_York",
  /** Signs session cookies and calendar feed links. Required outside dev mode (checked at server start). */
  sessionSecret: process.env.SESSION_SECRET ?? (devMode ? "dev-only-secret-change-me" : ""),
  /** SSO replaces dev login in production (F-001). */
  devMode,
  /** Background job interval. */
  tickMs: Number(process.env.TICK_MS ?? 30_000),
  termsVersion: "2026-11",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:5173",
  maxUploadBytes: 500 * 1024 * 1024,
  quietHours: { start: "22:00", end: "07:00" },
}
