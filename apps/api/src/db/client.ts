import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import Database from "better-sqlite3"
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { config } from "../config.ts"
import * as schema from "./schema.ts"

export type DB = BetterSQLite3Database<typeof schema>

export function openDb(file = config.dbFile): DB {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") })
  return db
}

export { schema }
