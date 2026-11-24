import type { Denial, RoleAssignmentLike } from "@studio/domain"
import type { DB } from "./db/client.ts"

export interface SessionUser {
  id: string
  email: string
  displayName: string
  affiliation: string
  roles: RoleAssignmentLike[]
  /** Permissions an Admin removed from this user, everywhere or per studio (BR-001-14/15). */
  denied: Denial[]
}

export interface AppEnv {
  Variables: {
    db: DB
    user: SessionUser | null
  }
}
