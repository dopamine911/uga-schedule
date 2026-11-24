import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  CalendarCheckIcon,
  CheckIcon,
  ListChecksIcon,
  type LucideIcon,
  SearchCheckIcon,
  UserCheckIcon,
  XIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router"
import {
  EmptyState,
  ErrorAlert,
  IconTitle,
  LoadingBlock,
  PageHeader,
  StateBadge,
} from "@/components/common"
import {
  type DialogField,
  type EventSummary,
  TextActionDialog,
  useInvalidateEvent,
} from "@/components/events/shared"
import { useNow } from "@/components/staff/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { api, unwrap } from "@/lib/api"
import { useHasRole, useTz } from "@/lib/auth"
import { fmtDays, fmtInstant, fmtRelative, humanize } from "@/lib/format"
import { toast } from "sonner"

export function ApprovalsPage() {
  const hasRole = useHasRole()
  const isSponsor = hasRole("SPONSOR")
  const isStaff = hasRole("STUDIO_STAFF", "EQUIPMENT_MANAGER", "ADMIN")
  const sponsoring = useQuery({
    queryKey: ["events", "approvals", "sponsoring"],
    queryFn: () =>
      unwrap(
        api.events.$get({ query: { scope: "sponsoring", state: "Submitted" } })
      ),
    enabled: isSponsor,
  })
  const awaitingStaff = useQuery({
    queryKey: ["events", "approvals", "staff"],
    queryFn: () =>
      unwrap(
        api.events.$get({
          query: { scope: "studio", state: "SponsorApproved" },
        })
      ),
    enabled: isStaff,
  })
  const review = useQuery({
    queryKey: ["events", "approvals", "review"],
    queryFn: () => unwrap(api.events.$get({ query: { scope: "studio" } })),
    enabled: isStaff,
    select: (rows) => rows.filter((r) => r.needsReview),
  })
  const now = useNow()
  const tz = useTz()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        description="Requests waiting for a decision from you."
      />
      {isSponsor && (
        <Section
          icon={UserCheckIcon}
          title="Awaiting your sponsor decision"
          empty="No requests are waiting for your sponsor decision."
          query={sponsoring}
          render={(ev) => (
            <ApprovalRow key={ev.id} ev={ev} kind="sponsor" now={now} tz={tz} />
          )}
        />
      )}
      {isStaff && (
        <>
          <Section
            icon={CalendarCheckIcon}
            title="Awaiting staff confirmation"
            empty="No sponsor-approved requests are waiting for confirmation."
            query={awaitingStaff}
            render={(ev) => (
              <ApprovalRow key={ev.id} ev={ev} kind="staff" now={now} tz={tz} />
            )}
          />
          <Section
            icon={SearchCheckIcon}
            title="Needs review"
            empty="No confirmed requests are flagged for review."
            query={review}
            render={(ev) => (
              <ApprovalRow
                key={ev.id}
                ev={ev}
                kind="review"
                now={now}
                tz={tz}
              />
            )}
          />
        </>
      )}
    </div>
  )
}

