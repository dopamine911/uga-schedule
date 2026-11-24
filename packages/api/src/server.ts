import { serve } from "@hono/node-server"
import { createApp } from "./createApp.ts"
import { config } from "./config.ts"
import { exclusive, migrateDb, openDb } from "./db/client.ts"
import { runJobs } from "./jobs/tick.ts"

if (!config.sessionSecret) {
  console.error(
    "SESSION_SECRET is required. For local development start with DEV_MODE=1 (pnpm dev does)."
  )
  process.exit(1)
}

const db = await openDb()
await migrateDb(db)
const app = createApp(db)

setInterval(() => {
  exclusive(() => runJobs(db)).catch((e) => console.error("[jobs]", e))
}, config.tickMs)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `API listening on http://localhost:${info.port} (tz ${config.tz}, dev ${config.devMode})`
  )
})
