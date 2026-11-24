import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarClockIcon,
  CalendarXIcon,
  DoorOpenIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  EmptyState,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import {
  BlackoutDialog,
  HoursDialog,
  StudioDialog,
} from "@/components/admin/StudioDialogs"
import {
  LabeledField,
  NONE,
  type StudioSummary,
  SimpleSelect,
  useStudios,
} from "@/components/admin/pickers"
import {
  ConfirmButton,
  RequirePerm,
  StatusBadge,
} from "@/components/admin/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, unwrap } from "@/lib/api"
import { useCan, useTz } from "@/lib/auth"
import { fmtInstant } from "@/lib/format"

export function StudiosPage() {
  return (
    <RequirePerm perm="studio.manage" title="Studios">
      <StudiosContent />
    </RequirePerm>
  )
}

function StudiosContent() {
  const can = useCan()
  const studios = useStudios()
  const [editing, setEditing] = useState<StudioSummary | "new" | null>(null)
  const [hoursFor, setHoursFor] = useState<StudioSummary | null>(null)
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Studios"
        description="Rooms and spaces that can be booked, their hours, and the periods they are closed."
        actions={
          can("studio.manage") && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon data-icon="inline-start" />
              New studio
            </Button>
          )
        }
      />

      <QueryView query={studios}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              icon={DoorOpenIcon}
              title="No studios"
              description="Create a studio to make space bookable."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Min level</TableHead>
                    <TableHead className="text-right">Turnaround</TableHead>
                    <TableHead className="text-right">Granularity</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-44" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.location || "—"}</TableCell>
                      <TableCell>{s.minLevel.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.turnaroundMinutes} min
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.slotGranularityMinutes} min
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {s.staff.length === 0 && (
                            <span className="text-sm text-muted-foreground">
                              None
                            </span>
                          )}
                          {s.staff.map((p) => (
                            <Badge key={p.id} variant="secondary">
                              {p.displayName}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {can("studio.manage") && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Opening hours for ${s.name}`}
                              onClick={() => setHoursFor(s)}
                            >
                              <CalendarClockIcon data-icon="inline-start" />
                              Hours
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Edit ${s.name}`}
                              onClick={() => setEditing(s)}
                            >
                              <PencilIcon data-icon="inline-start" />
                              Edit
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryView>

      <BlackoutsCard studios={studios.data ?? []} />

      {editing !== null && (
        <StudioDialog
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {hoursFor && (
        <HoursDialog
          studio={hoursFor}
          hours={hoursFor.openingHours}
          onClose={() => setHoursFor(null)}
        />
      )}
    </div>
  )
}

function BlackoutsCard({ studios }: { studios: readonly StudioSummary[] }) {
  const can = useCan()
  const tz = useTz()
  const qc = useQueryClient()
  const [picked, setPicked] = useState("")
  const [adding, setAdding] = useState(false)
  const selected = picked || studios[0]?.id || ""
  const detail = useQuery({
    queryKey: ["studios", "detail", selected],
    queryFn: () => unwrap(api.studios[":id"].$get({ param: { id: selected } })),
    enabled: !!selected,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.studios.blackouts[":id"].$delete({ param: { id } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["studios"] })
      toast.success("Blackout removed.")
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not remove the blackout."
      ),
  })
  const nameOf = new Map(studios.map((s) => [s.id, s.name]))

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>
            <IconTitle icon={CalendarXIcon}>Blackouts</IconTitle>
          </CardTitle>
          <CardDescription>
            Periods a studio is closed. Global blackouts apply to every studio.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex w-56 flex-col gap-2">
            <LabeledField label="Studio" htmlFor="blackout-filter">
              <SimpleSelect
                id="blackout-filter"
                value={selected || NONE}
                onValueChange={setPicked}
                options={studios.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Choose a studio"
              />
            </LabeledField>
          </div>
          {can("studio.manage") && selected && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon data-icon="inline-start" />
              Add blackout
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <QueryView query={detail}>
          {(s) =>
            s.blackouts.length === 0 ? (
              <EmptyState
                icon={CalendarXIcon}
                title="No blackouts"
                description="Nothing closes this studio ahead of time."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Applies to</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.blackouts.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap">
                        {fmtInstant(b.start, tz)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fmtInstant(b.end, tz)}
                      </TableCell>
                      <TableCell>
                        {b.studioId
                          ? (nameOf.get(b.studioId) ?? s.name)
                          : "All studios"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {b.reason}
                      </TableCell>
                      <TableCell className="text-right">
                        {can("studio.manage") && (
                          <ConfirmButton
                            label={
                              <>
                                <Trash2Icon data-icon="inline-start" />
                                Delete
                              </>
                            }
                            title="Delete blackout?"
                            description="The studio opens for this period again. Events were only flagged, so nothing else changes."
                            confirmLabel="Delete blackout"
                            variant="ghost"
                            onConfirm={() => remove.mutate(b.id)}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </QueryView>
      </CardContent>
      {adding && (
        <BlackoutDialog
          studioId={selected || null}
          onClose={() => setAdding(false)}
        />
      )}
    </Card>
  )
}
