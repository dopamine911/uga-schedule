// Display helpers. All dates/times render in the campus time zone (BR-010-04).

/** "Tue, Apr 6, 2027" for a "YYYY-MM-DD" calendar date (time-zone independent). */
export function fmtDay(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`))
}

/** "2:00 PM" for an "HH:MM" wall-clock time. */
export function fmtTime(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number)
  const d = new Date(Date.UTC(2000, 0, 1, h, m))
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d)
}

/** "Apr 6, 2:00 PM CDT" for a UTC ISO instant, shown in the campus zone. */
export function fmtInstant(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(iso))
}

/** Event days summary: "Tue, Apr 6, 2027 · 2:00 PM–4:00 PM" or "Apr 10 – Apr 12 (3 days)". */
export function fmtDays(days: readonly { day: string; startTime: string; endTime: string }[]): string {
  if (days.length === 0) return "No days"
  const first = days[0]!
  if (days.length === 1) return `${fmtDay(first.day)} · ${fmtTime(first.startTime)}–${fmtTime(first.endTime)}`
  const last = days[days.length - 1]!
  return `${fmtDay(first.day)} – ${fmtDay(last.day)} (${days.length} days)`
}

/** "in 3 days" / "2 hours ago". */
export function fmtRelative(iso: string, nowMs = Date.now()): string {
  const diff = Date.parse(iso) - nowMs
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" })
  const abs = Math.abs(diff)
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute")
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour")
  return rtf.format(Math.round(diff / 86_400_000), "day")
}

/** Human label for an enum-ish code: "SPONSOR_APPROVED" / "SponsorApproved" → "Sponsor approved". */
export function humanize(code: string): string {
  const s = code
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "Prof. Priya Patel" → "PP". */
export function initials(name: string): string {
  const parts = name.replace(/^Prof\.\s*/, "").split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase()
}
