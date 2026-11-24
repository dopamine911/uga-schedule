import type { StageStatus } from "@studio/domain"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ActivityIcon,
  BanIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  CheckIcon,
  FileTextIcon,
  HandIcon,
  InfoIcon,
  ListTodoIcon,
  type LucideIcon,
  MapPinIcon,
  PackageCheckIcon,
  PackageIcon,
  PackageOpenIcon,
  PencilIcon,
  SearchCheckIcon,
  ShieldAlertIcon,
  UserCheckIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import { EquipmentClassIcon } from "@/components/EquipmentClassIcon"
import {
  EmptyState,
  IconTitle,
  PageHeader,
  QueryView,
  StateBadge,
} from "@/components/common"
import {
  type DialogField,
  type EventDetail,
  LifecycleStepper,
  ReviewBadges,
  TextActionDialog,
  useInvalidateEvent,
} from "@/components/events/shared"
import { SubmitDialog } from "@/components/events/SubmitDialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { ApiError, api, unwrap } from "@/lib/api"
import { useTz, useUser } from "@/lib/auth"
import {
  fmtDay,
  fmtDays,
  fmtInstant,
  fmtRelative,
  fmtTime,
  humanize,
} from "@/lib/format"
import { eventTypeIcon } from "@/lib/icons"

// F-006 event page. Every action button is driven by the API `can` flags; the API enforces them again.

export function EventDetailPage() {
  const { id } = useParams()
  const query = useQuery({
    queryKey: ["event", id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id: id! } })),
    enabled: !!id,
  })
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <>
        <PageHeader title="Request not found" />
        <EmptyState
          icon={CalendarDaysIcon}
          title="We couldn't find that request"
          description="It may have been removed, or you may not have access to it."
        />
      </>
    )
  }
  return (
    <QueryView query={query} rows={5}>
      {(ev) => <EventDetailView ev={ev} />}
    </QueryView>
  )
}

