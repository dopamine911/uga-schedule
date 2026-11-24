import type { Permission } from "@studio/domain"
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
    label: "My work",
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
  return ALL.filter((i) => matches(i.to, pathname)).sort((a, b) => b.to.length - a.to.length)[0]
}

export function routeIcon(pathname: string): LucideIcon {
  return routeFor(pathname)?.icon ?? LayoutDashboardIcon
}
