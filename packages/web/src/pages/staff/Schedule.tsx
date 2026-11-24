import { weekdayOf } from "@studio/domain"
import { useState } from "react"
import { ErrorAlert, LoadingBlock, PageHeader } from "@/components/common"
import { addDaysTo, campusDay, useNow } from "@/components/staff/shared"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTz } from "@/lib/auth"
import { ScheduleGrid } from "./schedule/ScheduleGrid"
import { ScheduleToolbar } from "./schedule/ScheduleToolbar"
import {
  rangeLabel,
  type ScheduleView,
  visibleDays,
} from "./schedule/scheduleLayout"
import { useStudioSchedule } from "./schedule/useStudioSchedule"

export function SchedulePage() {
  const tz = useTz()
  const now = useNow()
  const isMobile = useIsMobile()
  const today = campusDay(now, tz)
  // The anchor day picks the week shown; on small screens it is the single day shown.
  const [dayPick, setDayPick] = useState<string | null>(null)
  const anchor = dayPick ?? today
  const weekStart = addDaysTo(anchor, -weekdayOf(anchor))
  const weekEnd = addDaysTo(weekStart, 6)
  const step = isMobile ? 1 : 7
  const unit = isMobile ? "day" : "week"
  const { studios, activeStudios, studioId, schedule, setStudioPick } =
    useStudioSchedule(weekStart, weekEnd)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Studio schedule"
        description="Opening hours, blackouts and bookings for one studio, by week."
      />

      <ScheduleToolbar
        studioId={studioId}
        studios={activeStudios}
        studiosPending={studios.isPending}
        label={rangeLabel(isMobile, anchor, weekStart, weekEnd)}
        unit={unit}
        onStudioChange={setStudioPick}
        onPrev={() => setDayPick(addDaysTo(anchor, -step))}
        onToday={() => setDayPick(null)}
        onNext={() => setDayPick(addDaysTo(anchor, step))}
      />

      <ScheduleBody
        studioId={studioId}
        studiosError={studios.error}
        studiosPending={studios.isPending}
        scheduleError={schedule.error}
        schedulePending={schedule.isPending}
        schedule={schedule.data}
        isMobile={isMobile}
        anchor={anchor}
        tz={tz}
        today={today}
      />
    </div>
  )
}

function ScheduleBody({
  studioId,
  studiosError,
  studiosPending,
  scheduleError,
  schedulePending,
  schedule,
  isMobile,
  anchor,
  tz,
  today,
}: {
  studioId: string
  studiosError: Error | null
  studiosPending: boolean
  scheduleError: Error | null
  schedulePending: boolean
  schedule: ScheduleView | undefined
  isMobile: boolean
  anchor: string
  tz: string
  today: string
}) {
  return (
    <>
      {studiosError && <ErrorAlert error={studiosError} />}
      {scheduleError && <ErrorAlert error={scheduleError} />}
      {!studiosPending && !studioId && (
        <p className="text-sm text-muted-foreground">
          No active studios to show.
        </p>
      )}
      {schedulePending && studioId ? (
        <LoadingBlock rows={3} />
      ) : (
        schedule && (
          <ScheduleGrid
            schedule={schedule}
            days={visibleDays(schedule.days, isMobile, anchor)}
            tz={tz}
            today={today}
          />
        )
      )}
    </>
  )
}
