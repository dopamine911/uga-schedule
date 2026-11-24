import {
  type LocalDate,
  nextDay,
  timeOf,
  utcToLocal,
  weekdayOf,
} from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { ErrorAlert, LoadingBlock, PageHeader } from "@/components/common"
import { addDaysTo, campusDay, useNow } from "@/components/staff/shared"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtDay, fmtTime } from "@/lib/format"

const HOUR_PX = 48
const DAY_MIN = 24 * 60
const DEFAULT_FROM = 8 * 60
const DEFAULT_TO = 18 * 60

type ScheduleView = InferResponseType<
  (typeof api.studios)[":id"]["schedule"]["$get"]
>
type BusyView = ScheduleView["busy"][number]

function fetchSchedule(studioId: string, from: LocalDate, to: LocalDate) {
  return unwrap(
    api.studios[":id"].schedule.$get({
      param: { id: studioId },
      query: { from, to },
    })
  )
}

/** Splits an absolute span at campus midnights into day → [startMin, endMin] wall-clock minutes. */
function splitByDay(
  start: string,
  end: string,
  tz: string
): Map<LocalDate, [number, number]> {
  const out = new Map<LocalDate, [number, number]>()
  const s = utcToLocal(start, tz)
  const e = utcToLocal(end, tz)
  for (let d = s.day; d <= e.day; d = nextDay(d)) {
    const from = d === s.day ? s.minutes : 0
    const to = d === e.day ? e.minutes : DAY_MIN
    if (to > from) out.set(d, [from, to])
  }
  return out
}

function minutesOf(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number)
  return h * 60 + m
}

