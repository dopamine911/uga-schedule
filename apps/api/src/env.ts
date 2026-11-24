import type { RoleAssignmentLike } from "@studio/domain"
import type { DB } from "./db/client.ts"

export interface SessionUser {
  id: string
  email: string
  displayName: string
  affiliation: string
  roles: RoleAssignmentLike[]
}

export interface AppEnv {
  Variables: {
    db: DB
    user: SessionUser | null
  }
}
