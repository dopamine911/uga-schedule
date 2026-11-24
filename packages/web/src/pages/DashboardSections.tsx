import type { RoleCode } from "@studio/domain"
import {
  BellIcon,
  CalendarCheckIcon,
  ClockIcon,
  HourglassIcon,
  OctagonAlertIcon,
  CalendarDaysIcon,
  ListTodoIcon,
  PackageIcon,
  PackageOpenIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react"
import { Link } from "react-router"
import {
  EmptyState,
  ErrorAlert,
  IconTitle,
  QueryView,
  StateBadge,
} from "@/components/common"
import { DateTile } from "@/components/events/DateTile"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { fmtDay, fmtDays, fmtInstant, firstName, humanize } from "@/lib/format"
import { cn } from "@/lib/utils"
import { primaryRole } from "@/lib/nav"
import { ROLE_INFO } from "@/lib/roles"
import {
  type AttentionChip,
  clearanceSentence,
  type CountSource,
  countOf,
  type DashboardAction,
  type EventSummary,
  type GrantRow,
  greeting,
  type HoldRow,
  type NotificationRow,
} from "@/pages/dashboard-data"

// Sections of the home page. Each is one card, banner row or hero block; DashboardPage composes them.

/** Chip colours per tone: red = act now, amber = needs you, blue = waiting on someone else (index.css colour jobs). */
const ATTENTION_CHIP_CLASS: Record<AttentionChip["tone"], string> = {
  "act-now": "bg-destructive/10 text-destructive",
  "needs-you": "bg-warning text-warning-foreground",
  waiting: "bg-info text-info-foreground",
}
const ATTENTION_CHIP_ICON: Record<AttentionChip["tone"], LucideIcon> = {
  "act-now": OctagonAlertIcon,
  "needs-you": ClockIcon,
  waiting: HourglassIcon,
}

/**
 * Light page header: a chip naming the user's role, a sentence-case greeting, the clearance line,
 * and coloured count chips for what needs attention. Replaces the black hero, whose three grey
 * counts all looked equally (un)important. The date moved to the top bar.
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
  chips: readonly AttentionChip[]
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
        {chips.length > 0 ? (
          <ul aria-label="Summary" className="flex flex-wrap gap-2">
            {chips.map((chip) => {
              const Icon = ATTENTION_CHIP_ICON[chip.tone]
              return (
                <li
                  key={chip.tone}
                  className={cn(
                    "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-bold",
                    ATTENTION_CHIP_CLASS[chip.tone]
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

/** Holds error, then one destructive banner per active hold. */
export function HoldBanners({
  error,
  holds,
}: {
  error: unknown
  holds: readonly HoldRow[]
}) {
  return (
    <>
      {error ? <ErrorAlert error={error} /> : null}
      {holds.map((h) => (
        <Alert key={h.id} variant="destructive">
          <AlertTitle>Your account has an active hold</AlertTitle>
          <AlertDescription>
            {humanize(h.reason)}
            {h.eventTitle ? ` on “${h.eventTitle}”` : ""}. New requests are
            blocked until it is cleared.{" "}
            <Link to="/me/access" className="underline underline-offset-4">
              See details
            </Link>
          </AlertDescription>
        </Alert>
      ))}
    </>
  )
}

/** One banner per access grant that is about to run out. */
export function ExpiringAccessBanners({
  grants,
}: {
  grants: readonly GrantRow[]
}) {
  return (
    <>
      {grants.map((g) => (
        <Alert key={g.id}>
          <AlertTitle>Your {g.levelName} access ends soon</AlertTitle>
          <AlertDescription>
            {g.validUntil
              ? `Access runs out on ${fmtDay(g.validUntil)}.`
              : "Access is ending soon."}{" "}
            <Link to="/me/access" className="underline underline-offset-4">
              View access
            </Link>
          </AlertDescription>
        </Alert>
      ))}
    </>
  )
}

/** Linked staff queue counts; the row is hidden when the user has no desk or decision role. */
export function StaffCards({
  canDesk,
  canStaffDecide,
  pickups,
  returns,
  awaiting,
  overdueOut,
}: {
  canDesk: boolean
  canStaffDecide: boolean
  pickups: CountSource
  returns: CountSource
  awaiting: CountSource
  overdueOut: number
}) {
  if (!canDesk && !canStaffDecide) return null
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {canDesk && (
        <QueueCard
          icon={PackageOpenIcon}
          label="Pickups"
          value={countOf(pickups)}
          detail="Confirmed events starting today or tomorrow."
          to="/desk"
        />
      )}
      {canDesk && (
        <QueueCard
          icon={PackageIcon}
          label="Equipment out"
          value={countOf(returns)}
          detail={
            overdueOut > 0
              ? `${overdueOut} overdue for return.`
              : "Nothing overdue."
          }
          to="/desk"
          urgent={overdueOut > 0}
        />
      )}
      {canStaffDecide && (
        <QueueCard
          icon={CalendarCheckIcon}
          label="Awaiting confirmation"
          value={countOf(awaiting)}
          detail="Sponsor-approved requests for staff to confirm."
          to="/approvals"
        />
      )}
    </div>
  )
}

/** A linked count for one staff queue (desk or approvals). */
function QueueCard({
  icon: Icon,
  label,
  value,
  detail,
  to,
  urgent = false,
}: {
  icon: LucideIcon
  label: string
  value: number | string
  detail: string
  to: string
  urgent?: boolean
}) {
  return (
    <Link
      to={to}
      className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        className={cn(
          "h-full transition-colors hover:bg-accent/50",
          urgent && "border-destructive/50"
        )}
      >
        <CardHeader>
          <CardDescription className="flex items-center gap-2">
            <Icon aria-hidden="true" className="size-4 text-primary" />
            {label}
          </CardDescription>
          <CardTitle className="font-heading text-3xl font-medium tabular-nums">
            {value}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {detail}
        </CardContent>
      </Card>
    </Link>
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
                        to={`/events/${e.id}`}
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

/** Steps that wait on the user, across requests, sponsor approvals and staff decisions. */
export function NeedsActionCard({
  actions,
  loading,
}: {
  actions: readonly DashboardAction[]
  loading: boolean
}) {
  return (
    <Card className="border-t-4 border-t-primary">
      <CardHeader>
        <CardTitle>
          <IconTitle icon={ListTodoIcon}>Needs your action</IconTitle>
        </CardTitle>
        <CardDescription>Steps that wait on you.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing needs you right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {actions.map((a) => (
              <li key={`${a.id}:${a.action}`} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                />
                <span className="flex min-w-0 flex-col">
                  <Link
                    to={`/events/${a.id}`}
                    className="font-bold underline-offset-4 hover:underline"
                  >
                    {a.title}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {a.action}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
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
