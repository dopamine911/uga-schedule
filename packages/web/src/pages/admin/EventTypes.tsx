import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FilmIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { StudioCheckboxes } from "@/components/admin/EventTypeParts"
import {
  TextAreaField,
  TextField,
  useEventTypes,
  useForm,
} from "@/components/admin/pickers"
import { FormDialog, RequirePerm, StatusBadge } from "@/components/admin/shared"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, unwrap } from "@/lib/api"
import { useCan } from "@/lib/auth"

export function EventTypesPage() {
  return (
    <RequirePerm perm="event_type.manage" title="Event types">
      <EventTypesContent />
    </RequirePerm>
  )
}

function EventTypesContent() {
  const can = useCan()
  const types = useEventTypes()
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Event types"
        description="What students can book: limits, who can use each type, and the reminders and tasks that run before the event."
        actions={
          can("event_type.manage") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              New event type
            </Button>
          )
        }
      />
      <QueryView query={types}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              icon={FilmIcon}
              title="No event types"
              description="Create one to let students book studio time."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Max days</TableHead>
                    <TableHead className="text-right">Hours per day</TableHead>
                    <TableHead>Allowed studios</TableHead>
                    <TableHead className="text-right">Stages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <Link
                          to={`/admin/event-types/${t.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {t.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={t.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.maxDays}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.maxHoursPerDay}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.allowedStudios.map((s) => s.name).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.stages.length}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryView>
      {creating && <CreateEventTypeDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function CreateEventTypeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [v, set] = useForm({
    name: "",
    description: "",
    allowedStudioIds: [] as string[],
  })
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api["event-types"].$post({
          json: {
            name: v.name.trim(),
            description: v.description.trim(),
            allowedStudioIds: v.allowedStudioIds,
          },
        })
      ),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["event-types"] })
      navigate(`/admin/event-types/${created.id}`)
    },
  })
  return (
    <FormDialog
      title="New event type"
      description="Next you'll set its limits and stage schedule."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Create and edit"
      submitDisabled={!v.name.trim() || v.allowedStudioIds.length === 0}
    >
      <TextField
        id="type-create-name"
        label="Name"
        value={v.name}
        onChange={(x) => set("name", x)}
        required
      />
      <TextAreaField
        id="type-create-description"
        label="Description"
        value={v.description}
        onChange={(x) => set("description", x)}
      />
      <StudioCheckboxes
        value={v.allowedStudioIds}
        onChange={(ids) => set("allowedStudioIds", ids)}
      />
    </FormDialog>
  )
}
