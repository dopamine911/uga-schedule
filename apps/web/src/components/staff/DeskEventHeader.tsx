import type { EventState } from "@studio/domain"
import { ArrowLeftIcon } from "lucide-react"
import { Link } from "react-router"
import { PageHeader, StateBadge } from "@/components/common"
import { Button } from "@/components/ui/button"

/** Page header of the desk's check-out and check-in pages for one event. */
export function DeskEventHeader({
  action,
  event,
}: {
  /** Title prefix: "Check out" or "Check in". */
  action: string
  event: {
    id: string
    title: string
    state: EventState
    requester: { displayName: string }
    studio: { name: string }
  }
}) {
  return (
    <PageHeader
      title={`${action}: ${event.title}`}
      description={`${event.requester.displayName} · ${event.studio.name}`}
      actions={
        <>
          <StateBadge state={event.state} />
          <Button variant="outline" asChild>
            <Link to={`/events/${event.id}`}>
              <ArrowLeftIcon data-icon="inline-start" />
              Back to event
            </Link>
          </Button>
        </>
      }
    />
  )
}
