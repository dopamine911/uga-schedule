import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  PackageIcon,
  PackageOpenIcon,
} from "lucide-react"
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
import type { EventSummary } from "@/components/events/shared"
import {
  addDaysTo,
  campusDay,
  checkoutQuery,
  useNow,
} from "@/components/staff/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { api, unwrap } from "@/lib/api"
import { useHasRole, useTz } from "@/lib/auth"
import { fmtDays, fmtInstant, humanize } from "@/lib/format"

/** Desk queues: confirmed pickups for today and tomorrow, and events with equipment still out. Shared with the dashboard. */
export function useDeskQueues(enabled = true) {
  const hasRole = useHasRole()
  // Equipment managers and admins see every studio; studio staff see their own.
  const scope = hasRole("EQUIPMENT_MANAGER", "ADMIN") ? "all" : "studio"
  const tz = useTz()
  const now = useNow()
  const today = campusDay(now, tz)
  const tomorrow = addDaysTo(today, 1)

  const pickups = useQuery({
    queryKey: ["events", "desk", "confirmed", scope],
    queryFn: () =>
      unwrap(api.events.$get({ query: { scope, state: "Confirmed" } })),
    // Pickup opens before the first day; the server's checkout window is shown per row.
    select: (rows) =>
      rows.filter((r) => (r.days[0] ? r.days[0].day <= tomorrow : false)),
    enabled,
  })
  const returns = useQuery({
    queryKey: ["events", "desk", "out", scope],
    queryFn: async () => {
      const [inProgress, postEvent] = await Promise.all([
        unwrap(api.events.$get({ query: { scope, state: "InProgress" } })),
        unwrap(api.events.$get({ query: { scope, state: "PostEvent" } })),
      ])
      // The server's next action reads "Return equipment by …" only while items are outstanding.
      return [...inProgress, ...postEvent].filter((r) =>
        r.nextAction?.startsWith("Return equipment")
      )
    },
    enabled,
  })

  return { tz, now, pickups, returns }
}

export function DeskPage() {
  const navAllowed = useNavAllowed()
  if (!navAllowed("/desk")) return <NoAccess title="Equipment desk" />
  return <DeskBody />
}

function DeskBody() {
  const { tz, now, pickups, returns } = useDeskQueues()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Equipment desk"
        description="Check equipment out to requesters and back in."
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={PackageOpenIcon}>Pickups</IconTitle>
          </CardTitle>
          <CardDescription>
            Confirmed events starting today or tomorrow. Pickup opens before the
            first day.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pickups.error ? (
            <ErrorAlert error={pickups.error} />
          ) : pickups.isPending ? (
            <LoadingBlock rows={2} />
          ) : pickups.data.length === 0 ? (
            <EmptyState
              icon={CalendarDaysIcon}
              title="No pickups"
              description="No confirmed events start today or tomorrow."
            />
          ) : (
            pickups.data.map((ev) => (
              <PickupRow key={ev.id} ev={ev} now={now} tz={tz} />
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={PackageIcon}>Out now and returns</IconTitle>
          </CardTitle>
          <CardDescription>
            Events with equipment still out. Overdue items are highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {returns.error ? (
            <ErrorAlert error={returns.error} />
          ) : returns.isPending ? (
            <LoadingBlock rows={2} />
          ) : returns.data.length === 0 ? (
            <EmptyState
              icon={PackageIcon}
              title="Nothing out"
              description="No equipment is currently checked out."
            />
          ) : (
            returns.data.map((ev) => (
              <ReturnRow key={ev.id} ev={ev} now={now} tz={tz} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PickupRow({
  ev,
  now,
  tz,
}: {
  ev: EventSummary
  now: number
  tz: string
}) {
  const co = useQuery(checkoutQuery(ev.id))
  const blockers = co.data?.blockers ?? []
  const hard = blockers.filter((b) => !b.overridable)
  const soft = blockers.filter((b) => b.overridable)
  const opensAt = co.data?.window.opensAt
  const open = opensAt ? Date.parse(opensAt) <= now : false
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to={`/events/${ev.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {ev.title}
          </Link>
          <p className="text-sm text-muted-foreground">
            {ev.requester.displayName} · {ev.studio.name} · {fmtDays(ev.days)}
          </p>
          {opensAt && (
            <p className="text-sm">
              Pickup {open ? "open since" : "opens"} {fmtInstant(opensAt, tz)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={ev.state} />
          {hard.map((b) => (
            <Badge key={b.code} variant="destructive">
              {humanize(b.code)}
            </Badge>
          ))}
          {soft.length > 0 && (
            <Badge variant="secondary">
              {soft.length} task{soft.length === 1 ? "" : "s"} open
            </Badge>
          )}
        </div>
      </div>
      {co.error && <ErrorAlert error={co.error} />}
      <div className="flex justify-end">
        <Button asChild>
          <Link to={`/events/${ev.id}/checkout`}>
            Check out
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </div>
  )
}

function ReturnRow({
  ev,
  now,
  tz,
}: {
  ev: EventSummary
  now: number
  tz: string
}) {
  const co = useQuery(checkoutQuery(ev.id))
  const outstanding = co.data?.outstanding ?? []
  const overdue = outstanding.filter((r) => Date.parse(r.dueAt) < now)
  return (
    <div
      className={
        overdue.length
          ? "flex flex-col gap-2 rounded-lg border border-critical-solid/40 bg-critical p-4"
          : "flex flex-col gap-2 rounded-lg border p-4"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to={`/events/${ev.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {ev.title}
          </Link>
          <p className="text-sm text-muted-foreground">
            {ev.requester.displayName} · {ev.studio.name}
          </p>
          {co.isPending && (
            <p className="text-sm text-muted-foreground">Loading items…</p>
          )}
          {outstanding.length > 0 && (
            <ul className="text-sm">
              {outstanding.map((r) => (
                <li
                  key={r.recordId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span>
                    {r.assetTag
                      ? `${r.typeName} ${r.assetTag}`
                      : `${r.typeName} ×${r.outstanding}`}
                  </span>
                  <span
                    className={
                      Date.parse(r.dueAt) < now
                        ? "font-medium text-critical-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    due {fmtInstant(r.dueAt, tz)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={ev.state} />
          {overdue.length > 0 && (
            <Badge variant="destructive">
              <AlertTriangleIcon data-icon="inline-start" />
              Overdue
            </Badge>
          )}
        </div>
      </div>
      {co.error && <ErrorAlert error={co.error} />}
      <div className="flex justify-end">
        <Button variant={overdue.length ? "destructive" : "default"} asChild>
          <Link to={`/events/${ev.id}/checkin`}>
            Check in
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
