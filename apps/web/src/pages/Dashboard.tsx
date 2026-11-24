import { TERMINAL } from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import {
  BellIcon,
  CalendarDaysIcon,
  ListTodoIcon,
  PlusIcon,
} from "lucide-react"
import { useState } from "react"
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
import { api, unwrap } from "@/lib/api"
import { useCan, useHasRole, useTz, useUser } from "@/lib/auth"
import { fmtDay, fmtDays, fmtInstant, humanize } from "@/lib/format"

// Home page: alerts, what needs the user, what is coming up, and recent unread notifications.

/** Next-action text that asks the user to do something (the rest describe waiting on others). */
function needsUser(nextAction: string | null): nextAction is string {
  return nextAction !== null && !/^(Waiting|Event in progress)/.test(nextAction)
}

export function DashboardPage() {
  const user = useUser()
  const can = useCan()
  const hasRole = useHasRole()
  const tz = useTz()
  const firstName = user.displayName.split(" ")[0] ?? user.displayName
  const [loadedAt] = useState(() => Date.now())

  const holds = useQuery({
    queryKey: ["holds", "mine"],
    queryFn: () => unwrap(api.holds.$get({ query: { scope: "mine" } })),
  })
  const access = useQuery({
    queryKey: ["levels", "me"],
    queryFn: () => unwrap(api.levels.me.$get()),
  })
  const mine = useQuery({
    queryKey: ["events", "list", "mine", "all"],
    queryFn: () => unwrap(api.events.$get({ query: { scope: "mine" } })),
  })
  const sponsoring = useQuery({
    queryKey: ["events", "list", "sponsoring", "all"],
    queryFn: () => unwrap(api.events.$get({ query: { scope: "sponsoring" } })),
    enabled: hasRole("SPONSOR"),
  })
  const studio = useQuery({
    queryKey: ["events", "list", "studio", "all"],
    queryFn: () => unwrap(api.events.$get({ query: { scope: "studio" } })),
    enabled: hasRole("STUDIO_STAFF"),
  })
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap(api.notifications.$get()),
  })

  const activeHolds = (holds.data ?? []).filter((h) => h.status === "active")
  const expiring = (access.data?.grants ?? []).filter(
    (g) => g.status === "expiring"
  )

  // Actions for me: my own requests needing a step, sponsor approvals, and staff decisions.
  const actions = [
    ...(mine.data ?? [])
      .filter((e) => needsUser(e.nextAction))
      .map((e) => ({ id: e.id, title: e.title, action: e.nextAction! })),
    ...(sponsoring.data ?? [])
      .filter((e) => e.state === "Submitted")
      .map((e) => ({
        id: e.id,
        title: e.title,
        action: "Approve or reject this request",
      })),
    ...(studio.data ?? [])
      .filter((e) => e.state === "SponsorApproved" || e.needsReview)
      .map((e) => ({
        id: e.id,
        title: e.title,
        action: e.needsReview
          ? "Review the flagged request"
          : "Confirm or reject this request",
      })),
  ]
  const upcoming = (mine.data ?? [])
    .filter(
      (e) =>
        !TERMINAL.includes(e.state) &&
        e.days[0] &&
        Date.parse(e.days[0].startsAt) >= loadedAt
    )
    .slice(0, 5)
  const unread = (notifications.data ?? [])
    .filter((n) => n.readAt === null)
    .slice(0, 5)

  return (
    <>
      <section className="relative overflow-hidden rounded-xl border-b-4 border-b-primary bg-brand-black text-white">
        {/* Decorative red bands, kept off the text area (red/black rule) */}
        <div
          aria-hidden="true"
          className="absolute -top-10 -right-16 h-56 w-40 rotate-[24deg] bg-primary opacity-90"
        />
        <div
          aria-hidden="true"
          className="absolute -top-10 right-28 h-56 w-6 rotate-[24deg] bg-white/10"
        />
        <div className="relative flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-xl flex-col gap-2">
            <p className="text-xs font-bold tracking-[0.2em] text-white/70 uppercase">
              {new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: tz,
              }).format(new Date())}
            </p>
            <h1 className="text-4xl font-medium tracking-wide uppercase md:text-5xl">
              {greeting(tz)}, {firstName}
            </h1>
            <p className="text-sm text-white/80">
              {access.data?.effectiveLevelToday
                ? `You're cleared for ${access.data.effectiveLevelToday.name}. `
                : ""}
              Your bookings, approvals and alerts in one place.
            </p>
            {can("event.create") && (
              <div className="pt-2">
                <Button asChild size="lg">
                  <Link to="/events/new">
                    <PlusIcon data-icon="inline-start" />
                    Request studio time
                  </Link>
                </Button>
              </div>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-3 lg:mr-28">
            <HeroStat label="Upcoming" value={upcoming.length} />
            <HeroStat label="Need you" value={actions.length} />
            <HeroStat label="Unread" value={unread.length} />
          </dl>
        </div>
      </section>

      {holds.error ? <ErrorAlert error={holds.error} /> : null}
      {activeHolds.map((h) => (
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
      {expiring.map((g) => (
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

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>
              <IconTitle icon={CalendarDaysIcon}>Upcoming events</IconTitle>
            </CardTitle>
            <CardDescription>
              Your next five requests and bookings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QueryView query={mine} rows={3}>
              {() =>
                upcoming.length === 0 ? (
                  <EmptyState
                    title="Nothing coming up"
                    description="Requests you make will show here."
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

        <div className="flex flex-col gap-6">
          <Card className="border-t-4 border-t-primary">
            <CardHeader>
              <CardTitle>
                <IconTitle icon={ListTodoIcon}>Needs your action</IconTitle>
              </CardTitle>
              <CardDescription>Steps that wait on you.</CardDescription>
            </CardHeader>
            <CardContent>
              {mine.isPending ||
              (hasRole("SPONSOR") && sponsoring.isPending) ||
              (hasRole("STUDIO_STAFF") && studio.isPending) ? (
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

          <Card>
            <CardHeader>
              <CardTitle>
                <IconTitle icon={BellIcon}>Recent notifications</IconTitle>
              </CardTitle>
              <CardDescription>Unread messages.</CardDescription>
            </CardHeader>
            <CardContent>
              <QueryView query={notifications} rows={2}>
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
        </div>
      </div>
    </>
  )
}

function greeting(tz: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: tz,
    }).format(new Date())
  )
  return hour < 12
    ? "Good morning"
    : hour < 17
      ? "Good afternoon"
      : "Good evening"
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
