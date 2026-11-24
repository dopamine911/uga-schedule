import { serve } from "@hono/node-server"
import { createApp } from "./app.ts"
import { config } from "./config.ts"
import { openDb } from "./db/client.ts"
import { runJobs } from "./jobs/tick.ts"

const db = openDb()
const app = createApp(db)

setInterval(() => {
  try {
    runJobs(db)
  } catch (e) {
    console.error("[jobs]", e)
  }
}, config.tickMs)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`API listening on http://localhost:${info.port} (tz ${config.tz}, dev ${config.devMode})`)
})
