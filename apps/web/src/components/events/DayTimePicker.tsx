import { minutesOf, timeOf, utcToLocal } from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import { SparklesIcon } from "lucide-react"
import { TimeSelect } from "@/components/TimeSelect"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtDay, fmtTime } from "@/lib/format"
import { cn } from "@/lib/utils"

// Time selection for one event day (F-004 BR-004-01..04): start/end slots on the studio's granularity,
// limited to opening hours, with booked time and blackouts disabled and drawn on a timeline.
// The server's live check stays the authority; this only steers the user to valid choices.

interface Span {
  start: number
  end: number
}

interface BusySpan extends Span {
  /** End of the studio's turnaround buffer after this booking. */
  turnaroundEnd: number
  title?: string
}

export interface DayAvailability {
  open: Span[]
  busy: BusySpan[]
  blackouts: (Span & { reason: string })[]
}

/** Clips an instant range to `day` in campus minutes; null when it doesn't touch the day. */
function clipToDay(
  startIso: string,
  endIso: string,
  day: string,
  tz: string
): Span | null {
  const s = utcToLocal(startIso, tz)
  const e = utcToLocal(endIso, tz)
  if (e.day < day || s.day > day) return null
  const start = s.day < day ? 0 : s.minutes
  const end = e.day > day ? 1440 : e.minutes
  return end > start ? { start, end } : null
}

/** Studio opening hours, bookings and blackouts per day for [from, to], excluding `excludeEventId`. */
export function useStudioAvailability(
  studioId: string,
  from: string,
  to: string,
  excludeEventId?: string
) {
  const tz = useTz()
  return useQuery({
    queryKey: ["studios", studioId, "schedule", from, to],
    queryFn: () =>
      unwrap(
        api.studios[":id"].schedule.$get({
          param: { id: studioId },
          query: { from, to },
        })
      ),
    enabled: !!studioId && !!from && !!to,
    select: (s) => {
      const byDay = new Map<string, DayAvailability>()
      for (const d of s.days) {
        const busy: BusySpan[] = []
        for (const b of s.busy) {
          if ("eventId" in b && b.eventId === excludeEventId) continue
          const span = clipToDay(b.start, b.end, d.day, tz)
          if (!span) continue
          const ta = clipToDay(b.start, b.turnaroundEnd, d.day, tz)
          busy.push({
            ...span,
            turnaroundEnd: ta?.end ?? span.end,
            title: "title" in b ? b.title : undefined,
          })
        }
        const blackouts = s.blackouts.flatMap((b) => {
          const span = clipToDay(b.start, b.end, d.day, tz)
          return span ? [{ ...span, reason: b.reason }] : []
        })
        byDay.set(d.day, {
          open: d.open.map((o) => ({
            start: minutesOf(o.opens),
            end: minutesOf(o.closes),
          })),
          busy,
          blackouts,
        })
      }
      return byDay
    },
  })
}