export function SchedulePage() {
  const tz = useTz()
  const now = useNow()
  const today = campusDay(now, tz)
  const thisMonday = addDaysTo(today, -weekdayOf(today))
  const [studioPick, setStudioPick] = useState<string | null>(null)
  const [weekPick, setWeekPick] = useState<string | null>(null)
  const weekStart = weekPick ?? thisMonday
  const weekEnd = addDaysTo(weekStart, 6)

  const studios = useQuery({
    queryKey: ["studios"],
    queryFn: () => unwrap(api.studios.$get()),
  })
  const activeStudios = (studios.data ?? []).filter(
    (s) => s.status === "active"
  )
  const studioId = studioPick ?? activeStudios[0]?.id ?? ""

  const schedule = useQuery({
    queryKey: ["studios", studioId, "schedule", weekStart, weekEnd],
    queryFn: () => fetchSchedule(studioId, weekStart, weekEnd),
    enabled: !!studioId,
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Studio schedule"
        description="Opening hours, blackouts and bookings for one studio, by week."
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="studio" className="text-sm font-medium">
            Studio
          </label>
          <Select
            value={studioId}
            onValueChange={setStudioPick}
            disabled={!activeStudios.length}
          >
            <SelectTrigger id="studio" className="w-64">
              <SelectValue
                placeholder={studios.isPending ? "Loading…" : "Choose a studio"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {activeStudios.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekPick(addDaysTo(weekStart, -7))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" onClick={() => setWeekPick(null)}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekPick(addDaysTo(weekStart, 7))}
          >
            <ChevronRightIcon />
          </Button>
          <span className="text-sm">
            {fmtDay(weekStart)} – {fmtDay(weekEnd)}
          </span>
        </div>
      </div>

      {studios.error && <ErrorAlert error={studios.error} />}
      {schedule.error && <ErrorAlert error={schedule.error} />}
      {!studios.isPending && !studioId && (
        <p className="text-sm text-muted-foreground">
          No active studios to show.
        </p>
      )}
      {schedule.isPending && studioId ? (
        <LoadingBlock rows={3} />
      ) : (
        schedule.data && (
          <WeekGrid schedule={schedule.data} tz={tz} today={today} />
        )
      )}
    </div>
  )
}

function WeekGrid({
  schedule,
  tz,
  today,
}: {
  schedule: ScheduleView
  tz: string
  today: LocalDate
}) {
  // Busy, turnaround and blackout spans, clipped to each campus day so they land in the right column.
  const busySegs: {
    day: LocalDate
    start: number
    end: number
    key: string
    label: string
    eventId?: string
    turnaround: boolean
  }[] = []
  const blackoutSegs: {
    day: LocalDate
    start: number
    end: number
    key: string
    label: string
  }[] = []
  let earliest = DEFAULT_FROM
  let latest = DEFAULT_TO
  for (const d of schedule.days)
    for (const o of d.open) {
      earliest = Math.min(earliest, minutesOf(o.opens))
      latest = Math.max(latest, minutesOf(o.closes))
    }

  for (const b of schedule.busy) {
    const label = busyLabel(b)
    for (const [day, [start, end]] of splitByDay(b.start, b.end, tz)) {
      busySegs.push({
        day,
        start,
        end,
        key: `b-${b.start}-${day}`,
        label,
        eventId: busyEventId(b),
        turnaround: false,
      })
      earliest = Math.min(earliest, start)
      latest = Math.max(latest, end)
    }
    for (const [day, [start, end]] of splitByDay(b.end, b.turnaroundEnd, tz)) {
      busySegs.push({
        day,
        start,
        end,
        key: `t-${b.end}-${day}`,
        label: "Turnaround",
        turnaround: true,
      })
      latest = Math.max(latest, end)
    }
  }
  for (const bo of schedule.blackouts)
    for (const [day, [start, end]] of splitByDay(bo.start, bo.end, tz)) {
      blackoutSegs.push({
        day,
        start,
        end,
        key: `k-${bo.start}-${day}`,
        label: bo.reason || "Blackout",
      })
      earliest = Math.min(earliest, start)
      latest = Math.max(latest, end)
    }

  const fromMin = Math.max(0, Math.floor(earliest / 60) * 60)
  const toMin = Math.min(DAY_MIN, Math.ceil(latest / 60) * 60)
  const hours = Array.from(
    { length: (toMin - fromMin) / 60 + 1 },
    (_, i) => fromMin + i * 60
  )
  const height = ((toMin - fromMin) / 60) * HOUR_PX
  const top = (m: number) => ((m - fromMin) / 60) * HOUR_PX
  const size = (a: number, b: number) => Math.max(((b - a) / 60) * HOUR_PX, 14)
  const span = (start: number, end: number) =>
    `${fmtTime(timeOf(start))} to ${fmtTime(timeOf(end))}`

  return (
    <Card>
      <CardContent className="overflow-x-auto">
        <div className="min-w-[56rem]">
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b pb-2 text-sm">
            <div />
            {schedule.days.map((d) => (
              <div
                key={d.day}
                className={
                  d.day === today
                    ? "text-center font-semibold"
                    : "text-center text-muted-foreground"
                }
              >
                {fmtDay(d.day)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
            <div className="relative" style={{ height }}>
              {hours.map((h) => (
                <span
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground"
                  style={{ top: top(h) }}
                >
                  {fmtTime(timeOf(h))}
                </span>
              ))}
            </div>
            {schedule.days.map((d) => (
              <div
                key={d.day}
                className="relative border-l bg-muted/50"
                style={{ height }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-border/60"
                    style={{ top: top(h) }}
                  />
                ))}
                {d.open.map((o) => (
                  <div
                    key={`${o.opens}-${o.closes}`}
                    role="img"
                    aria-label={`Open ${span(minutesOf(o.opens), minutesOf(o.closes))}`}
                    className="absolute inset-x-0 bg-background"
                    style={{
                      top: top(minutesOf(o.opens)),
                      height: size(minutesOf(o.opens), minutesOf(o.closes)),
                    }}
                  />
                ))}
                {blackoutSegs
                  .filter((s) => s.day === d.day)
                  .map((s) => (
                    <div
                      key={s.key}
                      role="img"
                      aria-label={`Blackout ${s.label}, ${span(s.start, s.end)}`}
                      className="absolute inset-x-0 overflow-hidden rounded-sm border border-destructive/40 bg-destructive/15 px-1 text-xs"
                      style={{
                        top: top(s.start),
                        height: size(s.start, s.end),
                      }}
                    >
                      {s.label}
                    </div>
                  ))}
                {busySegs
                  .filter((s) => s.day === d.day)
                  .map((s) => {
                    const className = s.turnaround
                      ? "bg-muted text-muted-foreground border-border absolute inset-x-0 overflow-hidden rounded-sm border border-dashed px-1 text-xs"
                      : "bg-primary text-primary-foreground absolute inset-x-0 overflow-hidden rounded-sm px-1 text-xs"
                    const style = {
                      top: top(s.start),
                      height: size(s.start, s.end),
                    }
                    const aria = `${s.label}, ${span(s.start, s.end)}`
                    if (s.eventId)
                      return (
                        <Link
                          key={s.key}
                          to={`/events/${s.eventId}`}
                          aria-label={aria}
                          className={`${className} hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
                          style={style}
                        >
                          {s.label}
                        </Link>
                      )
                    return (
                      <div
                        key={s.key}
                        role="img"
                        aria-label={aria}
                        className={className}
                        style={style}
                      >
                        {s.turnaround ? null : s.label}
                      </div>
                    )
                  })}
              </div>
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

/** Title and requester when the API returns them (staff view); otherwise a neutral "Booked". */
function busyLabel(b: BusyView): string {
  if (!("title" in b) || !b.title) return "Booked"
  return b.requesterName ? `${b.title} (${b.requesterName})` : b.title
}

function busyEventId(b: BusyView): string | undefined {
  return "eventId" in b ? b.eventId : undefined
}
