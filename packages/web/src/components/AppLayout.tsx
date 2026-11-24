import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellIcon, ClapperboardIcon, ClockIcon, LogOutIcon } from "lucide-react"
import { Navigate, NavLink, Outlet, useLocation } from "react-router"
import { toast } from "sonner"
import { useNavAllowed } from "@/components/common"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { api, unwrap } from "@/lib/api"
import { useMe, useSignOut, useTz, useUser } from "@/lib/auth"
import { fmtClock, fmtInstant, humanize, initials } from "@/lib/format"
import { NAV, routeFor } from "@/lib/nav"

function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => unwrap(api.notifications["unread-count"].$get()),
    refetchInterval: 30_000,
  })
}

/** Active nav item: a lighter charcoal than the black sidebar, white bold text. Red is reserved for "act now". */
const ACTIVE_NAV =
  "data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:font-bold"

export function AppLayout() {
  const user = useUser()
  const allowed = useNavAllowed()
  const { pathname } = useLocation()
  const signOut = useSignOut()
  const unread = useUnreadCount()

  const activeTo = routeFor(pathname)?.to
  const isActive = (to: string) => to === activeTo

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
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.hidden && allowed(i.to))
            if (items.length === 0) return null
            return (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel className="tracking-[0.14em] uppercase">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.to)}
                          className={ACTIVE_NAV}
                        >
                          <NavLink
                            to={item.to}
                            end={item.to === "/" || item.to === "/events"}
                          >
                            <item.icon />
                            <span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )
          })}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive("/inbox")}
                className={ACTIVE_NAV}
              >
                <NavLink to="/inbox">
                  <BellIcon />
                  <span>Inbox</span>
                </NavLink>
              </SidebarMenuButton>
              {!!unread.data?.count && (
                <SidebarMenuBadge>{unread.data.count}</SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-14 min-w-0 items-center gap-2 border-b bg-card px-2 sm:px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <div className="flex-1" />
          <DevClock />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-10 gap-2">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                    {initials(user.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden flex-col items-start leading-tight sm:flex">
                  <span>{user.displayName}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {[...new Set(user.roles.map((r) => humanize(r.role)))].join(
                      ", "
                    ) || "No role"}
                  </span>
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="sm:hidden">
                {user.displayName}
              </DropdownMenuLabel>
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOutIcon />
                  Switch user / sign out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** Dev-only time travel so reminders, expiries and overdue returns can be demonstrated (routes/dev.ts). */
function DevClock() {
  const me = useMe()
  const tz = useTz()
  const qc = useQueryClient()
  const clock = useQuery({
    queryKey: ["dev", "clock"],
    queryFn: () => unwrap(api.dev.clock.$get()),
    enabled: !!me.data?.devMode,
  })
  const move = useMutation({
    mutationFn: (body: { advanceMinutes?: number; reset?: boolean }) =>
      unwrap(api.dev.clock.$post({ json: body })),
    onSuccess: (r) => {
      toast.success(`Clock now ${fmtInstant(r.now, tz)}`)
      void qc.invalidateQueries()
    },
  })
  if (!me.data?.devMode || !clock.data) return null
  const offset = clock.data.offsetMs !== 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <ClockIcon data-icon="inline-start" />
          <span className="sm:hidden">{fmtClock(clock.data.now, tz)}</span>
          <span className="hidden sm:inline">
            {fmtInstant(clock.data.now, tz)}
          </span>
          {offset && (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              dev time
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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

/** Redirects to /login when signed out. */
export function RequireAuth() {
  const me = useMe()
  if (me.isPending) return null
  if (!me.data?.user) return <Navigate to="/login" replace />
  return <AppLayout />
}
