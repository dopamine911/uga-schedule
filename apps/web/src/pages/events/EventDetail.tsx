import { useQuery } from "@tanstack/react-query"
import { CalendarDaysIcon } from "lucide-react"
import { useParams } from "react-router"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import type { EventDetail } from "@/components/events/shared"
import { ApiError, api, unwrap } from "@/lib/api"
import { eventTypeIcon } from "@/lib/icons"
import {
  CheckoutsCard,
  HoldsCard,
  PolicyOverridesCard,
} from "./eventDetail/FulfilmentCards"
import {
  EventHeaderActions,
  EventHeaderDescription,
} from "./eventDetail/HeaderActions"
import { PreEventTasksCard } from "./eventDetail/PreEventTasksCard"
import {
  DaysCard,
  DetailsCard,
  EquipmentCard,
  LifecycleCard,
  NeedsReviewAlert,
} from "./eventDetail/SummaryCards"

// F-006 event page. Every action button is driven by the API `can` flags; the API enforces them again.

export function EventDetailPage() {
  const { id } = useParams()
  const query = useQuery({
    queryKey: ["event", id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id: id! } })),
    enabled: !!id,
  })
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <>
        <PageHeader title="Request not found" />
        <EmptyState
          icon={CalendarDaysIcon}
          title="We couldn't find that request"
          description="It may have been removed, or you may not have access to it."
        />
      </>
    )
  }
  return (
    <QueryView query={query} rows={5}>
      {(ev) => <EventDetailView ev={ev} />}
    </QueryView>
  )
}

function EventDetailView({ ev }: { ev: EventDetail }) {
  return (
    <>
      <PageHeader
        icon={eventTypeIcon(ev.eventType.name)}
        title={ev.title}
        description={<EventHeaderDescription ev={ev} />}
        actions={<EventHeaderActions ev={ev} />}
      />

      <LifecycleCard ev={ev} />

      {ev.needsReview && <NeedsReviewAlert ev={ev} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailsCard ev={ev} />
        <DaysCard ev={ev} />
      </div>

      <EquipmentCard ev={ev} />
      <PreEventTasksCard ev={ev} />
      <CheckoutsCard ev={ev} />
      {ev.holds.length > 0 && <HoldsCard ev={ev} />}
      {ev.policyOverrides.length > 0 && <PolicyOverridesCard ev={ev} />}
    </>
  )
}
