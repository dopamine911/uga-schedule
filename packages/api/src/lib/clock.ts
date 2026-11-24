import { eq } from "drizzle-orm"
import type { DB } from "../db/client.ts"
import { devClock } from "../db/schema.ts"

// Single source of "now" so background jobs and demos can be time-travelled (dev only, see routes/dev.ts).
// The offset lives in the database so every function instance agrees; requests load it in dev mode (createApp).
let offsetMs = 0

export function now(): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

export function nowMs(): number {
  return Date.now() + offsetMs
}

export function clockOffsetMs(): number {
  return offsetMs
}

/** Reads the stored offset into this instance. Only dev mode moves the clock, so only dev mode calls this. */
export async function loadClock(db: DB): Promise<void> {
  const row = await db.select().from(devClock).where(eq(devClock.id, 1)).get()
  offsetMs = row?.offsetMs ?? 0
}

async function storeClock(db: DB, ms: number): Promise<void> {
  await db
    .insert(devClock)
    .values({ id: 1, offsetMs: ms })
    .onConflictDoUpdate({ target: devClock.id, set: { offsetMs: ms } })
    .run()
  offsetMs = ms
}

export async function advanceClock(db: DB, ms: number): Promise<void> {
  await loadClock(db)
  await storeClock(db, offsetMs + ms)
}

export async function resetClock(db: DB): Promise<void> {
  await storeClock(db, 0)
}
