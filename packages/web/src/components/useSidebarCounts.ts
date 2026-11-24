import { useQuery } from "@tanstack/react-query"
import { api, unwrap } from "@/lib/api"
import { useCan, useHasRole } from "@/lib/auth"
import { useDeskQueues } from "@/pages/staff/Desk"

/**
 * Number of waiting items per sidebar route, so users can see where work waits without opening each page
 * (the prototype's sidebar counts). Reuses the queries and cache keys the dashboard and desk already load,
 * so no extra requests are made once those pages have been visited. Routes with nothing waiting are left out.
 */
export function useSidebarCounts(): Record<string, number> {
  const can = useCan()
  const hasRole = useHasRole()
  const isSponsor = hasRole("SPONSOR")
  const canStaffDecide = can("event.staff_decide")
  const canDesk = can("checkout.perform")

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
  const desk = useDeskQueues(canDesk)

  // Same rules as the dashboard's "Needs your action": sponsor approvals plus staff confirmations and reviews.
  const decisionIds = new Set<string>([
    ...(sponsoring.data ?? [])
      .filter((event) => event.state === "Submitted")
      .map((event) => event.id),
    ...(studio.data ?? [])
      .filter((event) => event.state === "SponsorApproved" || event.needsReview)
      .map((event) => event.id),
  ])
  const deskCount =
    (desk.pickups.data?.length ?? 0) + (desk.returns.data?.length ?? 0)

  const counts: Record<string, number> = {}
  if (decisionIds.size > 0) counts["/approvals"] = decisionIds.size
  if (canDesk && deskCount > 0) counts["/desk"] = deskCount
  return counts
}
