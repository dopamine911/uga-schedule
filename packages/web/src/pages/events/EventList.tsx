import { EVENT_STATES } from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import { CalendarDaysIcon, PlusIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import {
  EmptyState,
  PageHeader,
  QueryView,
  StateBadge,
} from "@/components/common"
import { ReviewBadges } from "@/components/events/shared"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, unwrap } from "@/lib/api"
import { useCan, useHasRole } from "@/lib/auth"
import { fmtDays, humanize } from "@/lib/format"

// F-006 §3 and BR-006-16: the scopes a user can see, synced to ?scope=, with a state filter.

type Scope = "mine" | "sponsoring" | "studio" | "all"

const ALL_STATES = "all"

export function EventListPage() {
  const [params, setParams] = useSearchParams()
  const can = useCan()
  const hasRole = useHasRole()

  const scopes: { value: Scope; label: string }[] = [
    { value: "mine", label: "Mine" },
    ...(hasRole("SPONSOR")
      ? [{ value: "sponsoring" as const, label: "Sponsoring" }]
      : []),
    ...(hasRole("STUDIO_STAFF")
      ? [{ value: "studio" as const, label: "Studio" }]
      : []),
    ...(hasRole("EQUIPMENT_MANAGER", "ADMIN")
      ? [{ value: "all" as const, label: "All" }]
      : []),
  ]
  // A sponsor who cannot request studio time has no "Mine" requests; their default is what they sponsor.
  const defaultScope: Scope =
    hasRole("SPONSOR") && !can("event.create") ? "sponsoring" : "mine"
  const requested = params.get("scope")
  const scope: Scope =
    scopes.find((s) => s.value === requested)?.value ?? defaultScope
  const state = params.get("state") ?? ALL_STATES

  const query = useQuery({
    queryKey: ["events", "list", scope, state],
    queryFn: () =>
      unwrap(
        api.events.$get({
          query: { scope, ...(state !== ALL_STATES ? { state } : {}) },
        })
      ),
  })

  const update = (next: { scope?: string; state?: string }) => {
    const p = new URLSearchParams(params)
    if (next.scope !== undefined) p.set("scope", next.scope)
    if (next.state !== undefined) p.set("state", next.state)
    setParams(p, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Requests"
        description="Studio time requests you made, sponsor, or can see as staff."
        actions={
          can("event.create") && (
            <Button asChild>
              <Link to="/events/new">
                <PlusIcon data-icon="inline-start" />
                Request studio time
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={scope} onValueChange={(value) => update({ scope: value })}>
          <TabsList>
            {scopes.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          value={state}
          onValueChange={(value) => update({ state: value })}
        >
          <SelectTrigger aria-label="Filter by state" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL_STATES}>All states</SelectItem>
              {EVENT_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {humanize(s)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <QueryView query={query} rows={4}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              icon={CalendarDaysIcon}
              title="No requests here"
              description={
                state === ALL_STATES
                  ? "Nothing to show in this view yet."
                  : "No requests in this state."
              }
            >
              {can("event.create") && (
                <Button asChild variant="outline">
                  <Link to="/events/new">Request studio time</Link>
                </Button>
              )}
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="hidden lg:table-cell">Type</TableHead>
                  <TableHead className="hidden md:table-cell">Studio</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    Requester
                  </TableHead>
                  <TableHead className="hidden md:table-cell">Days</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    Next action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      <Link
                        to={`/events/${e.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {e.title}
                      </Link>
                      {/* Below md the days and studio columns are hidden, so they sit under the title. */}
                      <span className="flex flex-col text-sm font-normal text-muted-foreground md:hidden">
                        <span>{fmtDays(e.days)}</span>
                        <span>{e.studio.name}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <StateBadge state={e.state} />
                        {e.needsReview && (
                          <ReviewBadges needsReview={e.needsReview} />
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {e.eventType.name}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {e.studio.name}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {e.requester.displayName}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {fmtDays(e.days)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {e.nextAction ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </QueryView>
    </>
  )
}
