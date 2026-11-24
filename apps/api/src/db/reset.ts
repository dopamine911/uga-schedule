import { rmSync } from "node:fs"
import { config } from "../config.ts"
import { openDb } from "./client.ts"
import { seed } from "./seed.ts"

for (const suffix of ["", "-wal", "-shm"]) rmSync(config.dbFile + suffix, { force: true })
rmSync(config.uploadDir, { recursive: true, force: true })
seed(openDb())
console.log(`Seeded ${config.dbFile}`)
