import { type LocalDate, weekdayOf } from "@studio/domain"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { addDaysTo } from "@/components/staff/shared"
import { cn } from "@/lib/utils"
import {
  busyEventId,
  busyLabel,
  busyState,
  busyToneClass,
  type ScheduleView,
  splitByDay,
} from "./scheduleLayout"

const WEEKDAY_HEADINGS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAYS_PER_WEEK = 7
// Bookings listed per day before "+N more"; the rest are one click away in the week view.
const BOOKINGS_SHOWN_PER_DAY = 3

/** One studio's month of schedule data, labelled for the "All studios" view. */
export interface StudioMonth {
  studioId: string
  studioName: string
  schedule: ScheduleView
}

interface DayBooking {
  key: string
  label: string
  eventId?: string
  state?: string
  start: string
  studioName: string
}

/**
 * Month grid (Sunday first, like the week view). Each day lists its bookings in their status colour
 * and marks blackouts; with one studio, days the studio is closed are shaded. "+N more" and the date
 * number open that week in the week view, where the times are drawn to scale.
 */
export function ScheduleMonth({
  studioMonths,
  first,
  last,
  today,
  tz,
  showStudioNames,
  onShowWeek,
}: {
  studioMonths: StudioMonth[]
  first: LocalDate
  last: LocalDate
  today: LocalDate
  tz: string
  showStudioNames: boolean
  onShowWeek: (day: LocalDate) => void
}) {
  const bookingsByDay = new Map<LocalDate, DayBooking[]>()
  const blackoutDays = new Set<LocalDate>()
  const openDays = new Set<LocalDate>()
  for (const { schedule, studioName } of studioMonths) {
    for (const day of schedule.days) if (day.open.length) openDays.add(day.day)
    for (const busy of schedule.busy)
      for (const day of splitByDay(busy.start, busy.end, tz).keys()) {
        const list = bookingsByDay.get(day) ?? []
        list.push({
          key: `${studioName}-${busy.start}-${day}`,
          label: busyLabel(busy),
          eventId: busyEventId(busy),
          state: busyState(busy),
          start: busy.start,
          studioName,
        })
        bookingsByDay.set(day, list)
      }
    for (const blackout of schedule.blackouts)
      for (const day of splitByDay(blackout.start, blackout.end, tz).keys())
        blackoutDays.add(day)
  }

  // Pad to whole weeks so the grid starts on a Sunday and ends on a Saturday.
  const gridStart = addDaysTo(first, -weekdayOf(first))
  const gridEnd = addDaysTo(last, DAYS_PER_WEEK - 1 - weekdayOf(last))
  const cells: LocalDate[] = []
  for (let day = gridStart; day <= gridEnd; day = addDaysTo(day, 1))
    cells.push(day)

  return (
    <Card>
      <CardContent className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-7 border-t border-l">
          {WEEKDAY_HEADINGS.map((heading) => (
            <div
              key={heading}
              className="border-r border-b p-2 text-center text-xs font-bold tracking-widest text-muted-foreground uppercase"
            >
              {heading}
            </div>
          ))}
          {cells.map((day) => {
            const inMonth = day >= first && day <= last
            const bookings = (bookingsByDay.get(day) ?? []).sort((a, b) =>
              a.start.localeCompare(b.start)
            )
            const hidden = bookings.length - BOOKINGS_SHOWN_PER_DAY
            const closed =
              inMonth && studioMonths.length > 0 && !openDays.has(day)
            return (
              <div
                key={day}
                className={cn(
                  "flex min-h-28 flex-col gap-1 border-r border-b p-1.5",
                  (!inMonth || closed) && "bg-muted/60"
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 min-w-7 rounded-full px-2 font-heading text-base",
                      day === today && "bg-primary text-primary-foreground",
                      !inMonth && "text-muted-foreground"
                    )}
                    aria-label={`Show the week of ${day}`}
                    onClick={() => onShowWeek(day)}
                  >
                    {Number(day.slice(8, 10))}
                  </Button>
                  {closed && (
                    <span className="text-xs text-muted-foreground">
                      Closed
                    </span>
                  )}
                </div>
                {inMonth && blackoutDays.has(day) && (
                  <span className="rounded-sm bg-destructive/15 px-1 text-xs font-medium text-destructive">
                    Blackout
                  </span>
                )}
                {inMonth &&
                  bookings.slice(0, BOOKINGS_SHOWN_PER_DAY).map((booking) => {
                    const text = showStudioNames
                      ? `${booking.studioName.split(" – ")[0]} · ${booking.label}`
                      : booking.label
                    const className = cn(
                      busyToneClass(booking.state),
                      "truncate rounded-sm px-1 text-xs"
                    )
                    return booking.eventId ? (
                      <Link
                        key={booking.key}
                        to={`/events/${booking.eventId}`}
                        title={text}
                        className={cn(
                          className,
                          "hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        )}
                      >
                        {text}
                      </Link>
                    ) : (
                      <span key={booking.key} className={className}>
                        {text}
                      </span>
                    )
                  })}
                {inMonth && hidden > 0 && (
                  <button
                    type="button"
                    className="self-start rounded-sm px-1 text-xs font-bold text-muted-foreground hover:text-foreground"
                    onClick={() => onShowWeek(day)}
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
