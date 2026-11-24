import type { EventState, Issue } from "@studio/domain"
import { AlertCircleIcon, InboxIcon, type LucideIcon } from "lucide-react"
import { createElement, type ReactNode } from "react"
import { useLocation } from "react-router"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan, useHasRole } from "@/lib/auth"
import { humanize } from "@/lib/format"
import { STATE_ICON } from "@/lib/icons"
import { NAV, routeIcon } from "@/lib/nav"

// Shared building blocks used by every page. Keep page-specific UI in the page files.

/**
 * Whether the signed-in user may open a sidebar route, by the same permission and role rules that show
 * it in the sidebar (lib/nav.ts). Pages render the access-denied state instead of an empty page.
 * Unknown routes are denied.
 */
export function useNavAllowed() {
  const can = useCan()
  const hasRole = useHasRole()
  return (to: string) => {
    const item = NAV.flatMap((g) => g.items).find((i) => i.to === to)
    return (
      !!item &&
      (!item.perm || can(item.perm)) &&
      (!item.roles || hasRole(...item.roles))
    )
  }
}

/**
 * Page title with the UGA "I-bar" accent: a Bulldog Red rule beside an Oswald headline, plus the page's
 * Lucide icon (the same one the sidebar uses for this route unless `icon` is given).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  icon,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: string
  icon?: LucideIcon
}) {
  const { pathname } = useLocation()
  // createElement: the icon is an existing component chosen per route, not one created during render.
  const iconNode = createElement(icon ?? routeIcon(pathname), { "aria-hidden": true })
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <span className="hidden size-14 shrink-0 items-center justify-center rounded-xl bg-accent text-primary sm:flex [&_svg]:size-7">
          {iconNode}
        </span>
        <div className="flex min-w-0 flex-col gap-1 border-l-4 border-primary pl-4">
          {eyebrow && (
            <p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">
              {eyebrow}
            </p>
          )}
          <h1 className="text-3xl leading-tight font-medium tracking-wide uppercase">
            {title}
          </h1>
          {description && (
            <p className="max-w-3xl text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

type StateTone =
  | "default"
  | "info"
  | "success"
  | "warning"
  | "neutral"
  | "destructive"
  | "outline"

/** Lifecycle colour: blue while waiting on people, teal once booked, red while live, neutral when done. */
const STATE_TONE: Record<EventState, StateTone> = {
  Draft: "outline",
  Submitted: "info",
  SponsorApproved: "info",
  Confirmed: "success",
  InProgress: "default",
  PostEvent: "warning",
  Closed: "neutral",
  Rejected: "destructive",
  Expired: "destructive",
  Cancelled: "neutral",
  NoShow: "destructive",
}

const STATE_LABEL: Partial<Record<EventState, string>> = {
  Submitted: "Awaiting sponsor",
  SponsorApproved: "Awaiting staff",
  InProgress: "In progress",
  PostEvent: "Post-event",
  NoShow: "No-show",
}

function stateLabel(state: EventState): string {
  return STATE_LABEL[state] ?? humanize(state)
}

export function StateBadge({ state }: { state: EventState }) {
  const Icon = STATE_ICON[state]
  return (
    <Badge variant={STATE_TONE[state]}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {stateLabel(state)}
    </Badge>
  )
}

/** Card or section heading with a Bulldog Red Lucide icon. */
export function IconTitle({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <span className="flex items-center gap-2">
      <Icon aria-hidden="true" className="size-5 shrink-0 text-primary" />
      {children}
    </span>
  )
}

/** Renders booking-rule issues returned by the API (F-006 §5). Soft issues can be justified, hard cannot. */
export function IssueList({
  issues,
  title = "This request can't be submitted yet",
}: {
  issues: readonly Issue[]
  title?: string
}) {
  if (issues.length === 0) return null
  const hard = issues.filter((i) => i.severity === "hard")
  const soft = issues.filter((i) => i.severity === "soft")
  return (
    <Alert variant={hard.length ? "destructive" : "default"}>
      <AlertCircleIcon />
      <AlertTitle>
        {hard.length ? title : "Exceptions need staff approval"}
      </AlertTitle>
      <AlertDescription>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {hard.map((i, n) => (
            <li key={`h${n}`}>{i.message}</li>
          ))}
          {soft.map((i, n) => (
            <li key={`s${n}`}>
              {i.message}{" "}
              <span className="text-muted-foreground">
                (can be approved with a justification)
              </span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.issues.length)
    return <IssueList issues={error.issues} title={error.message} />
  const message =
    error instanceof Error ? error.message : "Something went wrong."
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  children,
  icon: Icon = InboxIcon,
}: {
  title: string
  description?: string
  children?: ReactNode
  icon?: LucideIcon
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-accent text-primary">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children}
    </Empty>
  )
}

/** Standard query rendering: skeleton while loading, error alert on failure, otherwise children(data). */
export function QueryView<T>({
  query,
  children,
  rows,
}: {
  query: { data: T | undefined; error: unknown; isPending: boolean }
  children: (data: T) => ReactNode
  rows?: number
}) {
  if (query.isPending) return <LoadingBlock rows={rows} />
  if (query.error) return <ErrorAlert error={query.error} />
  if (query.data === undefined) return null
  return <>{children(query.data)}</>
}
