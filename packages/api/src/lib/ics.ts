// ── ICS formatting (RFC 5545): the calendar feeds and emailed invitations (RFC 5546 iTIP) ───────

/** Text escaping: backslash, semicolon, comma, newline (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
}

/** Folds a content line to 75 octets, never splitting a UTF-8 character (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let current = ""
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > limit) {
      out.push(current)
      current = ""
      bytes = 0
      limit = 74
    }
    current += ch
    bytes += n
  }
  out.push(current)
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join("\r\n")
}

/** UTC ISO instant → 20261128T140000Z. */
export function icsUtc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
}

/** Parameter value (CN=…): quoted, since names can contain ";" "," ":"; double quotes are not allowed inside. */
function param(value: string): string {
  return `"${value.replace(/"/g, "'")}"`
}

export interface InviteInput {
  /** REQUEST creates or updates the entry in the recipient's calendar; CANCEL removes it. */
  method: "REQUEST" | "CANCEL"
  /** Stable per entry: every update and the cancellation must carry the UID of the first invitation. */
  uid: string
  /** Raised on every change; calendars ignore an update whose sequence is not higher than the last one seen. */
  sequence: number
  /** UTC ISO instants. */
  start: string
  end: string
  summary: string
  location?: string
  description?: string
  /** Shown as tentative (e.g. a request still awaiting approval). */
  tentative?: boolean
  /** Must be the sending address: Outlook flags invitations whose organizer differs from the sender. */
  organizer: { email: string; name: string }
  attendee: { email: string; name?: string }
  /** When this message was created (DTSTAMP); defaults to now. */
  stamp?: string
}

/**
 * One-event iTIP invitation for email. It asks for no reply (RSVP=FALSE) and sets no alarms: reminders come from the
 * app's own notifications (F-009 §5), and responses have nowhere to go.
 */
export function renderInvite(i: InviteInput): string {
  const status =
    i.method === "CANCEL"
      ? "CANCELLED"
      : i.tentative
        ? "TENTATIVE"
        : "CONFIRMED"
  const attendeeName = i.attendee.name ? `;CN=${param(i.attendee.name)}` : ""
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//studio-scheduling//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${i.method}`,
    "BEGIN:VEVENT",
    `UID:${i.uid}`,
    `SEQUENCE:${i.sequence}`,
    `DTSTAMP:${icsUtc(i.stamp ?? new Date().toISOString())}`,
    `DTSTART:${icsUtc(i.start)}`,
    `DTEND:${icsUtc(i.end)}`,
    `STATUS:${status}`,
    `SUMMARY:${escapeText(i.summary)}`,
    ...(i.location ? [`LOCATION:${escapeText(i.location)}`] : []),
    ...(i.description ? [`DESCRIPTION:${escapeText(i.description)}`] : []),
    `ORGANIZER;CN=${param(i.organizer.name)}:mailto:${i.organizer.email}`,
    `ATTENDEE${attendeeName};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${i.attendee.email}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  return lines.map(foldLine).join("\r\n") + "\r\n"
}
