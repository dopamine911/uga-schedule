import { minutesOf, timeOf, utcToLocal } from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import { SparklesIcon } from "lucide-react"
import { TimeSelect } from "@/components/TimeSelect"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  barLeft,
  barPosition,
  type BusySpan,
  conflictOf,
  type DayRules,
  dayRules,
  durationOptions,
  endReason,
  hourTicks,
  latestEnd,
  openHoursText,
  pickStart,
  type Span,
  selectionOf,
  slotAt,
  startReason,
  suggestSlot,
} from "@/components/events/day-time-math"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtDay, fmtTime } from "@/lib/format"
import { cn } from "@/lib/utils"

// Time selection for one event day (F-004 BR-004-01..04): start/end slots on the studio's granularity,
// limited to opening hours, with booked time and blackouts disabled and drawn on a timeline.
// The server's live check stays the authority; this only steers the user to valid choices.

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
  const rules = dayRules(availability, step, turnaround, maxHours)
  const start = startTime ? minutesOf(startTime) : null
  const end = endTime ? minutesOf(endTime) : null
  const duration = start !== null && end !== null ? end - start : null
  const conflict = conflictOf(rules, start, end)
  const durations = durationOptions(maxHours)
  const suggestion = suggestSlot(rules, start, duration)
  const setStart = (s: string) => onChange(pickStart(rules, s, duration))

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-4"
      data-invalid={conflict || undefined}
    >
      <DayTimeHeader index={index} day={day} rules={rules} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Start
          </span>
          <TimeSelect
            aria-label={`Start time, day ${index + 1}`}
            value={startTime}
            onChange={setStart}
            min={timeOf(rules.dayMin)}
            max={timeOf(rules.dayMax - step)}
            step={step}
            unavailable={(t) => startReason(rules, t)}
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
            min={timeOf(rules.dayMin + step)}
            max={timeOf(rules.dayMax)}
            step={step}
            unavailable={(t) => endReason(rules, start, t)}
            invalid={conflict}
          />
        </div>
        {start !== null && (
          <DurationQuickPick
            index={index}
            durations={durations}
            duration={duration}
            isDisabled={(d) => start + d > latestEnd(rules, start)}
            onSelect={(minutes) =>
              onChange({ startTime, endTime: timeOf(start + minutes) })
            }
          />
        )}
      </div>

      {rules.known && (
        <DayTimeline
          onPick={(m) => {
            const t = slotAt(rules, m)
            if (t !== null) setStart(t)
          }}
          min={rules.dayMin}
          max={rules.dayMax}
          open={rules.open}
          busy={rules.busy}
          blackouts={rules.blackouts}
          selection={selectionOf(start, end)}
          conflict={conflict}
        />
      )}
      <SlotFeedback
        known={rules.known}
        start={start}
        conflict={conflict}
        turnaround={turnaround}
        suggestion={suggestion}
        onUse={(s) =>
          onChange({ startTime: timeOf(s.start), endTime: timeOf(s.end) })
        }
      />
    </div>
  )
}

/** "Day N · date" with what the studio is open for. */
function DayTimeHeader({
  index,
  day,
  rules,
}: {
  index: number
  day: string | undefined
  rules: DayRules
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="font-bold">
        Day {index + 1}
        {day ? ` · ${fmtDay(day)}` : ""}
      </span>
      <span className="text-xs text-muted-foreground">
        {openHoursText(rules)}
      </span>
    </div>
  )
}

/** One-tap lengths (1–8 h, capped by the studio's maximum). */
function DurationQuickPick({
  index,
  durations,
  duration,
  isDisabled,
  onSelect,
}: {
  index: number
  durations: number[]
  duration: number | null
  isDisabled: (minutes: number) => boolean
  onSelect: (minutes: number) => void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={`Length, day ${index + 1}`}
      value={
        duration && durations.includes(duration) ? String(duration) : ""
      }
      onValueChange={(v) => {
        if (v) onSelect(Number(v))
      }}
    >
      {durations.map((d) => (
        <ToggleGroupItem key={d} value={String(d)} disabled={isDisabled(d)}>
          {d / 60} h
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Conflict message with the next-free suggestion, or the click tip when the span is fine. */
function SlotFeedback({
  known,
  start,
  conflict,
  turnaround,
  suggestion,
  onUse,
}: {
  known: boolean
  start: number | null
  conflict: boolean
  turnaround: number
  suggestion: Span | null
  onUse: (slot: Span) => void
}) {
  if (conflict) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-destructive">
          These times overlap a booking, its {turnaround}-minute turnaround, or
          a closure.
        </p>
        {suggestion && (
          <Button size="sm" variant="outline" onClick={() => onUse(suggestion)}>
            <SparklesIcon data-icon="inline-start" />
            Use next free: {fmtTime(timeOf(suggestion.start))}–
            {fmtTime(timeOf(suggestion.end))}
          </Button>
        )}
      </div>
    )
  }
  if (known && start !== null) {
    return (
      <p className="text-xs text-muted-foreground">
        Tip: click an open part of the bar to start there.
      </p>
    )
  }
  return null
}

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
  const hours = hourTicks(min, max)

  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      <button
        type="button"
        tabIndex={-1}
        className="relative block h-9 w-full cursor-pointer overflow-hidden rounded-md border bg-muted p-0 text-left"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onPick(min + ((e.clientX - r.left) / r.width) * total)
        }}
      >
        {open.map((o, i) => (
          <span
            key={`o${i}`}
            className="absolute inset-y-0 bg-card"
            style={barPosition(o, min, max)}
          />
        ))}
        {busy.map((b, i) => (
          <span key={`b${i}`}>
            <span
              className="absolute inset-y-1 flex items-center truncate rounded-sm bg-secondary-foreground/70 px-1.5 text-[0.625rem] font-bold text-background"
              style={barPosition(b, min, max)}
              title={b.title ?? "Booked"}
            >
              {b.title ?? "Booked"}
            </span>
            <span
              className="absolute inset-y-1 rounded-sm bg-[repeating-linear-gradient(45deg,var(--border)_0_4px,transparent_4px_8px)]"
              style={barPosition({ start: b.end, end: b.turnaroundEnd }, min, max)}
            />
          </span>
        ))}
        {blackouts.map((b, i) => (
          <span
            key={`x${i}`}
            className="absolute inset-y-0 bg-destructive/20"
            style={barPosition(b, min, max)}
          />
        ))}
        {selection && (
          <span
            className={cn(
              "absolute inset-y-0.5 rounded-sm border-2",
              conflict
                ? "border-destructive bg-destructive/30"
                : "border-primary bg-primary/85"
            )}
            style={barPosition(selection, min, max)}
          />
        )}
      </button>
      <div className="relative h-4 text-[0.625rem] text-muted-foreground">
        {hours.map((h) => (
          <span
            key={h}
            className="absolute -translate-x-1/2"
            style={{ left: barLeft(h, min, max) }}
          >
            {fmtTime(timeOf(h)).replace(":00", "")}
          </span>
        ))}
      </div>
      <TimelineLegend />
    </div>
  )
}

/** Colour key for the timeline bar. */
function TimelineLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-[0.625rem] text-muted-foreground">
      <Legend className="bg-primary">Your time</Legend>
      <Legend className="bg-secondary-foreground/70">Booked</Legend>
      <Legend className="border bg-[repeating-linear-gradient(45deg,var(--border)_0_3px,transparent_3px_6px)]">
        Turnaround
      </Legend>
      <Legend className="border bg-muted">Closed</Legend>
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
