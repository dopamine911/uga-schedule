import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  FormDialog,
  intOrUndefined,
  toastSaved,
} from "@/components/admin/shared"
import {
  LabeledField,
  LevelSelect,
  NONE,
  SimpleSelect,
  type StudioSummary,
  SwitchField,
  TextAreaField,
  TextField,
  useForm,
  useStudios,
} from "@/components/admin/pickers"
import { DatePicker } from "@/components/DatePicker"
import { TimeSelect } from "@/components/TimeSelect"
import { Switch } from "@/components/ui/switch"
import { api, unwrap } from "@/lib/api"
import { useState } from "react"

// Dialogs for the studios page: studio details, weekly opening hours, and blackout periods (F-004).

export function StudioDialog({
  initial,
  onClose,
}: {
  initial?: StudioSummary
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, set] = useForm({
    name: initial?.name ?? "",
    location: initial?.location ?? "",
    capacityPeople: String(initial?.capacityPeople ?? 1),
    minLevelId: initial?.minLevel.id ?? "",
    turnaroundMinutes: String(initial?.turnaroundMinutes ?? 30),
    slotGranularityMinutes: String(initial?.slotGranularityMinutes ?? 30),
    active: (initial?.status ?? "active") === "active",
  })
  const save = useMutation({
    mutationFn: async (): Promise<string[]> => {
      const json = {
        name: v.name.trim(),
        location: v.location.trim(),
        capacityPeople: intOrUndefined(v.capacityPeople) ?? 1,
        minLevelId: v.minLevelId,
        turnaroundMinutes: intOrUndefined(v.turnaroundMinutes) ?? 0,
        slotGranularityMinutes: intOrUndefined(v.slotGranularityMinutes) ?? 30,
      }
      if (!initial) {
        await unwrap(api.studios.$post({ json }))
        return []
      }
      const res = await unwrap(
        api.studios[":id"].$patch({
          param: { id: initial.id },
          json: { ...json, status: v.active ? "active" : "inactive" },
        })
      )
      return res.flaggedEvents
    },
    onSuccess: (flagged) => {
      qc.invalidateQueries({ queryKey: ["studios"] })
      if (initial) toastSaved("Studio saved.", flagged)
      else toast.success("Studio created.")
      onClose()
    },
  })
  return (
    <FormDialog
      title={initial ? `Edit ${initial.name}` : "New studio"}
      description="A higher minimum level or a deactivated studio re-checks its open events."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitDisabled={!v.name.trim() || !v.minLevelId}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="studio-name"
          label="Name"
          value={v.name}
          onChange={(x) => set("name", x)}
          required
        />
        <TextField
          id="studio-location"
          label="Location"
          value={v.location}
          onChange={(x) => set("location", x)}
        />
        <TextField
          id="studio-capacity"
          label="Capacity (people)"
          type="number"
          value={v.capacityPeople}
          onChange={(x) => set("capacityPeople", x)}
        />
        <LabeledField label="Minimum level" htmlFor="studio-level">
          <LevelSelect
            id="studio-level"
            value={v.minLevelId}
            onValueChange={(x) => set("minLevelId", x)}
          />
        </LabeledField>
        <TextField
          id="studio-turnaround"
          label="Turnaround (minutes)"
          type="number"
          value={v.turnaroundMinutes}
          onChange={(x) => set("turnaroundMinutes", x)}
          description="Time held after each day for cleaning and reset."
        />
        <TextField
          id="studio-granularity"
          label="Slot granularity (minutes)"
          type="number"
          value={v.slotGranularityMinutes}
          onChange={(x) => set("slotGranularityMinutes", x)}
          description="Bookings start and end on multiples of this."
        />
      </div>
      {initial && (
        <SwitchField
          id="studio-active"
          label="Active"
          description="Inactive studios are hidden from students and can't take new bookings."
          checked={v.active}
          onCheckedChange={(x) => set("active", x)}
        />
      )}
    </FormDialog>
  )
}

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const

interface DayHours {
  open: boolean
  opens: string
  closes: string
}

