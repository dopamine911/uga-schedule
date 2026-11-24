import type { RoleCode } from "./enums.ts"

// F-001 §3 permission matrix.
// "all" = unrestricted, "own" = only own/sponsored records, "studio" = only assigned studios.
export type Scope = "all" | "own" | "studio"

export const PERMISSIONS = [
  "event.create",
  "event.view",
  "event.edit",
  "event.cancel",
  "event.sponsor_decide",
  "event.staff_decide",
  "event.override_policy",
  "stage.complete_task",
  "stage.override_block",
  "checkout.perform",
  "results.upload",
  "results.view",
  "inventory.view",
  "inventory.manage",
  "unit.set_status",
  "level.manage",
  "course.manage",
  "grant.manage",
  "hold.view",
  "hold.clear",
  "studio.manage",
  "event_type.manage",
  "policy.manage",
  "role.assign",
  "audit.view",
  "user.list",
] as const
export type Permission = (typeof PERMISSIONS)[number]

const MATRIX: Record<RoleCode, Partial<Record<Permission, Scope>>> = {
  STUDENT: {
    "event.create": "own",
    "event.view": "own",
    "event.edit": "own",
    "event.cancel": "own",
    "stage.complete_task": "own",
    "results.upload": "own",
    "results.view": "own",
    "inventory.view": "all",
    "hold.view": "own",
  },
  SPONSOR: {
    "event.view": "own",
    "event.cancel": "own",
    "event.sponsor_decide": "own",
    "stage.complete_task": "own",
    "results.view": "own",
    "inventory.view": "all",
    "hold.view": "own",
  },
  STUDIO_STAFF: {
    "event.view": "studio",
    "event.edit": "studio",
    "event.cancel": "studio",
    "event.staff_decide": "studio",
    "event.override_policy": "studio",
    "stage.complete_task": "studio",
    "stage.override_block": "studio",
    "checkout.perform": "studio",
    "results.upload": "studio",
    "results.view": "studio",
    "inventory.view": "all",
    "unit.set_status": "studio",
    "hold.view": "studio",
    "user.list": "all",
  },
  EQUIPMENT_MANAGER: {
    "event.view": "all",
    "checkout.perform": "all",
    "results.view": "all",
    "inventory.view": "all",
    "inventory.manage": "all",
    "unit.set_status": "all",
    "level.manage": "all",
    "course.manage": "all",
    "grant.manage": "all",
    "hold.view": "all",
    "hold.clear": "all",
    "audit.view": "all",
    "user.list": "all",
  },
  // Admin holds every permission unrestricted.
  ADMIN: Object.fromEntries(PERMISSIONS.map((p) => [p, "all"])) as Record<Permission, Scope>,
}

export interface RoleAssignmentLike {
  role: RoleCode
  studioId: string | null
}

export interface PermissionContext {
  /** True when the record belongs to (or is sponsored by / involves) the caller. */
  own?: boolean
  /** Studio the record lives in. */
  studioId?: string | null
}

/**
 * Server-side permission check (BR-001-12).
 * Without a context, answers "does the user hold this permission in any scope" (useful for menus).
 */
export function can(assignments: readonly RoleAssignmentLike[], perm: Permission, ctx?: PermissionContext): boolean {
  for (const a of assignments) {
    const scope = MATRIX[a.role][perm]
    if (!scope) continue
    if (!ctx) return true
    if (scope === "all") return true
    if (scope === "own" && ctx.own) return true
    if (scope === "studio" && ctx.studioId != null && a.studioId === ctx.studioId) return true
  }
  return false
}

/** Studios in which the user holds a studio-scoped permission. */
export function studiosFor(assignments: readonly RoleAssignmentLike[], perm: Permission): string[] {
  return assignments
    .filter((a) => MATRIX[a.role][perm] === "studio" && a.studioId)
    .map((a) => a.studioId as string)
}

export function hasUnscoped(assignments: readonly RoleAssignmentLike[], perm: Permission): boolean {
  return assignments.some((a) => MATRIX[a.role][perm] === "all")
}
