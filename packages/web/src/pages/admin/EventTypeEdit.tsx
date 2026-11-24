import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link, useBlocker, useParams } from "react-router"
import { toast } from "sonner"
import { SettingsIcon, ListTodoIcon } from "lucide-react"
import {
  ErrorAlert,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import {
  StageEditor,
  StudioCheckboxes,
} from "@/components/admin/EventTypeParts"
import {
  type StageDraft,
  draftToPayload,
  stageToDraft,
} from "@/components/admin/stageDraft"
import {
  type EventTypeDetail,
  SwitchField,
  TextAreaField,
  TextField,
  useForm,
} from "@/components/admin/pickers"
import { RequirePerm, StatusBadge } from "@/components/admin/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { ApiError, api, unwrap } from "@/lib/api"
import { useCan } from "@/lib/auth"
import {
  type SetSettings,
  type SettingsForm,
  settingsFormFromType,
  settingsPayload,
  isSettingsInvalid,
} from "./eventTypeSettings"
import {
  DeactivateRunningDialog,
  SettingsLimitsGrid,
  SettingsSwitches,
} from "./EventTypeSettingsParts"

export function EventTypeEditPage() {
  return (
    <RequirePerm perm="event_type.manage" title="Event type">
      <EventTypeEditView />
    </RequirePerm>
  )
}

function EventTypeEditView() {
  const { id = "" } = useParams()
  const query = useQuery({
    queryKey: ["event-types", id],
    queryFn: () => unwrap(api["event-types"][":id"].$get({ param: { id } })),
  })
  return (
    <QueryView query={query}>
      {(type) => <EventTypeEditor type={type} />}
    </QueryView>
  )
}

interface SettingsState {
  v: SettingsForm
  set: SetSettings
  dirty: boolean
}

/** Settings form; the saved type is the baseline for "unsaved changes". */
function useSettingsForm(type: EventTypeDetail): SettingsState {
  const saved = settingsFormFromType(type)
  const [v, set] = useForm(saved)
  return { v, set, dirty: JSON.stringify(v) !== JSON.stringify(saved) }
}

interface StagesState {
  stages: StageDraft[]
  setStages: (next: StageDraft[]) => void
  dirty: boolean
}

function useStageDrafts(type: EventTypeDetail): StagesState {
  const [stages, setStages] = useState<StageDraft[]>(() =>
    type.stages.map(stageToDraft)
  )
  const dirty =
    JSON.stringify(stages.map(draftToPayload)) !==
    JSON.stringify(type.stages.map(stageToDraft).map(draftToPayload))
  return { stages, setStages, dirty }
}

/** Owns both forms, so it knows about unsaved edits without the cards reporting back. */
function EventTypeEditor({ type }: { type: EventTypeDetail }) {
  const settings = useSettingsForm(type)
  const stages = useStageDrafts(type)
  const anyDirty = settings.dirty || stages.dirty
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      anyDirty && currentLocation.pathname !== nextLocation.pathname
  )
  useEffect(() => {
    if (!anyDirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [anyDirty])

  return (
    <>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={type.name}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <Link
                to="/admin/event-types"
                className="underline-offset-4 hover:underline"
              >
                Event types
              </Link>
              <span aria-hidden>/</span>
              <StatusBadge status={type.status} />
            </span>
          }
        />
        <SettingsCard type={type} form={settings} />
        <StagesCard type={type} form={stages} />
      </div>
      {blocker.state === "blocked" && (
        <AlertDialog open onOpenChange={(o) => !o && blocker.reset()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave with unsaved changes?</AlertDialogTitle>
              <AlertDialogDescription>
                Changes to settings or the stage schedule that you haven't saved
                will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay on this page</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => blocker.proceed()}
              >
                Leave without saving
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}

const RUNNING_CONFLICT = "EVENT_TYPE_IN_USE"

function SettingsCard({
  type,
  form: { v, set, dirty },
}: {
  type: EventTypeDetail
  form: SettingsState
}) {
  const qc = useQueryClient()
  const can = useCan()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const save = useMutation({
    mutationFn: (confirmRunningEvents: boolean) =>
      unwrap(
        api["event-types"][":id"].$patch({
          param: { id: type.id },
          json: settingsPayload(v, confirmRunningEvents),
        })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-types"] })
      toast.success("Event type saved.")
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === RUNNING_CONFLICT)
        setConfirmOpen(true)
    },
  })

  const invalid = isSettingsInvalid(v)
  const editable = can("event_type.manage")

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={SettingsIcon}>Settings</IconTitle>
        </CardTitle>
        <CardDescription>
          Limits and rules students see when they request this type.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="event-type-settings"
          onSubmit={(e) => {
            e.preventDefault()
            if (!invalid) save.mutate(false)
          }}
          className="flex flex-col gap-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="et-name"
              label="Name"
              value={v.name}
              onChange={(x) => set("name", x)}
              required
              disabled={!editable}
            />
            <SwitchField
              id="et-active"
              label="Active"
              description="Inactive types can't take new bookings."
              checked={v.active}
              onCheckedChange={(x) => set("active", x)}
              disabled={!editable}
            />
          </div>
          <TextAreaField
            id="et-description"
            label="Description"
            value={v.description}
            onChange={(x) => set("description", x)}
            disabled={!editable}
          />
          <SettingsLimitsGrid v={v} set={set} editable={editable} />
          <SettingsSwitches v={v} set={set} editable={editable} />
          <StudioCheckboxes
            value={v.allowedStudioIds}
            onChange={(ids) => set("allowedStudioIds", ids)}
          />
          {save.error &&
            !(
              save.error instanceof ApiError &&
              save.error.code === RUNNING_CONFLICT
            ) && <ErrorAlert error={save.error} />}
        </form>
      </CardContent>
      {editable && (
        <CardFooter className="justify-end gap-3">
          {dirty && (
            <span role="status" className="text-sm text-muted-foreground">
              Unsaved changes
            </span>
          )}
          <Button
            type="submit"
            form="event-type-settings"
            disabled={save.isPending || invalid}
          >
            {save.isPending && <Spinner data-icon="inline-start" />}
            Save settings
          </Button>
        </CardFooter>
      )}
      <DeactivateRunningDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        message={
          save.error instanceof ApiError
            ? save.error.message
            : "This type still has open events."
        }
        onConfirm={() => {
          setConfirmOpen(false)
          save.mutate(true)
        }}
      />
    </Card>
  )
}

function StagesCard({
  type,
  form: { stages, setStages, dirty },
}: {
  type: EventTypeDetail
  form: StagesState
}) {
  const qc = useQueryClient()
  const can = useCan()
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api["event-types"][":id"].stages.$put({
          param: { id: type.id },
          json: stages.map(draftToPayload),
        })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-types"] })
      toast.success("Stage schedule saved.")
    },
  })
  const editable = can("event_type.manage")
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={ListTodoIcon}>Stage schedule</IconTitle>
        </CardTitle>
        <CardDescription>
          Reminders and tasks that run before the event. Tasks can block
          equipment checkout until someone completes them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Alert>
          <AlertTitle>Existing events keep their old schedule</AlertTitle>
          <AlertDescription>
            Saving replaces the schedule for new events only. Events already
            booked keep the stages they were booked with.
          </AlertDescription>
        </Alert>
        <StageEditor stages={stages} onChange={setStages} />
        {save.error && <ErrorAlert error={save.error} />}
      </CardContent>
      {editable && (
        <CardFooter className="justify-end gap-3">
          {dirty && (
            <span role="status" className="text-sm text-muted-foreground">
              Unsaved changes
            </span>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Spinner data-icon="inline-start" />}
            Save stages
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
