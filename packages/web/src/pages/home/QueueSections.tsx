import {
  ClockIcon,
  HourglassIcon,
  type LucideIcon,
  ListTodoIcon,
  OctagonAlertIcon,
} from "lucide-react"
import { Link } from "react-router"
import { EmptyState, IconTitle, QueryView } from "@/components/common"
import { usePeekLink } from "@/components/EventPeek"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  type Countdown as CountdownState,
  formatQueueDue,
  type QueueItem,
  type QueueResponse,
  type QueueSeverity,
  queueCountdown,
} from "@/pages/home/queue-due"

// The work queue on the home page: the Next up spotlight, then everything else grouped by tier.

/** Tier wording, icon and colours, from the colour jobs in index.css. */
export const TIER: Record<
  QueueSeverity,
  {
    label: string
    icon: LucideIcon
    /** Solid chip for the row mark. */
    mark: string
    /** Text colour for headings and due text. */
    text: string
    /** Tinted panel and header chip. */
    panel: string
    /** Legend swatch. */
    swatch: string
  }
> = {
  critical: {
    label: "Act now",
    icon: OctagonAlertIcon,
    mark: "bg-critical text-critical-solid",
    text: "text-critical-foreground",
    panel: "bg-critical text-critical-foreground",
    swatch: "bg-critical-solid",
  },
  soon: {
    label: "Coming up",
    icon: ClockIcon,
    mark: "bg-warning text-warning-solid",
    text: "text-warning-foreground",
    panel: "bg-warning text-warning-foreground",
    swatch: "bg-warning-solid",
  },
  waiting: {
    label: "Waiting on others",
    icon: HourglassIcon,
    mark: "bg-info text-info-solid",
    text: "text-info-foreground",
    panel: "bg-info text-info-foreground",
    swatch: "bg-info-solid",
  },
}

const TIER_ORDER: readonly QueueSeverity[] = ["critical", "soon", "waiting"]

export interface QueueChip {
  severity: QueueSeverity
  label: string
  value: number
}

/** Header count chips from the server's counts; zero counts are left out. */
export function queueChips(counts: QueueResponse["counts"]): QueueChip[] {
  return TIER_ORDER.map((severity) => ({
    severity,
    label: TIER[severity].label,
    value: counts[severity],
  })).filter((chip) => chip.value > 0)
}

/** The item's title: a quick-look link when it belongs to a booking, plain text otherwise. */
function ItemTitle({
  item,
  className,
}: {
  item: QueueItem
  className?: string
}) {
  const peek = usePeekLink()
  if (!item.eventId) return <span className={className}>{item.title}</span>
  return (
    <Link
      to={peek(item.eventId)}
      className={cn("underline-offset-4 hover:underline", className)}
    >
      {item.title}
    </Link>
  )
}

/** The queue query, with loading and error states; the spotlight and the grouped list. */
export function QueueSection({
  query,
  now,
  tz,
}: {
  query: { data: QueueResponse | undefined; error: unknown; isPending: boolean }
  now: number
  tz: string
}) {
  return (
    <QueryView query={query} rows={3}>
      {(data) => <QueueBody items={data.items} now={now} tz={tz} />}
    </QueryView>
  )
}

