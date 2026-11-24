import { type Permission, type PermissionContext, can } from "@studio/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, unwrap } from "@/lib/api"

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => unwrap(api.auth.me.$get()), staleTime: 60_000 })
}

/** The signed-in user. Only use below <RequireAuth>, where the user is guaranteed. */
export function useUser() {
  const { data } = useMe()
  if (!data?.user) throw new Error("useUser() used outside an authenticated route")
  return data.user
}

/** Campus time zone used for every displayed date/time. */
export function useTz(): string {
  return useMe().data?.tz ?? "America/Chicago"
}

/** UI-side permission check for showing/hiding controls. The API enforces the same rules. */
export function useCan() {
  const user = useUser()
  return (perm: Permission, ctx?: PermissionContext) => can(user, perm, ctx)
}

export function useHasRole() {
  const user = useUser()
  return (...roles: string[]) => {
    const wanted = new Set(roles)
    return user.roles.some((r) => wanted.has(r.role))
  }
}

export function useSignOut() {
  const qc = useQueryClient()
  return async () => {
    await unwrap(api.auth.logout.$post())
    qc.clear()
    window.location.assign("/login")
  }
}
