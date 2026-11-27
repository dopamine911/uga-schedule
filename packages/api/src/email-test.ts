import { randomUUID } from "node:crypto"
import { parseArgs } from "node:util"
import { config } from "./config.ts"
import { sendEmail, sender } from "./lib/email.ts"
import { renderInvite } from "./lib/ics.ts"

// `pnpm email:test --to you@example.edu` sends a test calendar invitation through the configured provider, to check
// that Gmail and Outlook add it to the calendar. Rerun with the printed --uid and a higher --seq (and a new --start)
// to check that the same entry moves, or with --cancel to check that it is removed.

const HOUR_MS = 3_600_000

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    uid: { type: "string" },
    seq: { type: "string", default: "0" },
    start: { type: "string" },
    minutes: { type: "string", default: "60" },
    cancel: { type: "boolean", default: false },
    tentative: { type: "boolean", default: false },
  },
})

if (!values.to) {
  console.error(
    "Usage: pnpm email:test --to <address> [--uid <uid> --seq <n>] [--start <ISO>] [--minutes 60] [--tentative] [--cancel]"
  )
  process.exit(1)
}

const uid = values.uid ?? `test-${randomUUID()}@studio-scheduling`
const sequence = Number(values.seq)
// Default: the next whole hour, an hour from now.
const start = new Date(
  values.start ?? Math.ceil((Date.now() + HOUR_MS) / HOUR_MS) * HOUR_MS
)
const end = new Date(start.getTime() + Number(values.minutes) * 60_000)
const method = values.cancel ? "CANCEL" : "REQUEST"

const ics = renderInvite({
  method,
  uid,
  sequence,
  start: start.toISOString(),
  end: end.toISOString(),
  summary: "[Studio A] Test booking",
  location: "Studio A – Podcast Booth",
  description: `Test invitation from Studio Scheduling. ${config.publicBaseUrl}`,
  tentative: values.tentative,
  organizer: sender(),
  attendee: { email: values.to },
})

await sendEmail({
  to: values.to,
  subject: values.cancel
    ? "Cancelled: Test booking"
    : sequence > 0
      ? "Updated: Test booking"
      : "Booked: Test booking",
  text: values.cancel
    ? "This test booking was cancelled."
    : `Test booking, ${start.toISOString()} to ${end.toISOString()}.`,
  invite: { method, ics },
})

console.log(
  `Sent ${method} via ${config.email.provider} to ${values.to}\n  uid ${uid}  seq ${sequence}\n` +
    `Next: --uid ${uid} --seq ${sequence + 1} --start <new ISO>  (update) or add --cancel`
)