function QueueBody({
  items,
  now,
  tz,
}: {
  items: readonly QueueItem[]
  now: number
  tz: string
}) {
  // The server sorts critical, soon, waiting; the spotlight is the first step that is not just waiting.
  const spotlight = items.find((item) => item.severity !== "waiting")
  const rest = spotlight ? items.filter((item) => item !== spotlight) : items
  return (
    <div className="flex flex-col gap-4">
      {spotlight && <NextUpSpotlight item={spotlight} now={now} tz={tz} />}
      <Card>
        <CardHeader className="gap-3">
          <CardTitle>
            <IconTitle icon={ListTodoIcon}>
              {spotlight ? "Everything else" : "Needs you"}
            </IconTitle>
          </CardTitle>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {TIER_ORDER.map((severity) => (
              <span key={severity} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", TIER[severity].swatch)}
                />
                {LEGEND[severity]}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {rest.length === 0 ? (
            spotlight ? (
              <p className="px-6 text-sm text-muted-foreground">
                Nothing else needs you right now.
              </p>
            ) : (
              <EmptyState
                title="You’re all caught up"
                description="New requests, pickups and returns will show up here as soon as they need you."
              />
            )
          ) : (
            TIER_ORDER.map((severity) => {
              const group = rest.filter((item) => item.severity === severity)
              if (group.length === 0) return null
              return (
                <QueueGroup
                  key={severity}
                  severity={severity}
                  items={group}
                  now={now}
                  tz={tz}
                />
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const LEGEND: Record<QueueSeverity, string> = {
  critical: "Red: act now",
  soon: "Amber: coming up",
  waiting: "Blue: waiting on others",
}

function QueueGroup({
  severity,
  items,
  now,
  tz,
}: {
  severity: QueueSeverity
  items: readonly QueueItem[]
  now: number
  tz: string
}) {
  const tier = TIER[severity]
  const Icon = tier.icon
  return (
    <section aria-label={tier.label}>
      <h3
        className={cn(
          "flex items-center gap-2 px-6 pt-3 pb-1 text-xs font-bold tracking-[0.12em] uppercase",
          tier.text
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {tier.label}
      </h3>
      <ul>
        {items.map((item) => (
          <QueueRow key={item.key} item={item} now={now} tz={tz} />
        ))}
      </ul>
    </section>
  )
}

function QueueRow({
  item,
  now,
  tz,
}: {
  item: QueueItem
  now: number
  tz: string
}) {
  const tier = TIER[item.severity]
  const Icon = tier.icon
  const due = formatQueueDue(item, now, tz)
  return (
    <li className="flex items-start gap-4 px-6 py-3">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          tier.mark
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <ItemTitle item={item} className="leading-snug font-bold break-words" />
        {item.meta.map((line) => (
          <span key={line} className="text-sm text-muted-foreground">
            {line}
          </span>
        ))}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
        {due && (
          <span
            className={cn("text-sm font-bold whitespace-nowrap", tier.text)}
          >
            {due}
          </span>
        )}
        {item.action && (
          <Button asChild variant="outline" size="sm">
            <Link to={item.action.href}>{item.action.label}</Link>
          </Button>
        )}
      </div>
    </li>
  )
}

/** The one step to look at first, shown large with a live countdown. */
function NextUpSpotlight({
  item,
  now,
  tz,
}: {
  item: QueueItem
  now: number
  tz: string
}) {
  const tier = TIER[item.severity]
  const TierIcon = tier.icon
  return (
    <section
      aria-labelledby="next-up-title"
      className="grid gap-5 rounded-xl border bg-card p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
            Next up
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold",
              tier.panel
            )}
          >
            <TierIcon aria-hidden="true" className="size-3.5" />
            {tier.label}
          </span>
        </div>
        <h2
          id="next-up-title"
          className="text-2xl leading-tight font-medium break-words"
        >
          <ItemTitle item={item} />
        </h2>
        {item.meta.map((line) => (
          <p key={line} className="text-muted-foreground">
            {line}
          </p>
        ))}
        {item.action && (
          <div>
            <Button asChild>
              <Link to={item.action.href}>{item.action.label}</Link>
            </Button>
          </div>
        )}
      </div>
      <Countdown
        countdown={queueCountdown(item, now, tz)}
        icon={tier.icon}
        className={tier.panel}
      />
    </section>
  )
}

function Countdown({
  countdown,
  icon: Icon,
  className,
}: {
  countdown: CountdownState
  icon: LucideIcon
  className: string
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1 rounded-lg px-5 py-4 md:min-w-56",
        className
      )}
    >
      {countdown.kind === "timer" ? (
        <span className="font-heading text-4xl leading-none font-medium whitespace-nowrap tabular-nums">
          {countdown.value}
        </span>
      ) : (
        <Icon aria-hidden="true" className="size-10" />
      )}
      {countdown.caption && (
        <span className="text-sm font-bold">{countdown.caption}</span>
      )}
    </div>
  )
}