function EventDetailView({ ev }: { ev: EventDetail }) {
  const tz = useTz()
  const me = useUser()
  const invalidate = useInvalidateEvent()
  const mine = ev.requester.id === me.id
  const isSponsor = ev.sponsor?.id === me.id
  const overrideCodes = ev.overrideRequested

  const act = async (label: string, run: () => Promise<unknown>) => {
    await run()
    await invalidate(ev.id)
    toast.success(label)
  }

  const cancelFields: DialogField[] = [
    {
      name: "reason",
      label: "Reason",
      required: !(mine || isSponsor),
      description:
        mine || isSponsor
          ? undefined
          : "Required when you cancel someone else's request.",
    },
  ]
  const staffFields: DialogField[] = [
    { name: "note", label: "Note to the requester", required: false },
    ...(overrideCodes.length
      ? [
          {
            name: "overrideReason",
            label: "Reason for the policy exception",
            required: true,
            description: `Approves: ${overrideCodes.map(humanize).join(", ")}.`,
          } satisfies DialogField,
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        icon={eventTypeIcon(ev.eventType.name)}
        title={ev.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StateBadge state={ev.state} />
            <ReviewBadges
              needsReview={ev.needsReview}
              reviewReasons={ev.reviewReasons}
              overrideRequested={ev.overrideRequested}
            />
            {ev.nextAction && <span>Next: {ev.nextAction}</span>}
          </span>
        }
        actions={
          <>
            {ev.can.edit && (
              <Button variant="outline" asChild>
                <Link to={`/events/${ev.id}/edit`}>
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Link>
              </Button>
            )}
            {ev.can.submit && <SubmitDialog ev={ev} />}
            {ev.can.sponsorDecide && (
              <>
                <TextActionDialog
                  trigger={
                    <Button>
                      <CheckIcon data-icon="inline-start" />
                      Approve
                    </Button>
                  }
                  title="Approve request"
                  description="Studio staff confirm the booking after you approve."
                  fields={[{ name: "note", label: "Note", required: false }]}
                  confirmLabel="Approve"
                  onSubmit={(v) =>
                    act("Approved", () =>
                      unwrap(
                        api.events[":id"]["sponsor-decision"].$post({
                          param: { id: ev.id },
                          json: { decision: "approve", note: v.note ?? "" },
                        })
                      )
                    )
                  }
                />
                <TextActionDialog
                  trigger={
                    <Button variant="destructive">
                      <XIcon data-icon="inline-start" />
                      Reject
                    </Button>
                  }
                  title="Reject request"
                  fields={[{ name: "note", label: "Reason", required: true }]}
                  confirmLabel="Reject"
                  destructive
                  onSubmit={(v) =>
                    act("Rejected", () =>
                      unwrap(
                        api.events[":id"]["sponsor-decision"].$post({
                          param: { id: ev.id },
                          json: { decision: "reject", note: v.note ?? "" },
                        })
                      )
                    )
                  }
                />
              </>
            )}
            {ev.can.staffDecide && (
              <>
                <TextActionDialog
                  trigger={
                    <Button>
                      <CalendarCheckIcon data-icon="inline-start" />
                      Confirm
                    </Button>
                  }
                  title="Confirm booking"
                  description="Confirming holds the studio and opens the pre-event tasks."
                  fields={staffFields}
                  confirmLabel="Confirm"
                  onSubmit={(v) =>
                    act("Confirmed", () =>
                      unwrap(
                        api.events[":id"]["staff-decision"].$post({
                          param: { id: ev.id },
                          json: {
                            decision: "confirm",
                            note: v.note ?? "",
                            overrideReason: v.overrideReason || undefined,
                          },
                        })
                      )
                    )
                  }
                >
                  {overrideCodes.length > 0 && (
                    <Alert>
                      <AlertTitle>
                        Exception requested by the student
                      </AlertTitle>
                      <AlertDescription>
                        <p>
                          {ev.overrideJustification ||
                            "No justification given."}
                        </p>
                        <p className="text-muted-foreground">
                          {overrideCodes.map(humanize).join(", ")}
                        </p>
                      </AlertDescription>
                    </Alert>
                  )}
                </TextActionDialog>
                <TextActionDialog
                  trigger={
                    <Button variant="destructive">
                      <XIcon data-icon="inline-start" />
                      Reject
                    </Button>
                  }
                  title="Reject request"
                  fields={[{ name: "note", label: "Reason", required: true }]}
                  confirmLabel="Reject"
                  destructive
                  onSubmit={(v) =>
                    act("Rejected", () =>
                      unwrap(
                        api.events[":id"]["staff-decision"].$post({
                          param: { id: ev.id },
                          json: { decision: "reject", note: v.note ?? "" },
                        })
                      )
                    )
                  }
                />
              </>
            )}
            {ev.can.resolveReview && (
              <TextActionDialog
                trigger={
                  <Button variant="outline">
                    <SearchCheckIcon data-icon="inline-start" />
                    Resolve review
                  </Button>
                }
                title="Accept request as-is"
                description={`Flagged: ${ev.reviewReasons.map(humanize).join(", ")}.`}
                fields={[{ name: "reason", label: "Reason", required: true }]}
                confirmLabel="Accept"
                onSubmit={(v) =>
                  act("Review resolved", () =>
                    unwrap(
                      api.events[":id"]["resolve-review"].$post({
                        param: { id: ev.id },
                        json: { reason: v.reason ?? "" },
                      })
                    )
                  )
                }
              />
            )}
            {ev.can.cancel && (
              <TextActionDialog
                trigger={
                  <Button variant="outline">
                    <BanIcon data-icon="inline-start" />
                    Cancel request
                  </Button>
                }
                title="Cancel request"
                description="Cancelling releases the studio and equipment."
                fields={cancelFields}
                confirmLabel="Cancel request"
                destructive
                onSubmit={(v) =>
                  act("Cancelled", () =>
                    unwrap(
                      api.events[":id"].cancel.$post({
                        param: { id: ev.id },
                        json: { reason: v.reason ?? "" },
                      })
                    )
                  )
                }
              />
            )}
            {ev.can.checkout && (
              <Button variant="outline" asChild>
                <Link to={`/events/${ev.id}/checkout`}>
                  <PackageOpenIcon data-icon="inline-start" />
                  Check out
                </Link>
              </Button>
            )}
            {ev.can.checkin && (
              <Button variant="outline" asChild>
                <Link to={`/events/${ev.id}/checkin`}>
                  <PackageCheckIcon data-icon="inline-start" />
                  Check in
                </Link>
              </Button>
            )}
            {ev.resultPackage && (
              <Button variant="outline" asChild>
                <Link to={`/results/${ev.id}`}>
                  <FileTextIcon data-icon="inline-start" />
                  Results
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={ActivityIcon}>Lifecycle</IconTitle>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LifecycleStepper state={ev.state} />
        </CardContent>
      </Card>

      {ev.needsReview && (
        <Alert variant="destructive">
          <AlertTitle>Needs review</AlertTitle>
          <AlertDescription>
            Something changed that affects this request:{" "}
            {ev.reviewReasons.map(humanize).join(", ")}. Studio staff must
            review it before it can go ahead.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <IconTitle icon={InfoIcon}>Details</IconTitle>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              <DetailLabel icon={eventTypeIcon(ev.eventType.name)}>
                Type
              </DetailLabel>
              <dd>{ev.eventType.name}</dd>
              <DetailLabel icon={MapPinIcon}>Studio</DetailLabel>
              <dd>
                {ev.studio.name}
                {ev.studio.location ? ` · ${ev.studio.location}` : ""}
              </dd>
              <DetailLabel icon={UserIcon}>Requester</DetailLabel>
              <dd>{ev.requester.displayName}</dd>
              <DetailLabel icon={UserCheckIcon}>Sponsor</DetailLabel>
              <dd>{ev.sponsor?.displayName ?? "—"}</dd>
              <DetailLabel icon={UsersIcon}>Participants</DetailLabel>
              <dd>
                {ev.participants.length
                  ? ev.participants.map((p) => p.displayName).join(", ")
                  : "None"}
              </dd>
              {ev.description && (
                <>
                  <dt className="text-muted-foreground">Description</dt>
                  <dd className="whitespace-pre-wrap">{ev.description}</dd>
                </>
              )}
              {ev.decisionNote && (
                <>
                  <dt className="text-muted-foreground">Decision note</dt>
                  <dd className="whitespace-pre-wrap">{ev.decisionNote}</dd>
                </>
              )}
              {ev.overrideJustification && (
                <>
                  <dt className="text-muted-foreground">
                    Exception justification
                  </dt>
                  <dd className="whitespace-pre-wrap">
                    {ev.overrideJustification}
                  </dd>
                </>
              )}
              {ev.cancelReason && (
                <>
                  <dt className="text-muted-foreground">Cancelled because</dt>
                  <dd className="whitespace-pre-wrap">{ev.cancelReason}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <IconTitle icon={CalendarDaysIcon}>Days</IconTitle>
            </CardTitle>
            <CardDescription>{fmtDays(ev.days)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ev.days.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell>{fmtDay(d.day)}</TableCell>
                    <TableCell>
                      {fmtTime(d.startTime)}–{fmtTime(d.endTime)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={PackageIcon}>Equipment</IconTitle>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ev.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No equipment requested.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ev.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <EquipmentClassIcon name={l.className} size="sm" />
                        {l.typeName}
                      </span>
                    </TableCell>
                    <TableCell>{l.className}</TableCell>
                    <TableCell>{humanize(l.tracking)}</TableCell>
                    <TableCell className="text-right">{l.qty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={ListTodoIcon}>Pre-event tasks</IconTitle>
          </CardTitle>
          <CardDescription>
            Reminders and tasks that run before the event. Blocking tasks must
            be done before checkout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ev.stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tasks for this event type.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ev.stages.map((s) => (
                  <StageRow
                    key={s.id}
                    stage={s}
                    tz={tz}
                    canComplete={ev.can.completeTask.includes(s.id)}
                    canOverride={ev.can.overrideTask.includes(s.id)}
                    onChanged={() => invalidate(ev.id)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={PackageCheckIcon}>Checkouts</IconTitle>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ev.checkouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing checked out yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset tag</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Returned</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ev.checkouts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.typeName}</TableCell>
                    <TableCell>{c.assetTag ?? "—"}</TableCell>
                    <TableCell>{c.qty}</TableCell>
                    <TableCell>{fmtInstant(c.outAt, tz)}</TableCell>
                    <TableCell>{fmtInstant(c.dueAt, tz)}</TableCell>
                    <TableCell>
                      {c.inAt ? fmtInstant(c.inAt, tz) : "—"}
                    </TableCell>
                    <TableCell>
                      {c.conditionIn ? humanize(c.conditionIn) : "—"}
                    </TableCell>
                    <TableCell className="flex flex-wrap gap-1">
                      {c.outstanding > 0 ? (
                        <Badge variant="outline">{c.outstanding} out</Badge>
                      ) : (
                        <Badge variant="secondary">Returned</Badge>
                      )}
                      {c.late && <Badge variant="destructive">Late</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {ev.holds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <IconTitle icon={HandIcon}>Holds</IconTitle>
            </CardTitle>
            <CardDescription>
              Holds linked to this request. An active hold blocks new requests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Placed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ev.holds.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{humanize(h.reason)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          h.status === "active" ? "destructive" : "outline"
                        }
                      >
                        {humanize(h.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{h.note}</TableCell>
                    <TableCell>{fmtInstant(h.createdAt, tz)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {ev.policyOverrides.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <IconTitle icon={ShieldAlertIcon}>Policy overrides</IconTitle>
            </CardTitle>
            <CardDescription>Exceptions approved by staff.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {ev.policyOverrides.map((o) => (
                <li key={o.id} className="flex flex-col">
                  <span className="font-medium">{humanize(o.ruleCode)}</span>
                  <span className="text-muted-foreground">
                    {o.reason} · {fmtInstant(o.at, tz)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}

function DetailLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: string
}) {
  return (
    <dt className="flex items-center gap-1.5 text-muted-foreground">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </dt>
  )
}

type Stage = EventDetail["stages"][number]

function StageRow({
  stage,
  tz,
  canComplete,
  canOverride,
  onChanged,
}: {
  stage: Stage
  tz: string
  canComplete: boolean
  canOverride: boolean
  onChanged: () => Promise<unknown>
}) {
  const complete = useMutation({
    mutationFn: () =>
      unwrap(api.stages[":id"].complete.$post({ param: { id: stage.id } })),
    onSuccess: async () => {
      await onChanged()
      toast.success("Task completed")
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not complete the task."
      ),
  })
  const open = stage.status === "open" || stage.status === "overdue"
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{stage.name}</span>
          {stage.assigneeRole && (
            <span className="text-xs text-muted-foreground">
              For {humanize(stage.assigneeRole)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{humanize(stage.kind)}</Badge>
        {stage.blocksCheckout && (
          <Badge variant="destructive" className="ml-1">
            Blocks checkout
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {fmtInstant(stage.dueAt, tz)}
        <span className="block text-xs text-muted-foreground">
          {fmtRelative(stage.dueAt)}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={STAGE_TONE[stage.status]}>
          {humanize(stage.status)}
        </Badge>
        {stage.overrideReason && (
          <span className="block text-xs text-muted-foreground">
            Override: {stage.overrideReason}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          {canComplete && (
            <Button
              size="sm"
              variant="outline"
              disabled={complete.isPending}
              onClick={() => complete.mutate()}
            >
              Complete
            </Button>
          )}
          {canOverride && open && (
            <TextActionDialog
              trigger={
                <Button size="sm" variant="destructive">
                  Override
                </Button>
              }
              title="Override blocking task"
              description={`Checkout will be allowed without “${stage.name}” being done. Your reason is recorded.`}
              fields={[{ name: "reason", label: "Reason", required: true }]}
              confirmLabel="Override"
              destructive
              onSubmit={async (v) => {
                await unwrap(
                  api.stages[":id"].override.$post({
                    param: { id: stage.id },
                    json: { reason: v.reason ?? "" },
                  })
                )
                await onChanged()
                toast.success("Task overridden")
              }}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Stage status colour: blue planned, amber needs doing, teal done, red late, neutral skipped/cancelled. */
const STAGE_TONE: Record<
  StageStatus,
  "info" | "warning" | "success" | "destructive" | "neutral"
> = {
  scheduled: "info",
  open: "warning",
  sent: "success",
  done: "success",
  overridden: "neutral",
  overdue: "destructive",
  skipped: "neutral",
  cancelled: "neutral",
}
