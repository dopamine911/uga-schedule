import { useQuery } from "@tanstack/react-query"
import { CheckCircle2Icon } from "lucide-react"
import { Link, useParams } from "react-router"
import { EmptyState, ErrorAlert, LoadingBlock } from "@/components/common"
import { DeskEventHeader } from "@/components/staff/DeskEventHeader"
import { type CheckinResult, checkoutQuery } from "@/components/staff/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"
import { CheckinBody } from "./checkin/CheckinSections"
import {
  useCheckinEntries,
  useLostAfterDays,
} from "./checkin/useCheckinEntries"

export function CheckinPage() {
  const { id = "" } = useParams()
  const tz = useTz()
  const event = useQuery({
    queryKey: ["event", id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id } })),
  })
  const co = useQuery(checkoutQuery(id))
  const entries = useCheckinEntries(id, co.data)
  const lostAfterDays = useLostAfterDays()

  if (co.isPending || event.isPending) return <LoadingBlock rows={4} />
  if (co.error) return <ErrorAlert error={co.error} />
  if (event.error) return <ErrorAlert error={event.error} />
  const ev = event.data

  return (
    <div className="flex flex-col gap-6">
      <DeskEventHeader action="Check in" event={ev} />

      {entries.result && (
        <ResultPanel
          result={entries.result}
          labels={entries.labels}
          eventId={id}
          tz={tz}
        />
      )}

      {entries.rows.length === 0 ? (
        <NothingOutstanding hasResult={entries.result !== null} eventId={id} />
      ) : (
        <CheckinBody
          entries={entries}
          requesterName={ev.requester.displayName}
          tz={tz}
          lostAfterDays={lostAfterDays}
        />
      )}
    </div>
  )
}

function NothingOutstanding({
  hasResult,
  eventId,
}: {
  hasResult: boolean
  eventId: string
}) {
  if (hasResult) return null
  return (
    <EmptyState
      icon={CheckCircle2Icon}
      title="Nothing outstanding"
      description="Every checked-out item for this event has been returned."
    >
      <Button variant="outline" asChild>
        <Link to={`/events/${eventId}`}>Back to event</Link>
      </Button>
    </EmptyState>
  )
}

function ResultPanel({
  result,
  labels,
  eventId,
  tz,
}: {
  result: CheckinResult
  labels: Record<string, string>
  eventId: string
  tz: string
}) {
  const event = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id: eventId } })),
  })
  const activeHolds = (event.data?.holds ?? []).filter(
    (h) => h.status === "active"
  )
  return (
    <Alert>
      <CheckCircle2Icon />
      <AlertTitle>
        {result.complete
          ? "All equipment is back. Check-in complete."
          : "Check-in saved. Items are still out."}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {result.items.map((i) => (
            <li key={i.recordId}>
              <span className="font-medium">
                {labels[i.recordId] ?? "Checked in earlier"}
              </span>
              : OK {i.qtyOk} · damaged {i.qtyDamaged} · missing {i.qtyMissing}
              {i.outstanding > 0 ? ` · ${i.outstanding} still out` : ""}
              {i.late ? " · returned late" : ""}
            </li>
          ))}
        </ul>
        {activeHolds.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-medium">Active holds on this event</p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {activeHolds.map((h) => (
                <li key={h.id}>
                  {humanize(h.reason)}: {h.note}
                  {h.autoClearAt
                    ? ` (auto-clears ${fmtInstant(h.autoClearAt, tz)})`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/events/${eventId}`}>Back to event</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
