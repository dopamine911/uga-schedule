import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon } from "lucide-react"
import { type ReactNode, useRef } from "react"
import { Link, useSearchParams } from "react-router"
import { ErrorAlert, LoadingBlock, StateBadge } from "@/components/common"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { api, unwrap } from "@/lib/api"
import { fmtDays, humanize } from "@/lib/format"

/** Search parameter that opens the quick-look panel: `?peek=<event id>` on any page. */
export const PEEK_PARAM = "peek"

/**
 * Link target that opens a request in the quick-look panel without leaving the current page.
 * Keeps the page's other search parameters (filters, tabs), so closing the panel returns to the same view.
 */
export function usePeekLink() {
  const [params] = useSearchParams()
  return (eventId: string) => {
    const next = new URLSearchParams(params)
    next.set(PEEK_PARAM, eventId)
    return { search: `?${next.toString()}` }
  }
}

/**
 * Slide-in quick look at one request, opened from lists and calendars via `?peek=<id>`. Read-only on purpose:
 * decisions and desk actions stay on the full request page, whose buttons follow the API's permission flags.
 * Shares the full page's query cache, so opening the full page afterwards is instant.
 */
export function EventPeek() {
  const [params, setParams] = useSearchParams()
  const eventId = params.get(PEEK_PARAM)
  // The panel opens from a link, not a Radix trigger, so Radix cannot return focus on close by itself.
  // Remember what had focus as the panel opens (still the clicked link at that moment) and restore it.
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const close = () => {
    const next = new URLSearchParams(params)
    next.delete(PEEK_PARAM)
    setParams(next)
  }
  return (
    <Sheet open={!!eventId} onOpenChange={(open) => !open && close()}>
      <SheetContent
        className="flex w-full flex-col gap-0 sm:max-w-md"
        onOpenAutoFocus={() => {
          returnFocusTo.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
        }}
        onCloseAutoFocus={(focusEvent) => {
          if (returnFocusTo.current?.isConnected) {
            focusEvent.preventDefault()
            returnFocusTo.current.focus()
          }
        }}
      >
        {eventId && <PeekBody eventId={eventId} />}
      </SheetContent>
    </Sheet>
  )
}

function PeekBody({ eventId }: { eventId: string }) {
  const query = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id: eventId } })),
  })
  if (query.error)
    return (
      <div className="p-4">
        <SheetTitle className="sr-only">Request</SheetTitle>
        <ErrorAlert error={query.error} />
      </div>
    )
  if (!query.data)
    return (
      <div className="p-4">
        <SheetTitle className="sr-only">Loading request</SheetTitle>
        <LoadingBlock rows={4} />
      </div>
    )
  const ev = query.data
  return (
    <>
      <SheetHeader className="border-b">
        <div>
          <StateBadge state={ev.state} />
        </div>
        <SheetTitle className="text-2xl">{ev.title}</SheetTitle>
        <SheetDescription>
          {ev.nextAction ?? "No step pending."}
        </SheetDescription>
      </SheetHeader>
      <dl className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
        <Fact label="When">{fmtDays(ev.days)}</Fact>
        <Fact label="Studio">{ev.studio.name}</Fact>
        <Fact label="Requester">{ev.requester.displayName}</Fact>
        <Fact label="Sponsor">{ev.sponsor?.displayName ?? "None"}</Fact>
        <Fact label="Type">{ev.eventType.name}</Fact>
        <Fact label="Equipment">
          {ev.lines.length ? (
            <ul className="flex flex-col gap-1">
              {ev.lines.map((line) => (
                <li key={line.id}>
                  {line.qty} × {line.typeName}
                </li>
              ))}
            </ul>
          ) : (
            "None requested"
          )}
        </Fact>
        {ev.needsReview && ev.reviewReasons.length > 0 && (
          <Fact label="Needs review">
            {ev.reviewReasons.map((reason) => humanize(reason)).join(", ")}
          </Fact>
        )}
        {ev.decisionNote && (
          <Fact label="Decision note">{ev.decisionNote}</Fact>
        )}
      </dl>
      <SheetFooter className="border-t">
        <Button asChild>
          <Link to={`/events/${ev.id}`}>
            Open full request
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </SheetFooter>
    </>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  )
}
