import type { RoleCode } from "@studio/domain"
import { BellIcon, CalendarDaysIcon, PlusIcon } from "lucide-react"
import { Link } from "react-router"
import {
  EmptyState,
  IconTitle,
  QueryView,
  StateBadge,
} from "@/components/common"
import { DateTile } from "@/components/events/DateTile"
import { usePeekLink } from "@/components/EventPeek"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { fmtDays, fmtInstant, firstName } from "@/lib/format"
import { cn } from "@/lib/utils"
import { primaryRole } from "@/lib/nav"
import { ROLE_INFO } from "@/lib/roles"
import {
  clearanceSentence,
  type EventSummary,
  greeting,
  type NotificationRow,
} from "@/pages/dashboard-data"
import { type QueueChip, TIER } from "@/pages/home/QueueSections"

// Sections of the home page that are not the work queue. DashboardPage composes them with the queue.

/**
 * Light page header: a chip naming the user's role, a sentence-case greeting, the clearance line,
 * and coloured count chips for the work queue. `chips` is undefined while the queue loads.
 */
export function DashboardHeader({
  now,
  tz,
  displayName,
  roles,
  level,
  canRequest,
  chips,
}: {
  now: number
  tz: string
  displayName: string
  roles: readonly RoleCode[]
  level: { name: string } | null | undefined
  canRequest: boolean
  chips: readonly QueueChip[] | undefined
}) {
  const role = primaryRole(roles)
  const RoleIcon = role ? ROLE_INFO[role].icon : null
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 border-b pb-6">
      <div className="flex min-w-0 flex-col gap-3">
        {role && RoleIcon && (
          <p className="flex w-fit items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm font-bold text-muted-foreground shadow-xs">
            <RoleIcon aria-hidden="true" className="size-3.5" />
            {roles.length > 1
              ? [...new Set(roles.map((r) => ROLE_INFO[r].label))].join(" · ")
              : ROLE_INFO[role].label}
          </p>
        )}
        <h1 className="text-4xl leading-tight font-medium md:text-5xl">
          {greeting(now, tz)}, {firstName(displayName)}
        </h1>
        {level && (
          <p className="text-muted-foreground">{clearanceSentence(level)}</p>
        )}
        {chips === undefined ? null : chips.length > 0 ? (
          <ul aria-label="Summary" className="flex flex-wrap gap-2">
            {chips.map((chip) => {
              const Icon = TIER[chip.severity].icon
              return (
                <li
                  key={chip.severity}
                  className={cn(
                    "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-bold",
                    TIER[chip.severity].panel
                  )}
                >
                  <span className="grid h-7 min-w-7 place-items-center rounded-full bg-card px-2 font-heading text-base font-medium tabular-nums">
                    {chip.value}
                  </span>
                  <Icon aria-hidden="true" className="size-4" />
                  {chip.label}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nothing needs you right now.</p>
        )}
      </div>
      {canRequest && (
        <Button asChild size="lg">
          <Link to="/events/new">
            <PlusIcon data-icon="inline-start" />
            Request studio time
          </Link>
        </Button>
      )}
    </header>
  )
}

/** Next five events the user requested, bookings, or sponsors. */
export function UpcomingEventsCard({
  query,
  isSponsor,
  canRequest,
}: {
  query: { data: EventSummary[]; error: unknown; isPending: boolean }
  isSponsor: boolean
  canRequest: boolean
}) {
  const peek = usePeekLink()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={CalendarDaysIcon}>Upcoming events</IconTitle>
        </CardTitle>
        <CardDescription>
          {isSponsor
            ? "Your next five requests, bookings and sponsored events."
            : "Your next five requests and bookings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryView query={query} rows={3}>
          {(upcoming) =>
            upcoming.length === 0 ? (
              <EmptyState
                title="Nothing coming up"
                description={
                  canRequest
                    ? "Requests you make will show here."
                    : "Events you request or sponsor will show here."
                }
              />
            ) : (
              <ul className="flex flex-col divide-y">
                {upcoming.map((e) => (
                  <li key={e.id} className="flex items-center gap-4 py-3">
                    {e.days[0] && <DateTile day={e.days[0].day} />}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link
                        to={peek(e.id)}
                        className="truncate font-bold underline-offset-4 hover:underline"
                      >
                        {e.title}
                      </Link>
                      <span className="text-sm text-muted-foreground">
                        {fmtDays(e.days)} · {e.studio.name}
                      </span>
                      {e.nextAction && (
                        <span className="text-xs text-muted-foreground">
                          Next: {e.nextAction}
                        </span>
                      )}
                    </div>
                    <StateBadge state={e.state} />
                  </li>
                ))}
              </ul>
            )
          }
        </QueryView>
      </CardContent>
    </Card>
  )
}

/** Unread messages, newest five. */
export function NotificationsCard({
  query,
  unread,
  tz,
}: {
  query: { data: unknown; error: unknown; isPending: boolean }
  unread: readonly NotificationRow[]
  tz: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={BellIcon}>Recent notifications</IconTitle>
        </CardTitle>
        <CardDescription>Unread messages.</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryView query={query} rows={2}>
          {() =>
            unread.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No unread notifications.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {unread.map((n) => (
                  <li key={n.id} className="flex flex-col">
                    <Link
                      to="/inbox"
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {n.subject}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {fmtInstant(n.createdAt, tz)}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryView>
      </CardContent>
    </Card>
  )
}
