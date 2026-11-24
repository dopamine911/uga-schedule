import { useQueries, useQuery } from "@tanstack/react-query"
import { checkoutQuery, useNow } from "@/components/staff/shared"
import { api, unwrap } from "@/lib/api"
import { useCan, useHasRole, useTz, useUser } from "@/lib/auth"
import { useDeskQueues } from "@/pages/staff/Desk"
import {
  actionsPending,
  activeHoldsOf,
  buildActions,
  buildUpcoming,
  countOverdue,
  expiringGrantsOf,
  unreadOf,
  upcomingState,
} from "@/pages/dashboard-data"

/** Everything the home page shows, fetched and derived once. */
export function useDashboardData() {
  const user = useUser()
  const can = useCan()
  const hasRole = useHasRole()
  const tz = useTz()
  const now = useNow()
  const isSponsor = hasRole("SPONSOR")
  const canRequest = can("event.create")
  const canDesk = can("checkout.perform")
  const canStaffDecide = can("event.staff_decide")

  const holds = useQuery({
    queryKey: ["holds", "mine"],
    queryFn: () => unwrap(api.holds.$get({ query: { scope: "mine" } })),
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
  const studio = useQuery({
    queryKey: ["events", "list", "studio", "all"],
    queryFn: () => unwrap(api.events.$get({ query: { scope: "studio" } })),
    enabled: canStaffDecide,
  })
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap(api.notifications.$get()),
  })
  const desk = useDeskQueues(canDesk)
  // Same checkout queries the desk uses, so overdue counts agree with the desk page.
  const outChecks = useQueries({
    queries: (desk.returns.data ?? []).map((e) => ({
      ...checkoutQuery(e.id),
      enabled: canDesk,
    })),
  })

  const upcoming = buildUpcoming(mine.data, sponsoring.data, now)

  return {
    displayName: user.displayName,
    tz,
    now,
    canRequest,
    canDesk,
    canStaffDecide,
    isSponsor,
    holds,
    access,
    notifications,
    desk,
    activeHolds: activeHoldsOf(holds.data),
    expiring: expiringGrantsOf(access.data?.grants),
    overdueOut: countOverdue(outChecks, now),
    awaitingConfirmation: {
      data: studio.data?.filter((e) => e.state === "SponsorApproved"),
      error: studio.error,
    },
    actions: buildActions(mine.data, sponsoring.data, studio.data),
    actionsLoading: actionsPending(
      mine,
      sponsoring,
      studio,
      isSponsor,
      canStaffDecide
    ),
    upcoming,
    upcomingQuery: upcomingState(mine, sponsoring, isSponsor, upcoming),
    unread: unreadOf(notifications.data),
  }
}
