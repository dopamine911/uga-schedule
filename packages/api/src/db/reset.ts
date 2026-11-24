import { rmSync } from "node:fs"
import { config } from "../config.ts"
import { migrateDb, openDb } from "./client.ts"
import { seed } from "./seed.ts"

if (config.dbUrl.startsWith("file:")) {
  const path = config.dbUrl.slice("file:".length)
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(path + suffix, { force: true })
}
if (!config.blob) rmSync(config.uploadDir, { recursive: true, force: true })

const db = await openDb()
await migrateDb(db)
await seed(db)
console.log(`Seeded ${config.dbUrl}`)
