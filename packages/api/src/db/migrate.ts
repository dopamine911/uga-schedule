import { config } from "../config.ts"
import { migrateDb, openDb } from "./client.ts"

// `pnpm db:migrate`: applies pending migrations to TURSO_DATABASE_URL (or the local file). Deployed functions never
// migrate, so run this against Turso before deploying a schema change.
await migrateDb(await openDb())
console.log(`Migrated ${config.dbUrl}`)
