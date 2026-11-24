import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  CalendarCheckIcon,
  ListChecksIcon,
  type LucideIcon,
  SearchCheckIcon,
  UserCheckIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router"
import { NoAccess } from "@/components/admin/shared"
import {
  EmptyState,
  ErrorAlert,
  IconTitle,
  LoadingBlock,
  PageHeader,
  StateBadge,
  useNavAllowed,
} from "@/components/common"
import type { EventDetail, EventSummary } from "@/components/events/shared"
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
import {
  ReviewResolveAction,
  SponsorDecisionActions,
  StaffDecisionActions,
} from "./approvals/ApprovalActions"

/** Stands in for the event's action flags while its detail is loading. */
const NO_ACTIONS = {
  sponsorDecide: false,
  staffDecide: false,
  resolveReview: false,
}

export function ApprovalsPage() {
  const navAllowed = useNavAllowed()
  if (!navAllowed("/approvals")) return <NoAccess title="Approvals" />
  return <ApprovalsBody />
}

function ApprovalsBody() {
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
            empty="No requests are flagged for review."
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
  // The list omits submission time, overrides and equipment, so each row loads its detail.
  const detail = useQuery({
    queryKey: ["event", ev.id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id: ev.id } })),
  })
  const d = detail.data
  const overrides = d?.overrideRequested ?? []

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <ApprovalHeader ev={ev} />
      <ApprovalDetails
        ev={ev}
        d={d}
        loading={detail.isPending}
        now={now}
        tz={tz}
      />
      <OverrideNotice
        overrides={overrides}
        justification={d?.overrideJustification}
      />
      {detail.error && <ErrorAlert error={detail.error} />}
      <RowActions ev={ev} kind={kind} d={d} />
    </div>
  )
}

function ApprovalHeader({ ev }: { ev: EventSummary }) {
  return (
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
  )
}

function ApprovalDetails({
  ev,
  d,
  loading,
  now,
  tz,
}: {
  ev: EventSummary
  d: EventDetail | undefined
  loading: boolean
  now: number
  tz: string
}) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
      <EquipmentLine d={d} loading={loading} />
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
  )
}

function EquipmentLine({
  d,
  loading,
}: {
  d: EventDetail | undefined
  loading: boolean
}) {
  const lines = d?.lines ?? []
  const totalQty = lines.reduce((n, l) => n + l.qty, 0)
  return (
    <div className="flex gap-2">
      <dt>Equipment:</dt>
      <dd>
        {loading
          ? "Loading…"
          : lines.length
            ? `${lines.length} line${lines.length === 1 ? "" : "s"}, ${totalQty} item${totalQty === 1 ? "" : "s"}`
            : "None"}
      </dd>
    </div>
  )
}

function OverrideNotice({
  overrides,
  justification,
}: {
  overrides: string[]
  justification: string | null | undefined
}) {
  if (overrides.length === 0) return null
  return (
    <Alert>
      <AlertTitle>
        Override requested: {overrides.map(humanize).join(", ")}
      </AlertTitle>
      <AlertDescription>
        {justification
          ? `Justification: ${justification}`
          : "No justification given."}
      </AlertDescription>
    </Alert>
  )
}

function RowActions({
  ev,
  kind,
  d,
}: {
  ev: EventSummary
  kind: "sponsor" | "staff" | "review"
  d: EventDetail | undefined
}) {
  const can = d?.can ?? NO_ACTIONS
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kind === "sponsor" && can.sponsorDecide && (
        <SponsorDecisionActions ev={ev} />
      )}
      {kind === "staff" && can.staffDecide && (
        <StaffDecisionActions ev={ev} overrides={d?.overrideRequested ?? []} />
      )}
      {kind === "review" && can.resolveReview && <ReviewResolveAction ev={ev} />}
      <Button variant="ghost" asChild>
        <Link to={`/events/${ev.id}`}>
          Open event
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  )
}
