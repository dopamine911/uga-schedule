import { useQuery } from "@tanstack/react-query"
import type { DraftForm } from "@/components/events/draft"
import type { EventDetail } from "@/components/events/shared"
import { useNow } from "@/components/staff/shared"
import { api, unwrap } from "@/lib/api"
import { useTz, useUser } from "@/lib/auth"
import { isOwnRequest } from "./rules"

/** Reference data the request form reads: event types, studios, sponsors, equipment, notice policies and the requester's holds. */
export function useEventFormData(
  form: DraftForm,
  detail: EventDetail | undefined
) {
  const me = useUser()
  const types = useQuery({
    queryKey: ["event-types"],
    queryFn: () => unwrap(api["event-types"].$get()),
  })
  const studios = useQuery({
    queryKey: ["studios"],
    queryFn: () => unwrap(api.studios.$get()),
  })
  const policies = useQuery({
    queryKey: ["policies"],
    queryFn: () => unwrap(api.policies.$get()),
  })
  const holds = useQuery({
    queryKey: ["holds", "mine"],
    queryFn: () => unwrap(api.holds.$get({ query: { scope: "mine" } })),
  })
  const equipmentTypes = useQuery({
    queryKey: ["equipment", "types"],
    queryFn: () => unwrap(api.equipment.types.$get({ query: {} })),
  })
  const sponsors = useQuery({
    queryKey: ["users", "sponsors"],
    queryFn: () => unwrap(api.users.sponsors.$get()),
  })
  const tz = useTz()
  const nowMs = useNow()

  const ownRequest = isOwnRequest(detail, me.id)
  return {
    types: types.data,
    typesPending: types.isPending,
    studios: studios.data,
    equipmentTypes: equipmentTypes.data,
    sponsors: sponsors.data,
    type: types.data?.find((t) => t.id === form.eventTypeId),
    studio: studios.data?.find((s) => s.id === form.studioId),
    activeHold: ownRequest
      ? (holds.data ?? []).find((h) => h.status === "active")
      : undefined,
    notice: ownRequest ? policies.data : undefined,
    tz,
    nowMs,
  }
}
