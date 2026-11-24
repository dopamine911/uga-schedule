import { type LocalDate, weekdayOf } from "@studio/domain"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { addDaysTo } from "@/components/staff/shared"
import { cn } from "@/lib/utils"
import {
  busyDotClass,
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

/** Per-day lookups for the month grid: bookings (soonest first), blackout days, and days any studio opens. */
interface MonthIndex {
  bookingsByDay: Map<LocalDate, DayBooking[]>
  blackoutDays: Set<LocalDate>
  openDays: Set<LocalDate>
}

function indexMonth(studioMonths: StudioMonth[], tz: string): MonthIndex {
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
  for (const list of bookingsByDay.values())
    list.sort((a, b) => a.start.localeCompare(b.start))
  return { bookingsByDay, blackoutDays, openDays }
}

/** Every day shown, padded to whole weeks so the grid starts on a Sunday and ends on a Saturday. */
function gridDays(first: LocalDate, last: LocalDate): LocalDate[] {
  const gridStart = addDaysTo(first, -weekdayOf(first))
  const gridEnd = addDaysTo(last, DAYS_PER_WEEK - 1 - weekdayOf(last))
  const days: LocalDate[] = []
  for (let day = gridStart; day <= gridEnd; day = addDaysTo(day, 1))
    days.push(day)
  return days
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
  const index = indexMonth(studioMonths, tz)
  return (
    <Card>
      <CardContent className="overflow-x-auto">
        <div className="grid grid-cols-7 border-t border-l">
          {WEEKDAY_HEADINGS.map((heading) => (
            <div
              key={heading}
              className="border-r border-b px-0.5 py-2 text-center text-xs font-bold tracking-wider text-muted-foreground uppercase sm:p-2 sm:tracking-widest"
            >
              {heading}
            </div>
          ))}
          {gridDays(first, last).map((day) => (
            <MonthDayCell
              key={day}
              day={day}
              inMonth={day >= first && day <= last}
              isToday={day === today}
              closed={studioMonths.length > 0 && !index.openDays.has(day)}
              hasBlackout={index.blackoutDays.has(day)}
              bookings={index.bookingsByDay.get(day) ?? []}
              showStudioNames={showStudioNames}
              onShowWeek={onShowWeek}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function MonthDayCell({
  day,
  inMonth,
  isToday,
  closed,
  hasBlackout,
  bookings,
  showStudioNames,
  onShowWeek,
}: {
  day: LocalDate
  inMonth: boolean
  isToday: boolean
  closed: boolean
  hasBlackout: boolean
  bookings: DayBooking[]
  showStudioNames: boolean
  onShowWeek: (day: LocalDate) => void
}) {
  const showClosed = inMonth && closed
  return (
    <div
      className={cn(
        "flex min-h-16 min-w-0 flex-col gap-1 border-r border-b p-1 sm:min-h-28 sm:p-1.5",
        (!inMonth || showClosed) && "bg-muted/60"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 min-w-7 rounded-full px-2 font-heading text-base",
            isToday && "bg-primary text-primary-foreground",
            !inMonth && "text-muted-foreground"
          )}
          aria-label={`Show the week of ${day}`}
          onClick={() => onShowWeek(day)}
        >
          {Number(day.slice(8, 10))}
        </Button>
        {showClosed && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Closed
          </span>
        )}
      </div>
      {inMonth && (
        <DayContents
          day={day}
          hasBlackout={hasBlackout}
          bookings={bookings}
          showStudioNames={showStudioNames}
          onShowWeek={onShowWeek}
        />
      )}
    </div>
  )
}

/** Blackout label, booking labels and "+N more" on wider screens; status dots on phones. */
function DayContents({
  day,
  hasBlackout,
  bookings,
  showStudioNames,
  onShowWeek,
}: {
  day: LocalDate
  hasBlackout: boolean
  bookings: DayBooking[]
  showStudioNames: boolean
  onShowWeek: (day: LocalDate) => void
}) {
  const hidden = bookings.length - BOOKINGS_SHOWN_PER_DAY
  return (
    <>
      {hasBlackout && (
        <span className="hidden rounded-sm bg-destructive/15 px-1 text-xs font-medium text-destructive sm:block">
          Blackout
        </span>
      )}
      {/* Phones: one dot per booking in its status colour (square = blackout); names live in the week view. */}
      {(bookings.length > 0 || hasBlackout) && (
        <span
          className="flex flex-wrap gap-1 px-1 sm:hidden"
          aria-label={`${bookings.length} ${bookings.length === 1 ? "booking" : "bookings"}${hasBlackout ? ", blackout" : ""}`}
          role="img"
        >
          {hasBlackout && (
            <span className="size-2 rounded-[2px] bg-destructive" />
          )}
          {bookings.map((booking) => (
            <span
              key={booking.key}
              className={cn("size-2 rounded-full", busyDotClass(booking.state))}
            />
          ))}
        </span>
      )}
      {bookings.slice(0, BOOKINGS_SHOWN_PER_DAY).map((booking) => (
        <BookingLabel
          key={booking.key}
          booking={booking}
          showStudioName={showStudioNames}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className="hidden self-start rounded-sm px-1 text-xs font-bold text-muted-foreground hover:text-foreground sm:block"
          onClick={() => onShowWeek(day)}
        >
          +{hidden} more
        </button>
      )}
    </>
  )
}

function BookingLabel({
  booking,
  showStudioName,
}: {
  booking: DayBooking
  showStudioName: boolean
}) {
  const text = showStudioName
    ? `${booking.studioName.split(" – ")[0]} · ${booking.label}`
    : booking.label
  const className = cn(
    busyToneClass(booking.state),
    "hidden truncate rounded-sm px-1 text-xs sm:block"
  )
  if (!booking.eventId) return <span className={className}>{text}</span>
  return (
    <Link
      to={`/events/${booking.eventId}`}
      title={text}
      className={cn(
        className,
        "hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {text}
    </Link>
  )
}
