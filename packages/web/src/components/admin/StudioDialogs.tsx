import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { toastSaved } from "@/components/admin/formHelpers"
import { FormDialog } from "@/components/admin/shared"
import {
  studioDeactivating,
  studioFormValues,
  studioGranularityOk,
  studioPayload,
  studioSubmitDisabled,
  studioTurnaroundOk,
} from "@/components/admin/studioForm"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { api, unwrap } from "@/lib/api"

// Dialogs for the studios page: studio details, weekly opening hours, and blackout periods (F-004).

function DeactivateStudioDialog({
  open,
  onOpenChange,
  name,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name?: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            New requests for this studio are blocked. Open requests and events
            in it are flagged for review.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep active</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Deactivate studio
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function StudioDialog({
  initial,
  onClose,
}: {
  initial?: StudioSummary
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [confirmOff, setConfirmOff] = useState(false)
  const [v, set] = useForm(studioFormValues(initial))
  const turnaroundOk = studioTurnaroundOk(v)
  const granularityOk = studioGranularityOk(v)
  const deactivating = studioDeactivating(v, initial)
  const save = useMutation({
    mutationFn: async (): Promise<string[]> => {
      const json = studioPayload(v)
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
    <>
      <FormDialog
        title={initial ? `Edit ${initial.name}` : "New studio"}
        description="A higher minimum level or a deactivated studio re-checks its open events."
        onClose={onClose}
        onSubmit={() => (deactivating ? setConfirmOff(true) : save.mutate())}
        pending={save.isPending}
        error={save.error}
        submitDisabled={studioSubmitDisabled(v)}
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
            error={turnaroundOk ? undefined : "Enter 0 or more."}
          />
          <TextField
            id="studio-granularity"
            label="Slot granularity (minutes)"
            type="number"
            value={v.slotGranularityMinutes}
            onChange={(x) => set("slotGranularityMinutes", x)}
            description="Bookings start and end on multiples of this."
            error={granularityOk ? undefined : "Enter 1 or more."}
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
      <DeactivateStudioDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        name={initial?.name}
        onConfirm={() => save.mutate()}
      />
    </>
  )
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const

interface HoursWindow {
  opens: string
  closes: string
}

interface DayHours {
  open: boolean
  windows: HoursWindow[]
}

const DEFAULT_WINDOW: HoursWindow = { opens: "09:00", closes: "17:00" }

/** Why a day's windows can't be saved, or null. Each window ends after it starts; windows must not overlap. */
function windowProblem(windows: readonly HoursWindow[]): string | null {
  const sorted = [...windows].sort((a, b) => a.opens.localeCompare(b.opens))
  for (const w of sorted) {
    if (w.closes <= w.opens) return "Closing time must be after opening."
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.opens < sorted[i - 1]!.closes)
      return "Windows on the same day can't overlap."
  }
  return null
}

/** Weekly hours editor. Several windows per weekday are allowed (split days); PUT replaces every window of the studio. */
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
      const windows = hours
        .filter((h) => h.weekday === i)
        .map((h) => ({ opens: h.opens, closes: h.closes }))
      return {
        open: windows.length > 0,
        windows: windows.length > 0 ? windows : [DEFAULT_WINDOW],
      }
    })
  )
  const problems = days.map((d) => (d.open ? windowProblem(d.windows) : null))
  const invalid = problems.some((p) => p !== null)
  const editDay = (i: number, edit: (d: DayHours) => DayHours) =>
    setDays((prev) => prev.map((d, n) => (n === i ? edit(d) : d)))

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.studios[":id"].hours.$put({
          param: { id: studio.id },
          json: days.flatMap((d, weekday) =>
            d.open
              ? d.windows.map((w) => ({
                  weekday,
                  opens: w.opens,
                  closes: w.closes,
                }))
              : []
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
      description="Set one or more windows for each weekday, or mark it closed. Times are campus local time."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Save hours"
      submitDisabled={invalid}
      wide
    >
      <div className="flex flex-col gap-4">
        {WEEKDAYS.map((label, i) => {
          const d = days[i]!
          const problem = problems[i]
          return (
            <div key={label} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  id={`hours-${i}-open`}
                  checked={d.open}
                  onCheckedChange={(x) =>
                    editDay(i, (day) => ({
                      open: x,
                      windows:
                        day.windows.length > 0 ? day.windows : [DEFAULT_WINDOW],
                    }))
                  }
                  aria-label={`${label} open`}
                />
                <label
                  htmlFor={`hours-${i}-open`}
                  className="w-28 text-sm font-medium"
                >
                  {label}
                </label>
                {!d.open && (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </div>
              {d.open &&
                d.windows.map((w, n) => (
                  <div
                    key={n}
                    className="flex flex-wrap items-center gap-3 pl-10"
                  >
                    <TimeSelect
                      id={`hours-${i}-${n}-opens`}
                      aria-label={`${label} window ${n + 1} opens`}
                      value={w.opens}
                      step={30}
                      invalid={problem != null}
                      onChange={(x) =>
                        editDay(i, (day) => ({
                          ...day,
                          windows: day.windows.map((win, wi) =>
                            wi === n ? { ...win, opens: x } : win
                          ),
                        }))
                      }
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <TimeSelect
                      id={`hours-${i}-${n}-closes`}
                      aria-label={`${label} window ${n + 1} closes`}
                      value={w.closes}
                      step={30}
                      invalid={problem != null}
                      onChange={(x) =>
                        editDay(i, (day) => ({
                          ...day,
                          windows: day.windows.map((win, wi) =>
                            wi === n ? { ...win, closes: x } : win
                          ),
                        }))
                      }
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${label} window ${n + 1}`}
                      onClick={() =>
                        editDay(i, (day) => {
                          const windows = day.windows.filter(
                            (_, wi) => wi !== n
                          )
                          return { open: windows.length > 0, windows }
                        })
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
              {d.open && (
                <div className="flex flex-wrap items-center gap-3 pl-10">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Add ${label} window`}
                    onClick={() =>
                      editDay(i, (day) => ({
                        ...day,
                        windows: [...day.windows, DEFAULT_WINDOW],
                      }))
                    }
                  >
                    <PlusIcon data-icon="inline-start" />
                    Add window
                  </Button>
                  {problem && (
                    <span className="text-sm text-destructive">{problem}</span>
                  )}
                </div>
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
