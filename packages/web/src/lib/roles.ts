import type { Permission, RoleCode, Scope } from "@studio/domain"
import {
  BoxesIcon,
  GraduationCapIcon,
  type LucideIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  WrenchIcon,
} from "lucide-react"

// Plain-language descriptions of roles and permissions (F-001 §2–3) for the user administration screens.

export const ROLE_INFO: Record<
  RoleCode,
  { label: string; summary: string; icon: LucideIcon; scoped: boolean }
> = {
  STUDENT: {
    label: "Student",
    summary:
      "Requests studio time and equipment, sees their own bookings, holds and results.",
    icon: GraduationCapIcon,
    scoped: false,
  },
  SPONSOR: {
    label: "Sponsor",
    summary:
      "Faculty or staff who approve or reject the requests they sponsor and sign off results.",
    icon: UserCheckIcon,
    scoped: false,
  },
  STUDIO_STAFF: {
    label: "Studio staff",
    summary:
      "Confirms requests, checks equipment out and in, and publishes results — for one studio per assignment.",
    icon: WrenchIcon,
    scoped: true,
  },
  EQUIPMENT_MANAGER: {
    label: "Equipment manager",
    summary:
      "Runs the inventory, levels, courses and grants, and clears holds.",
    icon: BoxesIcon,
    scoped: false,
  },
  ADMIN: {
    label: "Admin",
    summary:
      "Full control: users and roles, studios, event types, policies and the audit log.",
    icon: ShieldCheckIcon,
    scoped: false,
  },
}

/** Roles that grant broad control; assigning them asks for confirmation. */
export const ELEVATED_ROLES: readonly RoleCode[] = [
  "ADMIN",
  "EQUIPMENT_MANAGER",
]

export const PERMISSION_LABELS: Record<Permission, string> = {
  "event.create": "Request studio time",
  "event.view": "View events",
  "event.edit": "Edit events",
  "event.cancel": "Cancel events",
  "event.sponsor_decide": "Approve as sponsor",
  "event.staff_decide": "Confirm as staff",
  "event.override_policy": "Approve policy exceptions",
  "stage.complete_task": "Complete pre-event tasks",
  "stage.override_block": "Override blocking tasks",
  "checkout.perform": "Check equipment out and in",
  "results.upload": "Upload results",
  "results.view": "View results",
  "inventory.view": "Browse the catalog",
  "inventory.manage": "Manage inventory",
  "unit.set_status": "Change item status",
  "level.manage": "Manage levels",
  "course.manage": "Manage courses and rosters",
  "grant.manage": "Grant and revoke levels",
  "hold.view": "View holds",
  "hold.clear": "Clear holds",
  "studio.manage": "Manage studios",
  "event_type.manage": "Manage event types",
  "policy.manage": "Manage policies",
  "role.assign": "Manage users and roles",
  "audit.view": "View the audit log",
  "user.list": "Look up users",
}

export const SCOPE_LABELS: Record<Scope, string> = {
  all: "All",
  own: "Own",
  studio: "Their studio",
}
