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

/** What a role may do and in which scope (read-only view of the F-001 matrix, for admin screens). */
export function rolePermissions(role: RoleCode): Partial<Record<Permission, Scope>> {
  return MATRIX[role]
}

export interface RoleAssignmentLike {
  role: RoleCode
  studioId: string | null
}

/**
 * A permission an Admin removed from one user (BR-001-14): everywhere when `studioId` is null,
 * or only for records in that studio (BR-001-15).
 */
export interface Denial {
  permission: Permission
  studioId: string | null
}

/** Who is asking: their role assignments plus permissions removed from them individually. */
export interface Principal {
  roles: readonly RoleAssignmentLike[]
  denied?: readonly Denial[]
}

export interface PermissionContext {
  /** True when the record belongs to (or is sponsored by / involves) the caller. */
  own?: boolean
  /** Studio the record lives in. */
  studioId?: string | null
}

function deniedEverywhere(p: Principal, perm: Permission): boolean {
  return p.denied?.some((d) => d.permission === perm && d.studioId === null) ?? false
}

function deniedAt(p: Principal, perm: Permission, studioId: string): boolean {
  return p.denied?.some((d) => d.permission === perm && d.studioId === studioId) ?? false
}

/**
 * Studios where `perm` was removed for this user while it may still apply elsewhere. List queries that
 * rely on hasUnscoped() must drop records in these studios.
 */
export function deniedStudios(p: Principal, perm: Permission): string[] {
  return (p.denied ?? []).filter((d) => d.permission === perm && d.studioId !== null).map((d) => d.studioId as string)
}

/**
 * Server-side permission check (BR-001-12).
 * Without a context, answers "does the user hold this permission in any scope" (useful for menus).
 * A studio removal blocks that studio's records whichever role grants access, including "all" scope.
 */
export function can(p: Principal, perm: Permission, ctx?: PermissionContext): boolean {
  if (deniedEverywhere(p, perm)) return false
  if (ctx?.studioId != null && deniedAt(p, perm, ctx.studioId)) return false
  for (const a of p.roles) {
    const scope = MATRIX[a.role][perm]
    if (!scope) continue
    // A studio-scoped grant whose studio was removed grants nothing.
    if (scope === "studio" && a.studioId != null && deniedAt(p, perm, a.studioId)) continue
    if (!ctx) return true
    if (scope === "all") return true
    if (scope === "own" && ctx.own) return true
    if (scope === "studio" && ctx.studioId != null && a.studioId === ctx.studioId) return true
  }
  return false
}

/** Studios in which the user holds a studio-scoped permission (minus removed studios). */
export function studiosFor(p: Principal, perm: Permission): string[] {
  if (deniedEverywhere(p, perm)) return []
  return p.roles
    .filter((a) => MATRIX[a.role][perm] === "studio" && a.studioId && !deniedAt(p, perm, a.studioId))
    .map((a) => a.studioId as string)
}

/** Holds the permission in "all" scope. Callers listing records must still exclude deniedStudios(). */
export function hasUnscoped(p: Principal, perm: Permission): boolean {
  return !deniedEverywhere(p, perm) && p.roles.some((a) => MATRIX[a.role][perm] === "all")
}

/** Permissions that some role grants per studio; only these can be removed for a single studio. */
export const STUDIO_SCOPED_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((perm) =>
  Object.values(MATRIX).some((grants) => grants[perm] === "studio"),
)

export interface PermissionGrant {
  permission: Permission
  /** Each role assignment that grants it, with the scope it grants. */
  sources: { role: RoleCode; studioId: string | null; scope: Scope }[]
  /** Removed everywhere. */
  denied: boolean
  /** Studios where it was removed (BR-001-15). */
  deniedStudioIds: string[]
}

/** Every permission the roles grant, and where it was individually removed (for admin screens). */
export function effectivePermissions(p: Principal): PermissionGrant[] {
  return PERMISSIONS.flatMap((permission) => {
    const sources = p.roles.flatMap((a) => {
      const scope = MATRIX[a.role][permission]
      return scope ? [{ role: a.role, studioId: a.studioId, scope }] : []
    })
    return sources.length
      ? [
          {
            permission,
            sources,
            denied: deniedEverywhere(p, permission),
            deniedStudioIds: deniedStudios(p, permission),
          },
        ]
      : []
  })
}
