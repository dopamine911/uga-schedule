import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { type ResultSet, createClient } from "@libsql/client"
import { type LibSQLDatabase, drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import { config } from "../config.ts"
import * as schema from "./schema.ts"

/** The root database handle: owns the connection pool and opens transactions. */
export type RootDB = LibSQLDatabase<typeof schema>

/**
 * What queries run against: the root handle or an open transaction. Inside `db.transaction(async (tx) => …)` every
 * query must go through `tx`; a query on another handle runs on another connection and waits for this one's lock.
 */
export type DB = BaseSQLiteDatabase<"async", ResultSet, typeof schema>

/** A database in this process (a file or ":memory:") rather than a Turso server. */
export const isLocalDb = (url: string) => !/^(libsql|https?|wss?):/.test(url)

/** Opens Turso (libsql://…) or a local SQLite file (file:…); ":memory:" gives an empty in-process database. */
export async function openDb(
  url = config.dbUrl,
  authToken = config.dbAuthToken
): Promise<RootDB> {
  const local = isLocalDb(url)
  if (url.startsWith("file:"))
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true })
  const client = createClient({
    url,
    authToken,
    // One connection: SQLite waits for a lock synchronously, blocking the event loop and so the transaction that holds
    // the lock. Callers take turns through `exclusive` instead. `timeout` covers other processes (a DB browser).
    ...(local && { concurrency: 1, timeout: 5_000 }),
  })
  if (url.startsWith("file:")) await client.execute("PRAGMA journal_mode = WAL")
  return drizzle(client, { schema })
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs `fn` once every earlier `exclusive` call in this process has settled. A local database has one connection, and
 * a query on it while a transaction holds it fails (TRANSACTION_ACTIVE), so everything that touches it goes through
 * here; against Turso only writes do, so one instance doesn't queue transactions against itself on the server.
 */
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn)
  queue = run.catch(() => undefined)
  return run
}

/** Applies pending migrations. Run by `pnpm db:migrate`, the local server, db:reset and tests; never per request. */
export async function migrateDb(db: RootDB): Promise<void> {
  await migrate(db, {
    migrationsFolder: resolve(import.meta.dirname, "../../drizzle"),
  })
}

export { schema }
