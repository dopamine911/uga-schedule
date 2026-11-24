import { CalendarClockIcon } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"
import { DatePicker } from "@/components/DatePicker"
import { ErrorAlert, IconTitle } from "@/components/common"
import {
  type DayAvailability,
  DayTimePicker,
} from "@/components/events/DayTimePicker"
import { type DraftForm, withNumDays } from "@/components/events/draft"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  dayAt,
  dayCountHintOf,
  type EventTypeRow,
  flaggedHintOf,
  granularityOf,
  isDayDisabled,
  isOutsideNotice,
  maxDaysOf,
  maxHoursOf,
  type NoticePolicy,
  turnaroundOf,
  type StudioRow,
} from "./rules"

interface ScheduleCardProps {
  form: DraftForm
  setForm: Dispatch<SetStateAction<DraftForm>>
  patch: (p: Partial<DraftForm>) => void
  type: EventTypeRow | undefined
  studio: StudioRow | undefined
  notice: NoticePolicy | undefined
  today: string
  tz: string
  nowMs: number
  availability: Map<string, DayAvailability> | undefined
  availabilityError: Error | null
  problems: string[]
}

/** Section 2: consecutive days, one start and end time per day. */
export function ScheduleCard(props: ScheduleCardProps) {
  const { form, setForm, patch, type, studio, notice, today, tz, nowMs, availability, availabilityError, problems } = props
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={CalendarClockIcon}>2. Schedule</IconTitle>
        </CardTitle>
        <CardDescription>Consecutive days, one start and end time per day.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <FieldGroup>
          <div className="flex flex-wrap items-end gap-6">
            <FirstDayField
              form={form}
              patch={patch}
              today={today}
              studio={studio}
              notice={notice}
              nowMs={nowMs}
              tz={tz}
            />
            <DayCountField form={form} setForm={setForm} type={type} />
          </div>
          <DayTimeList
            form={form}
            setForm={setForm}
            type={type}
            studio={studio}
            tz={tz}
            availability={availability}
            availabilityError={availabilityError}
          />
        </FieldGroup>
        <ScheduleProblems problems={problems} />
      </CardContent>
    </Card>
  )
}

function FirstDayField({
  form,
  patch,
  today,
  studio,
  notice,
  nowMs,
  tz,
}: {
  form: DraftForm
  patch: (p: Partial<DraftForm>) => void
  today: string
  studio: StudioRow | undefined
  notice: NoticePolicy | undefined
  nowMs: number
  tz: string
}) {
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor="first-day">{form.times.length > 1 ? "Dates" : "Date"}</FieldLabel>
      <DatePicker
        id="first-day"
        value={form.firstDay}
        onChange={(firstDay) => patch({ firstDay })}
        min={today}
        isDisabled={(day) => isDayDisabled(day, studio, notice, nowMs, tz)}
        isFlagged={notice ? (day) => isOutsideNotice(day, notice, nowMs, tz) : undefined}
        flaggedHint={flaggedHintOf(notice)}
        span={form.times.length}
        placeholder="Choose the first day"
      />
      <FieldDescription>
        {studio ? "Days the studio is closed are greyed out." : "Choose a studio first to see closed days."}
      </FieldDescription>
    </Field>
  )
}

function DayCountField({
  form,
  setForm,
  type,
}: {
  form: DraftForm
  setForm: Dispatch<SetStateAction<DraftForm>>
  type: EventTypeRow | undefined
}) {
  const maxDays = maxDaysOf(type)
  const onCount = (n: number) => setForm((f) => withNumDays(f, n))
  return (
    <Field className="w-auto">
      <FieldLabel>Number of days</FieldLabel>
      {maxDays > 7 ? (
        <DayCountSelect value={form.times.length} maxDays={maxDays} onCount={onCount} />
      ) : (
        <DayCountToggles value={form.times.length} maxDays={maxDays} onCount={onCount} />
      )}
      <FieldDescription>{dayCountHintOf(type, maxDays)}</FieldDescription>
    </Field>
  )
}

function DayCountSelect({
  value,
  maxDays,
  onCount,
}: {
  value: number
  maxDays: number
  onCount: (n: number) => void
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onCount(Number(v))}>
      <SelectTrigger aria-label="Number of days" className="w-24">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {Array.from({ length: maxDays }, (_, i) => (
            <SelectItem key={i} value={String(i + 1)}>
              {i + 1}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function DayCountToggles({
  value,
  maxDays,
  onCount,
}: {
  value: number
  maxDays: number
  onCount: (n: number) => void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      aria-label="Number of days"
      value={String(value)}
      onValueChange={(v) => v && onCount(Number(v))}
    >
      {Array.from({ length: maxDays }, (_, i) => (
        <ToggleGroupItem key={i} value={String(i + 1)} className="min-w-9">
          {i + 1}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function DayTimeList({
  form,
  setForm,
  type,
  studio,
  tz,
  availability,
  availabilityError,
}: {
  form: DraftForm
  setForm: Dispatch<SetStateAction<DraftForm>>
  type: EventTypeRow | undefined
  studio: StudioRow | undefined
  tz: string
  availability: Map<string, DayAvailability> | undefined
  availabilityError: Error | null
}) {
  const granularity = granularityOf(studio)
  const days = form.times.map((times, n) => ({
    dayNumber: n + 1,
    times,
    day: dayAt(form, n),
  }))
  return (
    <div className="flex flex-col gap-3">
      {availabilityError && <ErrorAlert error={availabilityError} />}
      {days.map((d) => (
        <DayTimePicker
          key={d.dayNumber}
          day={d.day}
          index={d.dayNumber - 1}
          startTime={d.times.startTime}
          endTime={d.times.endTime}
          onChange={(next) =>
            setForm((f) => ({
              ...f,
              times: f.times.map((x, j) => (j === d.dayNumber - 1 ? next : x)),
            }))
          }
          step={granularity}
          turnaround={turnaroundOf(studio)}
          maxHours={maxHoursOf(type)}
          availability={
            d.day && form.studioId ? availability?.get(d.day) : undefined
          }
        />
      ))}
      <p className="text-xs text-muted-foreground">Times are campus time ({tz}).</p>
    </div>
  )
}

function ScheduleProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null
  return (
    <Alert>
      <AlertTitle>Schedule</AlertTitle>
      <AlertDescription>{problems.join(" ")}</AlertDescription>
    </Alert>
  )
}