function Section({
  title,
  icon,
  empty,
  query,
  render,
}: {
  title: string
  icon: LucideIcon
  empty: string
  query: UseQueryResult<EventSummary[]>
  render: (ev: EventSummary) => ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={icon}>{title}</IconTitle>
        </CardTitle>
        <CardDescription>Oldest first.</CardDescription>
        {query.data && (
          <CardAction>
            <Badge variant="secondary">{query.data.length}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.error ? (
          <ErrorAlert error={query.error} />
        ) : query.isPending ? (
          <LoadingBlock rows={2} />
        ) : query.data.length > 0 ? (
          query.data.map(render)
        ) : (
          <EmptyState
            icon={ListChecksIcon}
            title="Nothing to do"
            description={empty}
          />
        )}
      </CardContent>
    </Card>
  )
}

function ApprovalRow({
  ev,
  kind,
  now,
  tz,
}: {
  ev: EventSummary
  kind: "sponsor" | "staff" | "review"
  now: number
  tz: string
}) {
  const invalidate = useInvalidateEvent()
  // The list omits submission time, overrides and equipment, so each row loads its detail.
  const detail = useQuery({
    queryKey: ["event", ev.id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id: ev.id } })),
  })
  const d = detail.data
  const lines = d?.lines ?? []
  const totalQty = lines.reduce((n, l) => n + l.qty, 0)
  const overrides = d?.overrideRequested ?? []

  const sponsorDecide = async (
    note: string,
    decision: "approve" | "reject"
  ) => {
    await unwrap(
      api.events[":id"]["sponsor-decision"].$post({
        param: { id: ev.id },
        json: { decision, note },
      })
    )
    toast.success(
      decision === "approve"
        ? `Approved “${ev.title}”`
        : `Rejected “${ev.title}”`
    )
    await invalidate(ev.id)
  }

  const staffConfirm = async (values: Record<string, string>) => {
    await unwrap(
      api.events[":id"]["staff-decision"].$post({
        param: { id: ev.id },
        json: {
          decision: "confirm",
          note: values.note ?? "",
          overrideReason: values.overrideReason ?? "",
        },
      })
    )
    toast.success(`Confirmed “${ev.title}”`)
    await invalidate(ev.id)
  }

  const staffReject = async (values: Record<string, string>) => {
    await unwrap(
      api.events[":id"]["staff-decision"].$post({
        param: { id: ev.id },
        json: { decision: "reject", note: values.note ?? "" },
      })
    )
    toast.success(`Rejected “${ev.title}”`)
    await invalidate(ev.id)
  }

  const resolveReview = async (values: Record<string, string>) => {
    await unwrap(
      api.events[":id"]["resolve-review"].$post({
        param: { id: ev.id },
        json: { reason: values.reason ?? "" },
      })
    )
    toast.success(`Review resolved for “${ev.title}”`)
    await invalidate(ev.id)
  }

  const confirmFields: DialogField[] = [
    { name: "note", label: "Note to requester", placeholder: "Optional" },
    ...(overrides.length
      ? [
          {
            name: "overrideReason",
            label: "Override reason",
            required: true,
            description: `Required to approve the requested exceptions: ${overrides.map(humanize).join(", ")}.`,
          } satisfies DialogField,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to={`/events/${ev.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {ev.title}
          </Link>
          <p className="text-sm text-muted-foreground">
            {ev.requester.displayName} · {ev.studio.name} · {ev.eventType.name}
          </p>
          <p className="text-sm">{fmtDays(ev.days)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={ev.state} />
          {ev.needsReview && <Badge variant="destructive">Needs review</Badge>}
          {ev.reviewReasons.map((r) => (
            <Badge key={r} variant="outline">
              {humanize(r)}
            </Badge>
          ))}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
        <div className="flex gap-2">
          <dt>Equipment:</dt>
          <dd>
            {detail.isPending
              ? "Loading…"
              : lines.length
                ? `${lines.length} line${lines.length === 1 ? "" : "s"}, ${totalQty} item${totalQty === 1 ? "" : "s"}`
                : "None"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>Submitted:</dt>
          <dd>
            {d?.submittedAt
              ? `${fmtRelative(d.submittedAt, now)} (${fmtInstant(d.submittedAt, tz)})`
              : "—"}
          </dd>
        </div>
        {ev.sponsor && (
          <div className="flex gap-2">
            <dt>Sponsor:</dt>
            <dd>{ev.sponsor.displayName}</dd>
          </div>
        )}
      </dl>

      {overrides.length > 0 && (
        <Alert>
          <AlertTitle>
            Override requested: {overrides.map(humanize).join(", ")}
          </AlertTitle>
          <AlertDescription>
            {d?.overrideJustification
              ? `Justification: ${d.overrideJustification}`
              : "No justification given."}
          </AlertDescription>
        </Alert>
      )}
      {detail.error && <ErrorAlert error={detail.error} />}

      <div className="flex flex-wrap items-center gap-2">
        {kind === "sponsor" && d?.can.sponsorDecide && (
          <>
            <TextActionDialog
              trigger={
                <Button>
                  <CheckIcon data-icon="inline-start" />
                  Approve
                </Button>
              }
              title="Approve request"
              description="Studio staff will be asked to confirm."
              fields={[
                { name: "note", label: "Note", placeholder: "Optional" },
              ]}
              confirmLabel="Approve"
              onSubmit={(v) => sponsorDecide(v.note ?? "", "approve")}
            />
            <TextActionDialog
              trigger={
                <Button variant="outline">
                  <XIcon data-icon="inline-start" />
                  Reject
                </Button>
              }
              title="Reject request"
              description="The requester and sponsor are notified with your reason."
              fields={[{ name: "note", label: "Reason", required: true }]}
              confirmLabel="Reject"
              destructive
              onSubmit={(v) => sponsorDecide(v.note ?? "", "reject")}
            />
          </>
        )}
        {kind === "staff" && d?.can.staffDecide && (
          <>
            <TextActionDialog
              trigger={
                <Button>
                  <CalendarCheckIcon data-icon="inline-start" />
                  Confirm
                </Button>
              }
              title="Confirm request"
              description={
                overrides.length
                  ? "This request has exceptions. Your reason is recorded as a policy override."
                  : "The requester is notified that the booking is confirmed."
              }
              fields={confirmFields}
              confirmLabel="Confirm"
              onSubmit={staffConfirm}
            />
            <TextActionDialog
              trigger={
                <Button variant="outline">
                  <XIcon data-icon="inline-start" />
                  Reject
                </Button>
              }
              title="Reject request"
              description="The requester and sponsor are notified with your reason."
              fields={[{ name: "note", label: "Reason", required: true }]}
              confirmLabel="Reject"
              destructive
              onSubmit={staffReject}
            />
          </>
        )}
        {kind === "review" && d?.can.resolveReview && (
          <TextActionDialog
            trigger={
              <Button variant="outline">
                <SearchCheckIcon data-icon="inline-start" />
                Resolve review
              </Button>
            }
            title="Resolve review"
            description="Accept the request as-is. Record why the review flag is cleared."
            fields={[{ name: "reason", label: "Reason", required: true }]}
            confirmLabel="Resolve"
            onSubmit={resolveReview}
          />
        )}
        <Button variant="ghost" asChild>
          <Link to={`/events/${ev.id}`}>
            Open event
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