/** Weekly hours editor. One window per weekday; PUT replaces every window of the studio. */
export function HoursDialog({
  studio,
  hours,
  onClose,
}: {
  studio: { id: string; name: string }
  hours: readonly { weekday: number; opens: string; closes: string }[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [days, setDays] = useState<DayHours[]>(() =>
    WEEKDAYS.map((_, i) => {
      const h = hours.find((x) => x.weekday === i)
      return {
        open: !!h,
        opens: h?.opens ?? "09:00",
        closes: h?.closes ?? "17:00",
      }
    })
  )
  const [multi] = useState(() =>
    WEEKDAYS.some((_, i) => hours.filter((x) => x.weekday === i).length > 1)
  )
  const update = (i: number, patch: Partial<DayHours>) =>
    setDays((prev) => prev.map((d, n) => (n === i ? { ...d, ...patch } : d)))
  const invalid = days.some((d) => d.open && d.closes <= d.opens)

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.studios[":id"].hours.$put({
          param: { id: studio.id },
          json: days.flatMap((d, weekday) =>
            d.open ? [{ weekday, opens: d.opens, closes: d.closes }] : []
          ),
        })
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["studios"] })
      toastSaved("Opening hours saved.", res.flaggedEvents)
      onClose()
    },
  })

  return (
    <FormDialog
      title={`Opening hours: ${studio.name}`}
      description="Set the window for each weekday, or mark it closed. Times are campus local time."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Save hours"
      submitDisabled={invalid}
      wide
    >
      {multi && (
        <p className="text-sm text-muted-foreground">
          This studio has more than one window on some days. Saving keeps one
          window per day.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {WEEKDAYS.map((label, i) => {
          const d = days[i]!
          const id = `hours-${i}`
          return (
            <div key={label} className="flex flex-wrap items-center gap-3">
              <div className="flex w-32 items-center gap-2">
                <Switch
                  id={`${id}-open`}
                  checked={d.open}
                  onCheckedChange={(x) => update(i, { open: x })}
                  aria-label={`${label} open`}
                />
                <label htmlFor={`${id}-open`} className="text-sm font-medium">
                  {label}
                </label>
              </div>
              {d.open ? (
                <>
                  <TimeSelect
                    id={`${id}-opens`}
                    aria-label={`${label} opens`}
                    value={d.opens}
                    step={30}
                    onChange={(x) => update(i, { opens: x })}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <TimeSelect
                    id={`${id}-closes`}
                    aria-label={`${label} closes`}
                    value={d.closes}
                    step={30}
                    invalid={d.closes <= d.opens}
                    onChange={(x) => update(i, { closes: x })}
                  />
                  {d.closes <= d.opens && (
                    <span className="text-sm text-destructive">
                      Closing time must be after opening.
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Closed</span>
              )}
            </div>
          )
        })}
      </div>
    </FormDialog>
  )
}

export function BlackoutDialog({
  studioId,
  onClose,
}: {
  /** Studio to preselect; the "all studios" option is always available. */
  studioId: string | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const studios = useStudios()
  const [v, set] = useForm({
    studioId: studioId ?? NONE,
    startDay: "",
    startTime: "08:00",
    endDay: "",
    endTime: "17:00",
    reason: "",
  })
  const startKey = `${v.startDay} ${v.startTime}`
  const endKey = `${v.endDay} ${v.endTime}`
  const badRange = !!v.startDay && !!v.endDay && endKey <= startKey

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.studios.blackouts.$post({
          json: {
            studioId: v.studioId === NONE ? null : v.studioId,
            startDay: v.startDay,
            startTime: v.startTime,
            endDay: v.endDay,
            endTime: v.endTime,
            reason: v.reason.trim(),
          },
        })
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["studios"] })
      toastSaved("Blackout added.", res.flaggedEvents)
      onClose()
    },
  })

  return (
    <FormDialog
      title="Add blackout"
      description="Blackouts close the studio for a period. Open events over it are flagged for review, not cancelled."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Add blackout"
      submitDisabled={!v.startDay || !v.endDay || badRange || !v.reason.trim()}
    >
      <LabeledField label="Applies to" htmlFor="blackout-studio">
        <SimpleSelect
          id="blackout-studio"
          value={v.studioId}
          onValueChange={(x) => set("studioId", x)}
          options={(studios.data ?? []).map((s) => ({
            value: s.id,
            label: s.name,
          }))}
          allLabel="All studios"
          placeholder="Choose a studio"
        />
      </LabeledField>
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledField label="Starts (day)" htmlFor="blackout-start-day">
          <DatePicker
            id="blackout-start-day"
            value={v.startDay}
            onChange={(x) => set("startDay", x)}
          />
        </LabeledField>
        <LabeledField label="Starts (time)" htmlFor="blackout-start-time">
          <TimeSelect
            id="blackout-start-time"
            value={v.startTime}
            step={30}
            onChange={(x) => set("startTime", x)}
          />
        </LabeledField>
        <LabeledField label="Ends (day)" htmlFor="blackout-end-day">
          <DatePicker
            id="blackout-end-day"
            value={v.endDay}
            min={v.startDay || undefined}
            onChange={(x) => set("endDay", x)}
          />
        </LabeledField>
        <LabeledField
          label="Ends (time)"
          htmlFor="blackout-end-time"
          error={
            badRange ? "The blackout must end after it starts." : undefined
          }
        >
          <TimeSelect
            id="blackout-end-time"
            value={v.endTime}
            step={30}
            invalid={badRange}
            onChange={(x) => set("endTime", x)}
          />
        </LabeledField>
      </div>
      <TextAreaField
        id="blackout-reason"
        label="Reason"
        value={v.reason}
        onChange={(x) => set("reason", x)}
        description="Required."
      />
    </FormDialog>
  )
}
