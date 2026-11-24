import type { Permission, RoleCode } from "@studio/domain"
import {
  BellIcon,
  BoxesIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  CalendarRangeIcon,
  CameraIcon,
  FileTextIcon,
  GraduationCapIcon,
  HandIcon,
  LayersIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  type LucideIcon,
  PackageCheckIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  WarehouseIcon,
} from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Shown when the user holds this permission in any scope. */
  perm?: Permission
  roles?: string[]
  /** Route has a page icon but no sidebar entry (reached from another page). */
  hidden?: true
}

/** Sidebar navigation. The same icons head each page (see routeIcon). */
export const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Personal",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboardIcon },
      {
        to: "/events/new",
        label: "Request studio time",
        icon: CalendarPlusIcon,
        perm: "event.create",
      },
      { to: "/events", label: "My events", icon: CalendarDaysIcon },
      { to: "/equipment", label: "Equipment catalog", icon: CameraIcon },
      { to: "/results", label: "Results", icon: FileTextIcon },
      {
        to: "/me/access",
        label: "My access",
        icon: GraduationCapIcon,
        roles: ["STUDENT"],
      },
      {
        to: "/settings/calendar",
        label: "Calendar sync",
        icon: CalendarClockIcon,
      },
    ],
  },
  {
    label: "Approvals & desk",
    items: [
      {
        to: "/approvals",
        label: "Approvals",
        icon: ListChecksIcon,
        roles: ["SPONSOR", "STUDIO_STAFF", "ADMIN"],
      },
      {
        to: "/desk",
        label: "Equipment desk",
        icon: PackageCheckIcon,
        perm: "checkout.perform",
      },
      { to: "/schedule", label: "Studio schedule", icon: CalendarRangeIcon },
      {
        to: "/holds",
        label: "Holds",
        icon: HandIcon,
        roles: ["STUDIO_STAFF", "EQUIPMENT_MANAGER", "ADMIN"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        to: "/admin/inventory",
        label: "Inventory",
        icon: BoxesIcon,
        perm: "inventory.manage",
      },
      {
        to: "/admin/levels",
        label: "Levels & courses",
        icon: GraduationCapIcon,
        perm: "level.manage",
      },
      {
        to: "/admin/courses",
        label: "Courses",
        icon: GraduationCapIcon,
        perm: "level.manage",
        hidden: true,
      },
      {
        to: "/admin/users",
        label: "Users & roles",
        icon: UsersIcon,
        perm: "role.assign",
      },
      {
        to: "/admin/studios",
        label: "Studios",
        icon: WarehouseIcon,
        perm: "studio.manage",
      },
      {
        to: "/admin/event-types",
        label: "Event types",
        icon: LayersIcon,
        perm: "event_type.manage",
      },
      {
        to: "/admin/policies",
        label: "Policies",
        icon: SlidersHorizontalIcon,
        perm: "policy.manage",
      },
      {
        to: "/admin/audit",
        label: "Audit log",
        icon: ScrollTextIcon,
        perm: "audit.view",
      },
    ],
  },
]

/** One sidebar section as rendered for a particular user. */
export interface SidebarGroup {
  label: string
  items: NavItem[]
}

/**
 * When a user holds several roles, the most responsible one shapes the sidebar order.
 * Example: a studio-staff member who also sponsors students sees the staff desk first.
 */
const ROLE_PRECEDENCE: readonly RoleCode[] = [
  "ADMIN",
  "EQUIPMENT_MANAGER",
  "STUDIO_STAFF",
  "SPONSOR",
  "STUDENT",
]

/**
 * The pages each role uses most, in the order they appear under "Your work" at the top of the sidebar.
 * This only changes ORDER: every route the user may open still appears (in its usual group below), and
 * access rules stay in NAV. Before this, everyone saw the same groups in the same order, so a sponsor
 * had to scan past student pages to find Approvals.
 */
const ROLE_PRIORITY_ROUTES: Record<RoleCode, readonly string[]> = {
  STUDENT: ["/", "/events/new", "/events", "/me/access", "/equipment"],
  SPONSOR: ["/", "/approvals", "/events", "/results"],
  STUDIO_STAFF: ["/", "/desk", "/approvals", "/schedule", "/holds"],
  EQUIPMENT_MANAGER: [
    "/",
    "/admin/inventory",
    "/holds",
    "/desk",
    "/admin/levels",
  ],
  ADMIN: ["/", "/approvals", "/schedule", "/holds", "/admin/users"],
}

const PRIORITY_GROUP_LABEL = "Your work"

/** The role that decides sidebar order, or undefined for a user with no roles. */
export function primaryRole(roles: readonly RoleCode[]): RoleCode | undefined {
  return ROLE_PRECEDENCE.find((role) => roles.includes(role))
}

/**
 * Sidebar sections for one user: their role's priority pages first under "Your work", then every other
 * page they may open, still in its usual NAV group. Hidden routes and routes `isAllowed` rejects are left out.
 */
export function sidebarGroupsFor(
  roles: readonly RoleCode[],
  isAllowed: (to: string) => boolean
): SidebarGroup[] {
  const visibleItems = NAV.flatMap((group) => group.items).filter(
    (item) => !item.hidden && isAllowed(item.to)
  )
  const role = primaryRole(roles)
  const priorityRoutes = role ? ROLE_PRIORITY_ROUTES[role] : []
  const priorityItems = priorityRoutes
    .map((to) => visibleItems.find((item) => item.to === to))
    .filter((item): item is NavItem => item !== undefined)
  const shownFirst = new Set(priorityItems.map((item) => item.to))

  const groups: SidebarGroup[] = []
  if (priorityItems.length > 0) {
    groups.push({ label: PRIORITY_GROUP_LABEL, items: priorityItems })
  }
  for (const group of NAV) {
    const remaining = group.items.filter(
      (item) => !item.hidden && isAllowed(item.to) && !shownFirst.has(item.to)
    )
    if (remaining.length > 0)
      groups.push({ label: group.label, items: remaining })
  }
  return groups
}

/** Routes not listed in the sidebar body. */
const EXTRA: NavItem[] = [
  { to: "/inbox", label: "Inbox", icon: BellIcon },
  { to: "/events/:id/checkout", label: "Checkout", icon: PackageCheckIcon },
  { to: "/events/:id/checkin", label: "Check-in", icon: PackageCheckIcon },
]

const ALL = [...NAV.flatMap((g) => g.items), ...EXTRA]

function matches(pattern: string, pathname: string): boolean {
  if (pattern === "/") return pathname === "/"
  const re = new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}(/|$)`)
  return re.test(pathname)
}

/** The most specific known route containing `pathname` (drives the page icon and the highlighted nav item). */
export function routeFor(pathname: string): NavItem | undefined {
  return ALL.filter((i) => matches(i.to, pathname)).sort(
    (a, b) => b.to.length - a.to.length
  )[0]
}

export function routeIcon(pathname: string): LucideIcon {
  return routeFor(pathname)?.icon ?? LayoutDashboardIcon
}
