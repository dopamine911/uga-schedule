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

/** Every page a user can reach from the sidebar, with who may see it. The same icons head each page (see routeIcon). */
export const ROUTES: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboardIcon },
  {
    to: "/events/new",
    label: "Request studio time",
    icon: CalendarPlusIcon,
    perm: "event.create",
  },
  { to: "/events", label: "My events", icon: CalendarDaysIcon },
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
  {
    to: "/admin/inventory",
    label: "Inventory",
    icon: BoxesIcon,
    perm: "inventory.manage",
  },
  {
    to: "/me/access",
    label: "My access",
    icon: GraduationCapIcon,
    roles: ["STUDENT"],
  },
  { to: "/equipment", label: "Equipment catalog", icon: CameraIcon },
  { to: "/results", label: "Results", icon: FileTextIcon },
  { to: "/settings/calendar", label: "Calendar sync", icon: CalendarClockIcon },
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
]

/** A sidebar entry: a route, named for the role looking at it ("Studio schedule" vs "My bookings"). */
interface NavEntry {
  to: string
  label?: string
}

/** One role's sidebar: main pages on top, a secondary "Records" group, and a collapsed "More" for the rest. */
interface RoleLayout {
  main: NavEntry[]
  records: NavEntry[]
  more: NavEntry[]
}

const COMMON_MORE: NavEntry[] = [
  { to: "/equipment" },
  { to: "/results" },
  { to: "/settings/calendar" },
]

/** Per-role sidebars from the role-based redesign (.local/index.html). */
const LAYOUTS: Record<RoleCode, RoleLayout> = {
  STUDENT: {
    main: [
      { to: "/" },
      { to: "/events/new" },
      { to: "/events", label: "My bookings" },
    ],
    records: [],
    more: [{ to: "/me/access" }, ...COMMON_MORE],
  },
  SPONSOR: {
    main: [
      { to: "/" },
      { to: "/approvals" },
      { to: "/events", label: "Sponsored sessions" },
    ],
    records: [],
    more: COMMON_MORE,
  },
  STUDIO_STAFF: {
    main: [
      { to: "/", label: "Today" },
      { to: "/desk" },
      { to: "/approvals", label: "Requests to confirm" },
      { to: "/schedule" },
    ],
    records: [{ to: "/holds" }],
    more: COMMON_MORE,
  },
  EQUIPMENT_MANAGER: {
    main: [{ to: "/" }, { to: "/admin/inventory" }, { to: "/holds" }],
    records: [{ to: "/schedule" }],
    more: [{ to: "/admin/levels" }, { to: "/admin/audit" }, ...COMMON_MORE],
  },
  ADMIN: {
    main: [
      { to: "/" },
      { to: "/approvals", label: "Requests to confirm" },
      { to: "/schedule" },
    ],
    records: [{ to: "/admin/inventory" }, { to: "/holds" }],
    more: [
      { to: "/admin/users" },
      { to: "/admin/studios" },
      { to: "/admin/event-types" },
      { to: "/admin/levels" },
      { to: "/admin/policies" },
      { to: "/admin/audit" },
      ...COMMON_MORE,
    ],
  },
}

/**
 * When a user holds several roles, the most responsible one shapes the sidebar.
 * Example: a studio-staff member who also sponsors students sees the staff desk first.
 */
const ROLE_PRECEDENCE: readonly RoleCode[] = [
  "ADMIN",
  "EQUIPMENT_MANAGER",
  "STUDIO_STAFF",
  "SPONSOR",
  "STUDENT",
]

/** The role that decides the sidebar, or undefined for a user with no roles. */
export function primaryRole(roles: readonly RoleCode[]): RoleCode | undefined {
  return ROLE_PRECEDENCE.find((role) => roles.includes(role))
}

/** One sidebar section as rendered for a particular user. */
export interface SidebarSection {
  key: "main" | "records" | "more"
  label: string | null
  items: NavItem[]
}

/**
 * Sidebar sections for one user: their primary role's main pages, its "Records", then "More". Pages the user may open
 * that the layout does not list (another role's pages, for someone with two roles) are added to "More", so nothing the
 * app offers is hidden. A user with no role gets Home plus "More". Routes `isAllowed` rejects are left out.
 */
export function sidebarSectionsFor(
  roles: readonly RoleCode[],
  isAllowed: (to: string) => boolean
): SidebarSection[] {
  const role = primaryRole(roles)
  const layout: RoleLayout = role
    ? LAYOUTS[role]
    : { main: [{ to: "/" }], records: [], more: [] }
  const listed = new Set(
    [...layout.main, ...layout.records, ...layout.more].map((e) => e.to)
  )
  const unlisted = ROUTES.filter((r) => !r.hidden && !listed.has(r.to)).map(
    (r) => ({ to: r.to })
  )
  const resolve = (entries: NavEntry[]) =>
    entries
      .filter((e) => isAllowed(e.to))
      .map((e) => {
        const route = ROUTES.find((r) => r.to === e.to)!
        return { ...route, label: e.label ?? route.label }
      })
  const sections: SidebarSection[] = [
    { key: "main", label: null, items: resolve(layout.main) },
    { key: "records", label: "Records", items: resolve(layout.records) },
    {
      key: "more",
      label: "More",
      items: resolve([...layout.more, ...unlisted]),
    },
  ]
  return sections.filter((s) => s.items.length > 0)
}

/** Routes not listed in the sidebar body. */
const EXTRA: NavItem[] = [
  { to: "/inbox", label: "Inbox", icon: BellIcon },
  { to: "/events/:id/checkout", label: "Checkout", icon: PackageCheckIcon },
  { to: "/events/:id/checkin", label: "Check-in", icon: PackageCheckIcon },
]

const ALL = [...ROUTES, ...EXTRA]

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
