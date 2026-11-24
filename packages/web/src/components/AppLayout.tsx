import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BellIcon,
  ChevronRightIcon,
  ClapperboardIcon,
  LogOutIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { Navigate, NavLink, Outlet, useLocation } from "react-router"
import { toast } from "sonner"
import { useStudios } from "@/components/admin/pickers"
import { useNavAllowed } from "@/components/common"
import { EventPeek } from "@/components/EventPeek"
import { GlobalSearch } from "@/components/GlobalSearch"
import { useSidebarCounts } from "@/components/useSidebarCounts"
import { useNow } from "@/components/staff/shared"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { api, unwrap } from "@/lib/api"
import { useMe, useSignOut, useTz, useUser } from "@/lib/auth"
import { fmtInstant, initials } from "@/lib/format"
import {
  type SidebarSection,
  primaryRole,
  routeFor,
  sidebarSectionsFor,
} from "@/lib/nav"
import { ROLE_INFO } from "@/lib/roles"

function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => unwrap(api.notifications["unread-count"].$get()),
    refetchInterval: 30_000,
  })
}

/** Active nav item: white pill with black bold text (hover keeps it white). Red is reserved for "act now". */
const ACTIVE_NAV =
  "data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:font-bold data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"

const LIST = new Intl.ListFormat("en-US", { type: "conjunction" })

