import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import { SettingsIcon, ListTodoIcon } from "lucide-react"
import {
  ErrorAlert,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import {
  type StageDraft,
  StageEditor,
  StudioCheckboxes,
  draftToPayload,
  stageToDraft,
} from "@/components/admin/EventTypeParts"
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
      {(type) => (
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
          <SettingsCard type={type} />
          <StagesCard type={type} />
        </div>
      )}
    </QueryView>
  )
}

const RUNNING_CONFLICT = "EVENT_TYPE_IN_USE"

function SettingsCard({ type }: { type: EventTypeDetail }) {
  const qc = useQueryClient()
  const can = useCan()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [v, set] = useForm({
    name: type.name,
    description: type.description,
    active: type.status === "active",
    maxDays: String(type.maxDays),
    maxHoursPerDay: String(type.maxHoursPerDay),
    dailyEquipmentReturn: type.dailyEquipmentReturn,
    pickupWindowMinutes: String(type.pickupWindowMinutes),
    checkinGraceMinutes: String(type.checkinGraceMinutes),
    requiresResults: type.requiresResults,
    resultsDueDays: String(type.resultsDueDays),
    requesterCanUpload: type.requesterCanUpload,
    requiresSponsorSignoff: type.requiresSponsorSignoff,
    allowedStudioIds: type.allowedStudios.map((s) => s.id),
  })

  const save = useMutation({
    mutationFn: (confirmRunningEvents: boolean) =>
      unwrap(
        api["event-types"][":id"].$patch({
          param: { id: type.id },
          json: {
            name: v.name.trim(),
            description: v.description.trim(),
            status: v.active ? "active" : "inactive",
            maxDays: Number(v.maxDays),
            maxHoursPerDay: Number(v.maxHoursPerDay),
            dailyEquipmentReturn: v.dailyEquipmentReturn,
            pickupWindowMinutes: Number(v.pickupWindowMinutes),
            checkinGraceMinutes: Number(v.checkinGraceMinutes),
            requiresResults: v.requiresResults,
            resultsDueDays: Number(v.resultsDueDays),
            requesterCanUpload: v.requesterCanUpload,
            requiresSponsorSignoff: v.requiresSponsorSignoff,
            allowedStudioIds: v.allowedStudioIds,
            confirmRunningEvents,
          },
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

  const numbers = [
    v.maxDays,
    v.maxHoursPerDay,
    v.pickupWindowMinutes,
    v.checkinGraceMinutes,
    v.resultsDueDays,
  ]
  const invalid =
    !v.name.trim() ||
    v.allowedStudioIds.length === 0 ||
    numbers.some(
      (n) => !Number.isInteger(Number(n)) || Number(n) < 0 || n === ""
    )
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
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              id="et-max-days"
              label="Max days"
              type="number"
              value={v.maxDays}
              onChange={(x) => set("maxDays", x)}
              disabled={!editable}
            />
            <TextField
              id="et-max-hours"
              label="Max hours per day"
              type="number"
              value={v.maxHoursPerDay}
              onChange={(x) => set("maxHoursPerDay", x)}
              disabled={!editable}
            />
            <TextField
              id="et-pickup"
              label="Pickup window (minutes)"
              type="number"
              value={v.pickupWindowMinutes}
              onChange={(x) => set("pickupWindowMinutes", x)}
              disabled={!editable}
              description="How long before the start a pickup may happen."
            />
            <TextField
              id="et-grace"
              label="Check-in grace (minutes)"
              type="number"
              value={v.checkinGraceMinutes}
              onChange={(x) => set("checkinGraceMinutes", x)}
              disabled={!editable}
            />
            <TextField
              id="et-results-days"
              label="Results due (days)"
              type="number"
              value={v.resultsDueDays}
              onChange={(x) => set("resultsDueDays", x)}
              disabled={!editable || !v.requiresResults}
              description="After the event ends."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SwitchField
              id="et-daily-return"
              label="Equipment returned daily"
              description="Equipment goes back at the end of each day instead of at the end of the event."
              checked={v.dailyEquipmentReturn}
              onCheckedChange={(x) => set("dailyEquipmentReturn", x)}
              disabled={!editable}
            />
            <SwitchField
              id="et-requires-results"
              label="Requires results"
              description="The requester must submit results after the event."
              checked={v.requiresResults}
              onCheckedChange={(x) => set("requiresResults", x)}
              disabled={!editable}
            />
            <SwitchField
              id="et-requester-upload"
              label="Requester can upload results"
              checked={v.requesterCanUpload}
              onCheckedChange={(x) => set("requesterCanUpload", x)}
              disabled={!editable}
            />
            <SwitchField
              id="et-signoff"
              label="Requires sponsor sign-off"
              description="A sponsor must sign off before the event is confirmed."
              checked={v.requiresSponsorSignoff}
              onCheckedChange={(x) => set("requiresSponsorSignoff", x)}
              disabled={!editable}
            />
          </div>
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
        <CardFooter className="justify-end">
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
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate with open events?</AlertDialogTitle>
            <AlertDialogDescription>
              {save.error instanceof ApiError
                ? save.error.message
                : "This type still has open events."}{" "}
              They keep running under the current version; no new bookings will
              be accepted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep active</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                save.mutate(true)
              }}
            >
              Deactivate anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function StagesCard({ type }: { type: EventTypeDetail }) {
  const qc = useQueryClient()
  const can = useCan()
  const [stages, setStages] = useState<StageDraft[]>(() =>
    type.stages.map(stageToDraft)
  )
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
        <CardFooter className="justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Spinner data-icon="inline-start" />}
            Save stages
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
