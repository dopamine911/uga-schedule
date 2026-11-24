import { type LocalDate, timeOf } from "@studio/domain"
import type { CSSProperties } from "react"
import { Link } from "react-router"
import { Card, CardContent } from "@/components/ui/card"
import { fmtDayShort, fmtTime } from "@/lib/format"
import {
  buildSegments,
  DAY_MIN,
  type BusySeg,
  type DayView,
  minutesOf,
  type ScheduleView,
  type Seg,
} from "./scheduleLayout"

const HOUR_PX = 48
// Hour-label gutter; wide enough that "10:00 AM" stays on one line.
const GUTTER = "4rem"

/** Pixel placement shared by every block in the grid. */
interface Geometry {
  hours: number[]
  height: number
  top: (m: number) => number
  size: (a: number, b: number) => number
  span: (a: number, b: number) => string
}

export function ScheduleDayHeader({
  days,
  today,
  columns,
}: {
  days: DayView[]
  today: LocalDate
  columns: CSSProperties
}) {
  return (
    <div className="grid border-b pb-2 text-sm" style={columns}>
      <div />
      {days.map((d) => (
        <div
          key={d.day}
          className={
            d.day === today
              ? "text-center font-semibold"
              : "text-center text-muted-foreground"
          }
        >
          {fmtDayShort(d.day)}
        </div>
      ))}
    </div>
  )
}

export function ScheduleGrid({
  schedule,
  days,
  tz,
  today,
}: {
  schedule: ScheduleView
  days: DayView[]
  tz: string
  today: LocalDate
}) {
  const { busySegs, blackoutSegs, earliest, latest } = buildSegments(
    schedule,
    tz
  )
  const fromMin = Math.max(0, Math.floor(earliest / 60) * 60)
  const toMin = Math.min(DAY_MIN, Math.ceil(latest / 60) * 60)
  const hours = Array.from(
    { length: (toMin - fromMin) / 60 + 1 },
    (_, i) => fromMin + i * 60
  )
  const geo: Geometry = {
    hours,
    height: ((toMin - fromMin) / 60) * HOUR_PX,
    top: (m) => ((m - fromMin) / 60) * HOUR_PX,
    size: (a, b) => Math.max(((b - a) / 60) * HOUR_PX, 14),
    span: (start, end) =>
      `${fmtTime(timeOf(start))} to ${fmtTime(timeOf(end))}`,
  }
  const columns = {
    gridTemplateColumns: `${GUTTER} repeat(${days.length}, minmax(0, 1fr))`,
  }

  return (
    <Card>
      <CardContent className="overflow-x-auto">
        <div>
          <ScheduleDayHeader days={days} today={today} columns={columns} />
          <div className="grid" style={columns}>
            <HourGutter geo={geo} />
            {days.map((d) => (
              <DayColumn
                key={d.day}
                day={d}
                geo={geo}
                busySegs={busySegs.filter((s) => s.day === d.day)}
                blackoutSegs={blackoutSegs.filter((s) => s.day === d.day)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            White: open hours. Grey: closed. Dark: booked. Dashed: turnaround.
            Red: blackout. Times are in {tz}.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function HourGutter({ geo }: { geo: Geometry }) {
  return (
    <div className="relative" style={{ height: geo.height }}>
      {geo.hours.map((h) => (
        <span
          key={h}
          className="absolute right-2 -translate-y-1/2 text-xs whitespace-nowrap text-muted-foreground"
          style={{ top: geo.top(h) }}
        >
          {fmtTime(timeOf(h))}
        </span>
      ))}
    </div>
  )
}

function DayColumn({
  day,
  geo,
  busySegs,
  blackoutSegs,
}: {
  day: DayView
  geo: Geometry
  busySegs: BusySeg[]
  blackoutSegs: Seg[]
}) {
  return (
    <div
      className="relative border-l bg-muted/50"
      style={{ height: geo.height }}
    >
      {geo.hours.map((h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-border/60"
          style={{ top: geo.top(h) }}
        />
      ))}
      {day.open.map((o) => (
        <div
          key={`${o.opens}-${o.closes}`}
          role="img"
          aria-label={`Open ${geo.span(minutesOf(o.opens), minutesOf(o.closes))}`}
          className="absolute inset-x-0 bg-background"
          style={{
            top: geo.top(minutesOf(o.opens)),
            height: geo.size(minutesOf(o.opens), minutesOf(o.closes)),
          }}
        />
      ))}
      {blackoutSegs.map((s) => (
        <BlackoutBlock key={s.key} seg={s} geo={geo} />
      ))}
      {busySegs.map((s) => (
        <BusyBlock key={s.key} seg={s} geo={geo} />
      ))}
    </div>
  )
}

function BlackoutBlock({ seg, geo }: { seg: Seg; geo: Geometry }) {
  return (
    <div
      role="img"
      aria-label={`Blackout ${seg.label}, ${geo.span(seg.start, seg.end)}`}
      className="absolute inset-x-0 overflow-hidden rounded-sm border border-destructive/40 bg-destructive/15 px-1 text-xs"
      style={{ top: geo.top(seg.start), height: geo.size(seg.start, seg.end) }}
    >
      {seg.label}
    </div>
  )
}

function BusyBlock({ seg, geo }: { seg: BusySeg; geo: Geometry }) {
  const className = seg.turnaround
    ? "bg-muted text-muted-foreground border-border absolute inset-x-0 overflow-hidden rounded-sm border border-dashed px-1 text-xs"
    : "bg-primary text-primary-foreground absolute inset-x-0 overflow-hidden rounded-sm px-1 text-xs"
  const style = {
    top: geo.top(seg.start),
    height: geo.size(seg.start, seg.end),
  }
  const aria = `${seg.label}, ${geo.span(seg.start, seg.end)}`
  if (seg.eventId)
    return (
      <Link
        to={`/events/${seg.eventId}`}
        aria-label={aria}
        className={`${className} hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
        style={style}
      >
        {seg.label}
      </Link>
    )
  return (
    <div role="img" aria-label={aria} className={className} style={style}>
      {seg.turnaround ? null : seg.label}
    </div>
  )
}
