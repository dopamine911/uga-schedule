import { weekdayOf } from "@studio/domain"
import { useState } from "react"
import { ErrorAlert, LoadingBlock, PageHeader } from "@/components/common"
import { addDaysTo, campusDay, useNow } from "@/components/staff/shared"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTz } from "@/lib/auth"
import { ScheduleGrid } from "./schedule/ScheduleGrid"
import { ScheduleMonth } from "./schedule/ScheduleMonth"
import { type CalendarView, ScheduleToolbar } from "./schedule/ScheduleToolbar"
import {
  monthLabel,
  monthRange,
  rangeLabel,
  type ScheduleView,
  visibleDays,
} from "./schedule/scheduleLayout"
import { ALL_STUDIOS, useStudioSchedule } from "./schedule/useStudioSchedule"

export function SchedulePage() {
  const tz = useTz()
  const now = useNow()
  const isMobile = useIsMobile()
  const today = campusDay(now, tz)
  const [view, setView] = useState<CalendarView>("week")
  // The anchor day picks the week or month shown; on small screens the week view shows only that day.
  const [dayPick, setDayPick] = useState<string | null>(null)
  const anchor = dayPick ?? today
  const weekStart = addDaysTo(anchor, -weekdayOf(anchor))
  const weekEnd = addDaysTo(weekStart, 6)
  const month = monthRange(anchor)
  const isMonth = view === "month"
  const {
    studios,
    activeStudios,
    studioId,
    schedule,
    studioMonths,
    setStudioPick,
  } = useStudioSchedule(
    isMonth ? month.first : weekStart,
    isMonth ? month.last : weekEnd
  )

  // "All studios" only makes sense in the month list; the week grid draws one studio's opening hours.
  const weekStudioId =
    studioId === ALL_STUDIOS ? (activeStudios[0]?.id ?? "") : studioId
  const changeView = (next: CalendarView) => {
    if (next === "week" && studioId === ALL_STUDIOS && weekStudioId)
      setStudioPick(weekStudioId)
    setView(next)
  }

  const step = isMobile ? 1 : 7
  const unit = isMonth ? "month" : isMobile ? "day" : "week"
  const shift = (direction: number) => {
    if (isMonth) {
      const [year = 0, monthNumber = 1] = anchor.split("-").map(Number)
      const target = new Date(Date.UTC(year, monthNumber - 1 + direction, 1))
      setDayPick(target.toISOString().slice(0, 10))
    } else {
      setDayPick(addDaysTo(anchor, direction * step))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Studio schedule"
        description="Opening hours, blackouts and bookings, by week or month."
      />

      <ScheduleToolbar
        view={view}
        onViewChange={changeView}
        studioId={studioId}
        studios={activeStudios}
        studiosPending={studios.isPending}
        allStudiosValue={isMonth ? ALL_STUDIOS : undefined}
        label={
          isMonth
            ? monthLabel(anchor)
            : rangeLabel(isMobile, anchor, weekStart, weekEnd)
        }
        unit={unit}
        onStudioChange={setStudioPick}
        onPrev={() => shift(-1)}
        onToday={() => setDayPick(null)}
        onNext={() => shift(1)}
      />

      {studios.error && <ErrorAlert error={studios.error} />}
      {schedule.error && <ErrorAlert error={schedule.error} />}
      {!studios.isPending && !studioId && (
        <p className="text-sm text-muted-foreground">
          No active studios to show.
        </p>
      )}
      {isMonth ? (
        schedule.isPending && studioId ? (
          <LoadingBlock rows={3} />
        ) : (
          <ScheduleMonth
            studioMonths={studioMonths}
            first={month.first}
            last={month.last}
            today={today}
            tz={tz}
            showStudioNames={studioId === ALL_STUDIOS}
            onShowWeek={(day) => {
              setDayPick(day)
              changeView("week")
            }}
          />
        )
      ) : (
        <WeekBody
          studioId={weekStudioId}
          schedulePending={schedule.isPending}
          schedule={schedule.data}
          isMobile={isMobile}
          anchor={anchor}
          tz={tz}
          today={today}
        />
      )}
    </div>
  )
}

function WeekBody({
  studioId,
  schedulePending,
  schedule,
  isMobile,
  anchor,
  tz,
  today,
}: {
  studioId: string
  schedulePending: boolean
  schedule: ScheduleView | undefined
  isMobile: boolean
  anchor: string
  tz: string
  today: string
}) {
  if (schedulePending && studioId) return <LoadingBlock rows={3} />
  if (!schedule) return null
  return (
    <ScheduleGrid
      schedule={schedule}
      days={visibleDays(schedule.days, isMobile, anchor)}
      tz={tz}
      today={today}
    />
  )
}