export function AppLayout() {
  const user = useUser()
  const allowed = useNavAllowed()
  const { pathname } = useLocation()
  const unread = useUnreadCount()

  const activeTo = routeFor(pathname)?.to
  const sections = sidebarSectionsFor(
    user.roles.map((assignment) => assignment.role),
    allowed
  )

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="border-b border-sidebar-border">
          <NavLink
            to="/"
            className="flex items-center gap-3 px-2 py-2"
            aria-label="Studio Scheduling home"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-red text-white ring-2 ring-white">
              <ClapperboardIcon />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[0.625rem] font-bold tracking-[0.2em] text-sidebar-foreground/70 uppercase">
                University of Georgia
              </span>
              <span className="font-heading text-xl font-medium tracking-wide uppercase">
                Studio Scheduling
              </span>
            </span>
          </NavLink>
        </SidebarHeader>
        <SidebarContent>
          {sections.map((section) =>
            section.key === "more" ? (
              <MoreGroup
                key={section.key}
                section={section}
                activeTo={activeTo}
              />
            ) : (
              <SidebarGroup key={section.key}>
                {section.label && (
                  <SidebarGroupLabel className="tracking-[0.14em] uppercase">
                    {section.label}
                  </SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <NavItems items={section.items} activeTo={activeTo} />
                </SidebarGroupContent>
              </SidebarGroup>
            )
          )}
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-16 min-w-0 items-center gap-2 border-b bg-card px-2 sm:px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <HeaderClock />
          <div className="flex min-w-0 flex-1 justify-center px-2">
            <GlobalSearch />
          </div>
          <InboxButton
            count={unread.data?.count ?? 0}
            active={activeTo === "/inbox"}
          />
          <UserMenu />
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
          <Outlet />
          {/* Quick-look panel for ?peek=<event id>, available from every page. */}
          <EventPeek />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function NavItems({
  items,
  activeTo,
}: {
  items: SidebarSection["items"]
  activeTo: string | undefined
}) {
  const sidebarCounts = useSidebarCounts()
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton
            asChild
            isActive={item.to === activeTo}
            className={ACTIVE_NAV}
          >
            <NavLink
              to={item.to}
              end={item.to === "/" || item.to === "/events"}
            >
              <item.icon />
              <span>{item.label}</span>
              {sidebarCounts[item.to] !== undefined && (
                <>
                  {/* Own background so the count stays readable on the white current-page pill. */}
                  <span
                    aria-hidden="true"
                    className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-sidebar-accent px-1.5 text-xs font-bold text-sidebar-accent-foreground tabular-nums ring-1 ring-sidebar-border"
                  >
                    {sidebarCounts[item.to]}
                  </span>
                  <span className="sr-only">
                    , {sidebarCounts[item.to]} waiting
                  </span>
                </>
              )}
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

/** Pages outside the role's main work: collapsed until opened, and kept open while one of them is the current page. */
function MoreGroup({
  section,
  activeTo,
}: {
  section: SidebarSection
  activeTo: string | undefined
}) {
  const holdsCurrent = section.items.some((i) => i.to === activeTo)
  const [open, setOpen] = useState(false)
  const shown = open || holdsCurrent
  return (
    <Collapsible open={shown} onOpenChange={setOpen} asChild>
      <SidebarGroup className="border-t border-sidebar-border">
        <SidebarGroupLabel
          asChild
          className="tracking-[0.14em] uppercase hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <CollapsibleTrigger disabled={holdsCurrent}>
            {section.label}
            <ChevronRightIcon
              className={`ml-auto transition-transform ${shown ? "rotate-90" : ""}`}
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <NavItems items={section.items} activeTo={activeTo} />
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/**
 * Campus date and "Now" time. In dev mode it opens the clock controls (routes/dev.ts), which also run the background
 * jobs, and a moved clock is marked "dev time".
 */
function HeaderClock() {
  const me = useMe()
  const tz = useTz()
  const now = new Date(useNow())
  const qc = useQueryClient()
  // Building an Intl formatter is costly; keep one per time zone instead of one per render.
  const [dayFormat, timeFormat] = useMemo(
    () => [
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: tz,
      }),
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      }),
    ],
    [tz]
  )
  const devMode = !!me.data?.devMode
  const clock = useQuery({
    queryKey: ["dev", "clock"],
    queryFn: () => unwrap(api.dev.clock.$get()),
    enabled: devMode,
  })
  const move = useMutation({
    mutationFn: (body: { advanceMinutes?: number; reset?: boolean }) =>
      unwrap(api.dev.clock.$post({ json: body })),
    onSuccess: (r) => {
      toast.success(`Clock now ${fmtInstant(r.now, tz)}`)
      void qc.invalidateQueries()
    },
  })
  const face = (
    <span className="flex min-w-0 flex-col items-start leading-tight">
      <span className="truncate text-sm font-bold">
        {dayFormat.format(now)}
      </span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Now {timeFormat.format(now)}
        {!!clock.data?.offsetMs && (
          <Badge variant="warning" className="h-4 px-1.5 text-[0.625rem]">
            dev time
          </Badge>
        )}
      </span>
    </span>
  )
  if (!devMode)
    return <div className="hidden min-w-0 px-1 md:block">{face}</div>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="hidden h-12 min-w-0 px-2 md:flex"
          aria-label="Dev clock"
        >
          {face}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Dev clock (runs background jobs)</DropdownMenuLabel>
        <DropdownMenuGroup>
          {[
            ["+1 hour", 60],
            ["+6 hours", 360],
            ["+1 day", 1440],
            ["+1 week", 10080],
          ].map(([label, minutes]) => (
            <DropdownMenuItem
              key={label}
              onSelect={() => move.mutate({ advanceMinutes: Number(minutes) })}
            >
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => move.mutate({ reset: true })}>
            Reset to real time
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Inbox in the top bar (it used to sit at the bottom of the sidebar), with the unread count on the bell. */
function InboxButton({ count, active }: { count: number; active: boolean }) {
  return (
    <Button
      asChild
      variant={active ? "default" : "ghost"}
      size="icon"
      className="relative"
    >
      <NavLink
        to="/inbox"
        aria-label={count ? `Inbox, ${count} unread` : "Inbox, nothing unread"}
      >
        <BellIcon />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.6875rem] font-bold text-primary-foreground ring-2 ring-card"
          >
            {count}
          </span>
        )}
      </NavLink>
    </Button>
  )
}

/** "Studio staff · Studio A and Studio C": the role that shapes the sidebar, plus the studios a staff member covers. */
function useRoleLine(): string {
  const user = useUser()
  const studios = useStudios()
  const role = primaryRole(user.roles.map((r) => r.role))
  if (!role) return "No role"
  const label = ROLE_INFO[role].label
  if (role !== "STUDIO_STAFF" || !studios.data) return label
  const covered = new Set(
    user.roles.filter((r) => r.role === "STUDIO_STAFF").map((r) => r.studioId)
  )
  // Studio names read "Studio A – Podcast Booth"; the part before the dash is how people refer to them.
  const names = studios.data
    .filter((s) => covered.has(s.id))
    .map((s) => s.name.split(" – ")[0]!)
  return names.length ? `${label} · ${LIST.format(names)}` : label
}

function UserMenu() {
  const user = useUser()
  const signOut = useSignOut()
  const roleLine = useRoleLine()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-12 gap-2 px-2">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
              {initials(user.displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="font-bold">{user.displayName}</span>
            <span className="text-xs text-muted-foreground">{roleLine}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex flex-col">
          <span>{user.displayName}</span>
          <span className="font-normal text-muted-foreground">
            {user.email}
          </span>
          <span className="font-normal text-muted-foreground sm:hidden">
            {roleLine}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOutIcon />
            Switch user / sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Redirects to /login when signed out. */
export function RequireAuth() {
  const me = useMe()
  if (me.isPending) return null
  if (!me.data?.user) return <Navigate to="/login" replace />
  return <AppLayout />
}