export function DayTimePicker({
  day,
  index,
  startTime,
  endTime,
  onChange,
  step,
  turnaround,
  maxHours,
  availability,
}: {
  /** Calendar date, or undefined before one is chosen (times can be picked first). */
  day: string | undefined
  index: number
  startTime: string
  endTime: string
  onChange: (times: { startTime: string; endTime: string }) => void
  step: number
  turnaround: number
  maxHours: number
  availability: DayAvailability | undefined
}) {
  // Until a studio and date are chosen, offer a generic day so times can be picked first.
  const known = availability !== undefined
  const open = availability?.open ?? GENERIC_OPEN
  const busy = availability?.busy ?? []
  const blackouts = availability?.blackouts ?? []
  const start = startTime ? minutesOf(startTime) : null
  const end = endTime ? minutesOf(endTime) : null
  const closed = known && open.length === 0

  // A start slot is free when [t, t+step) is inside opening hours and clear of bookings (incl. their
  // turnaround), blackouts, and leaves our own turnaround before the next booking.
  const windowOf = (t: number) => open.find((o) => o.start <= t && t < o.end)
  const blocked = (a: number, b: number) =>
    busy.some((x) => a < x.turnaroundEnd && x.start < b + turnaround) ||
    blackouts.some((x) => a < x.end && x.start < b)
  const startReason = (time: string): string | null => {
    const t = minutesOf(time)
    if (!windowOf(t) || t + step > (windowOf(t)?.end ?? 0)) return "closed"
    if (blackouts.some((x) => t < x.end && x.start < t + step)) return "closed"
    if (
      busy.some((x) => t < x.turnaroundEnd && x.start < t + step + turnaround)
    )
      return "booked"
    return null
  }
  /** Latest end for a start: window close, next booking minus our turnaround, max hours. */
  const latestEnd = (s: number) => {
    const w = windowOf(s)
    if (!w) return s
    let limit = Math.min(w.end, s + maxHours * 60)
    for (const x of busy)
      if (x.start >= s) limit = Math.min(limit, x.start - turnaround)
    for (const x of blackouts)
      if (x.start >= s) limit = Math.min(limit, x.start)
    return limit
  }
  const endReason = (time: string): string | null => {
    const t = minutesOf(time)
    if (start === null || t <= start) return "before start"
    if (t > latestEnd(start))
      return t - start > maxHours * 60 ? `over ${maxHours} h` : "unavailable"
    return null
  }

  const dayMin = open.length ? Math.min(...open.map((o) => o.start)) : 8 * 60
  const dayMax = open.length ? Math.max(...open.map((o) => o.end)) : 22 * 60
  const durations = [60, 120, 180, 240, 360, 480].filter(
    (d) => d <= maxHours * 60
  )
  const duration = start !== null && end !== null ? end - start : null
  const conflict =
    start !== null && end !== null && end > start && blocked(start, end)

  const setStart = (s: string) => {
    const sm = minutesOf(s)
    // Keep the chosen length when it still fits; otherwise trim to the latest valid end.
    const keep = duration && duration > 0 ? duration : 120
    const e = Math.min(sm + keep, latestEnd(sm))
    onChange({ startTime: s, endTime: timeOf(e > sm ? e : sm + step) })
  }

  /** First free slot that fits the current length (or 2 h), searching forward from the current start, then the whole day. */
  const suggestion = (() => {
    const want = duration && duration > 0 ? duration : 120
    const fits = (t: number) =>
      startReason(timeOf(t)) === null && t + want <= latestEnd(t)
    for (const from of [start ?? dayMin, dayMin])
      for (let t = from; t + want <= dayMax; t += step)
        if (fits(t)) return { start: t, end: t + want }
    return null
  })()

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-4"
      data-invalid={conflict || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold">
          Day {index + 1}
          {day ? ` · ${fmtDay(day)}` : ""}
        </span>
        <span className="text-xs text-muted-foreground">
          {!known
            ? "Pick a studio and date to see free and booked times"
            : closed
              ? "Studio closed this day"
              : open
                  .map(
                    (o) =>
                      `Open ${fmtTime(timeOf(o.start))}–${fmtTime(timeOf(o.end))}`
                  )
                  .join(", ")}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Start
          </span>
          <TimeSelect
            aria-label={`Start time, day ${index + 1}`}
            value={startTime}
            onChange={setStart}
            min={timeOf(dayMin)}
            max={timeOf(dayMax - step)}
            step={step}
            unavailable={startReason}
            invalid={conflict}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            End
          </span>
          <TimeSelect
            aria-label={`End time, day ${index + 1}`}
            value={endTime}
            onChange={(e) => onChange({ startTime, endTime: e })}
            min={timeOf(dayMin + step)}
            max={timeOf(dayMax)}
            step={step}
            unavailable={endReason}
            invalid={conflict}
          />
        </div>
        {start !== null && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={`Length, day ${index + 1}`}
            value={
              duration && durations.includes(duration) ? String(duration) : ""
            }
            onValueChange={(v) =>
              v && onChange({ startTime, endTime: timeOf(start + Number(v)) })
            }
          >
            {durations.map((d) => (
              <ToggleGroupItem
                key={d}
                value={String(d)}
                disabled={start + d > latestEnd(start)}
              >
                {d / 60} h
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {known && (
        <DayTimeline
          onPick={(m) => {
            const t = Math.floor(m / step) * step
            if (startReason(timeOf(t)) === null) setStart(timeOf(t))
          }}
          min={dayMin}
          max={dayMax}
          open={open}
          busy={busy}
          blackouts={blackouts}
          selection={
            start !== null && end !== null && end > start
              ? { start, end }
              : null
          }
          conflict={conflict}
        />
      )}
      {conflict && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">
            These times overlap a booking, its {turnaround}-minute turnaround,
            or a closure.
          </p>
          {suggestion && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({
                  startTime: timeOf(suggestion.start),
                  endTime: timeOf(suggestion.end),
                })
              }
            >
              <SparklesIcon data-icon="inline-start" />
              Use next free: {fmtTime(timeOf(suggestion.start))}–
              {fmtTime(timeOf(suggestion.end))}
            </Button>
          )}
        </div>
      )}
      {known && !conflict && start !== null && (
        <p className="text-xs text-muted-foreground">
          Tip: click an open part of the bar to start there.
        </p>
      )}
    </div>
  )
}

/** 6 AM–11 PM, used before the studio's real hours are known. */
const GENERIC_OPEN: Span[] = [{ start: 6 * 60, end: 23 * 60 }]

/** Horizontal day bar: opening hours, booked blocks (with turnaround), closures, and the selection. */
function DayTimeline({
  min,
  max,
  open,
  busy,
  blackouts,
  selection,
  conflict,
  onPick,
}: {
  min: number
  max: number
  open: Span[]
  busy: BusySpan[]
  blackouts: Span[]
  selection: Span | null
  conflict: boolean
  /** Mouse shortcut: start time at the clicked position (keyboard users use the selects). */
  onPick: (minute: number) => void
}) {
  const total = Math.max(60, max - min)
  const pos = (s: Span) => ({
    left: `${((Math.max(s.start, min) - min) / total) * 100}%`,
    width: `${((Math.min(s.end, max) - Math.max(s.start, min)) / total) * 100}%`,
  })
  const hours: number[] = []
  for (let h = Math.ceil(min / 60) * 60; h <= max; h += total > 600 ? 120 : 60)
    hours.push(h)

  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      <div
        className="relative h-9 cursor-pointer overflow-hidden rounded-md border bg-muted"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onPick(min + ((e.clientX - r.left) / r.width) * total)
        }}
      >
        {open.map((o, i) => (
          <div
            key={`o${i}`}
            className="absolute inset-y-0 bg-card"
            style={pos(o)}
          />
        ))}
        {busy.map((b, i) => (
          <div key={`b${i}`}>
            <div
              className="absolute inset-y-1 flex items-center truncate rounded-sm bg-secondary-foreground/70 px-1.5 text-[0.625rem] font-bold text-background"
              style={pos(b)}
              title={b.title ?? "Booked"}
            >
              {b.title ?? "Booked"}
            </div>
            <div
              className="absolute inset-y-1 rounded-sm bg-[repeating-linear-gradient(45deg,var(--border)_0_4px,transparent_4px_8px)]"
              style={pos({ start: b.end, end: b.turnaroundEnd })}
            />
          </div>
        ))}
        {blackouts.map((b, i) => (
          <div
            key={`x${i}`}
            className="absolute inset-y-0 bg-destructive/20"
            style={pos(b)}
          />
        ))}
        {selection && (
          <div
            className={cn(
              "absolute inset-y-0.5 rounded-sm border-2",
              conflict
                ? "border-destructive bg-destructive/30"
                : "border-primary bg-primary/85"
            )}
            style={pos(selection)}
          />
        )}
      </div>
      <div className="relative h-4 text-[0.625rem] text-muted-foreground">
        {hours.map((h) => (
          <span
            key={h}
            className="absolute -translate-x-1/2"
            style={{ left: `${((h - min) / total) * 100}%` }}
          >
            {fmtTime(timeOf(h)).replace(":00", "")}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[0.625rem] text-muted-foreground">
        <Legend className="bg-primary">Your time</Legend>
        <Legend className="bg-secondary-foreground/70">Booked</Legend>
        <Legend className="border bg-[repeating-linear-gradient(45deg,var(--border)_0_3px,transparent_3px_6px)]">
          Turnaround
        </Legend>
        <Legend className="border bg-muted">Closed</Legend>
      </div>
    </div>
  )
}

function Legend({
  className,
  children,
}: {
  className: string
  children: string
}) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block size-2.5 rounded-sm", className)} />
      {children}
    </span>
  )
}
