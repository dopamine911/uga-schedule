import {
  BellIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ListTodoIcon,
  PackageIcon,
  PackageOpenIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react"
import { useMemo } from "react"
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
import {
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

/** Black hero: date, greeting, clearance line, request CTA and the three counts. */
export function DashboardHero({
  now,
  tz,
  displayName,
  level,
  canRequest,
  upcomingCount,
  actionCount,
  unreadCount,
}: {
  now: number
  tz: string
  displayName: string
  level: { name: string } | null | undefined
  canRequest: boolean
  upcomingCount: number
  actionCount: number
  unreadCount: number
}) {
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: tz,
      }),
    [tz]
  )
  return (
    <section className="relative overflow-hidden rounded-xl bg-brand-black text-white">
      {/* Decorative bands, kept off the text area. White, not red: red is reserved for "act now". */}
      <div
        aria-hidden="true"
        className="absolute -top-10 -right-16 h-56 w-40 rotate-[24deg] bg-white/15"
      />
      <div
        aria-hidden="true"
        className="absolute -top-10 right-28 h-56 w-6 rotate-[24deg] bg-white/10"
      />
      <div className="relative flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-xl flex-col gap-2">
          <p className="text-xs font-bold tracking-[0.2em] text-white/70 uppercase">
            {dayFormat.format(new Date(now))}
          </p>
          <h1 className="text-4xl font-medium tracking-wide uppercase md:text-5xl">
            {greeting(now, tz)}, {firstName(displayName)}
          </h1>
          <p className="text-sm text-white/80">
            {clearanceSentence(level)}
            Your bookings, approvals and alerts in one place.
          </p>
          {canRequest && (
            <div className="pt-2">
              <Button
                asChild
                size="lg"
                className="bg-white text-brand-black hover:bg-white/90"
              >
                <Link to="/events/new">
                  <PlusIcon data-icon="inline-start" />
                  Request studio time
                </Link>
              </Button>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-3 lg:mr-28">
          <HeroStat label="Upcoming" value={upcomingCount} />
          <HeroStat label="Need you" value={actionCount} />
          <HeroStat label="Unread" value={unreadCount} />
        </dl>
      </div>
    </section>
  )
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-20 flex-col-reverse items-center rounded-lg border border-white/15 bg-white/5 px-4 py-3">
      <dt className="text-[0.625rem] font-bold tracking-[0.15em] text-white/70 uppercase">
        {label}
      </dt>
      <dd className="font-heading text-3xl font-medium tabular-nums">
        {value}
      </dd>
    </div>
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
