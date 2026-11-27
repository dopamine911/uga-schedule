import { useQuery } from "@tanstack/react-query"
import { useNow } from "@/components/staff/shared"
import { api, unwrap } from "@/lib/api"
import { useCan, useHasRole, useTz, useUser } from "@/lib/auth"
import { buildUpcoming, unreadOf, upcomingState } from "@/pages/dashboard-data"

/** Everything the home page shows, fetched and derived once. */
export function useDashboardData() {
  const user = useUser()
  const can = useCan()
  const hasRole = useHasRole()
  const tz = useTz()
  const now = useNow()
  const isSponsor = hasRole("SPONSOR")
  const canRequest = can("event.create")

  const queue = useQuery({
    queryKey: ["queue"],
    queryFn: () => unwrap(api.queue.$get()),
    refetchInterval: 60_000,
  })
  const access = useQuery({
    queryKey: ["levels", "me"],
    queryFn: () => unwrap(api.levels.me.$get()),
  })
  const mine = useQuery({
    queryKey: ["events", "list", "mine", "all"],
    queryFn: () => unwrap(api.events.$get({ query: { scope: "mine" } })),
  })
  const sponsoring = useQuery({
    queryKey: ["events", "list", "sponsoring", "all"],
    queryFn: () => unwrap(api.events.$get({ query: { scope: "sponsoring" } })),
    enabled: isSponsor,
  })
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap(api.notifications.$get()),
  })

  const upcoming = buildUpcoming(mine.data, sponsoring.data, now)

  return {
    displayName: user.displayName,
    tz,
    now,
    canRequest,
    isSponsor,
    access,
    queue,
    notifications,
    upcomingQuery: upcomingState(mine, sponsoring, isSponsor, upcoming),
    unread: unreadOf(notifications.data),
    roles: user.roles.map((assignment) => assignment.role),
  }
}
