import {
  BanIcon,
  CalendarCheckIcon,
  CheckIcon,
  FileTextIcon,
  PackageCheckIcon,
  PackageOpenIcon,
  PencilIcon,
  SearchCheckIcon,
  XIcon,
} from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import { StateBadge } from "@/components/common"
import {
  type EventDetail,
  ReviewBadges,
  TextActionDialog,
  useInvalidateEvent,
} from "@/components/events/shared"
import { SubmitDialog } from "@/components/events/SubmitDialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { api, unwrap } from "@/lib/api"
import { useUser } from "@/lib/auth"
import { humanize } from "@/lib/format"
import { cancelFields, isOwnRequest, staffFields } from "./fields"

/** Runs an event action: awaits it, refreshes the event and confirms with a toast. */
type Act = (label: string, run: () => Promise<unknown>) => Promise<void>

function useEventAct(eventId: string): Act {
  const invalidate = useInvalidateEvent()
  return async (label, run) => {
    await run()
    await invalidate(eventId)
    toast.success(label)
  }
}

interface ActionProps {
  ev: EventDetail
  act: Act
}

/** State, review flags and next step shown under the page title. */
export function EventHeaderDescription({ ev }: { ev: EventDetail }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StateBadge state={ev.state} />
      <ReviewBadges
        needsReview={ev.needsReview}
        reviewReasons={ev.reviewReasons}
        overrideRequested={ev.overrideRequested}
      />
      {ev.nextAction && <span>Next: {ev.nextAction}</span>}
    </span>
  )
}

/** Every action button is driven by the API `can` flags; the API enforces them again. */
export function EventHeaderActions({ ev }: { ev: EventDetail }) {
  const act = useEventAct(ev.id)
  return (
    <>
      {ev.can.edit && (
        <Button variant="outline" asChild>
          <Link to={`/events/${ev.id}/edit`}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Link>
        </Button>
      )}
      {ev.can.submit && <SubmitDialog ev={ev} />}
      {ev.can.sponsorDecide && <SponsorDecisionActions ev={ev} act={act} />}
      {ev.can.staffDecide && <StaffDecisionActions ev={ev} act={act} />}
      {ev.can.resolveReview && <ResolveReviewAction ev={ev} act={act} />}
      {ev.can.cancel && <CancelAction ev={ev} act={act} />}
      <FulfilmentLinks ev={ev} />
    </>
  )
}

function SponsorDecisionActions({ ev, act }: ActionProps) {
  return (
    <>
      <TextActionDialog
        trigger={
          <Button>
            <CheckIcon data-icon="inline-start" />
            Approve
          </Button>
        }
        title="Approve request"
        description="Studio staff confirm the booking after you approve."
        fields={[{ name: "note", label: "Note", required: false }]}
        confirmLabel="Approve"
        onSubmit={(v) =>
          act("Approved", () =>
            unwrap(
              api.events[":id"]["sponsor-decision"].$post({
                param: { id: ev.id },
                json: { decision: "approve", note: v.note ?? "" },
              })
            )
          )
        }
      />
      <TextActionDialog
        trigger={
          <Button variant="destructive">
            <XIcon data-icon="inline-start" />
            Reject
          </Button>
        }
        title="Reject request"
        fields={[{ name: "note", label: "Reason", required: true }]}
        confirmLabel="Reject"
        destructive
        onSubmit={(v) =>
          act("Rejected", () =>
            unwrap(
              api.events[":id"]["sponsor-decision"].$post({
                param: { id: ev.id },
                json: { decision: "reject", note: v.note ?? "" },
              })
            )
          )
        }
      />
    </>
  )
}

function StaffDecisionActions({ ev, act }: ActionProps) {
  return (
    <>
      <TextActionDialog
        trigger={
          <Button>
            <CalendarCheckIcon data-icon="inline-start" />
            Confirm
          </Button>
        }
        title="Confirm booking"
        description="Confirming holds the studio and opens the pre-event tasks."
        fields={staffFields(ev.overrideRequested)}
        confirmLabel="Confirm"
        onSubmit={(v) =>
          act("Confirmed", () =>
            unwrap(
              api.events[":id"]["staff-decision"].$post({
                param: { id: ev.id },
                json: {
                  decision: "confirm",
                  note: v.note ?? "",
                  overrideReason: v.overrideReason || undefined,
                },
              })
            )
          )
        }
      >
        {ev.overrideRequested.length > 0 && <OverrideRequestAlert ev={ev} />}
      </TextActionDialog>
      <TextActionDialog
        trigger={
          <Button variant="destructive">
            <XIcon data-icon="inline-start" />
            Reject
          </Button>
        }
        title="Reject request"
        fields={[{ name: "note", label: "Reason", required: true }]}
        confirmLabel="Reject"
        destructive
        onSubmit={(v) =>
          act("Rejected", () =>
            unwrap(
              api.events[":id"]["staff-decision"].$post({
                param: { id: ev.id },
                json: { decision: "reject", note: v.note ?? "" },
              })
            )
          )
        }
      />
    </>
  )
}

/** The student's exception request, shown to staff inside the confirm dialog. */
function OverrideRequestAlert({ ev }: { ev: EventDetail }) {
  return (
    <Alert>
      <AlertTitle>Exception requested by the student</AlertTitle>
      <AlertDescription>
        <p>{ev.overrideJustification || "No justification given."}</p>
        <p className="text-muted-foreground">
          {ev.overrideRequested.map(humanize).join(", ")}
        </p>
      </AlertDescription>
    </Alert>
  )
}

function ResolveReviewAction({ ev, act }: ActionProps) {
  return (
    <TextActionDialog
      trigger={
        <Button variant="outline">
          <SearchCheckIcon data-icon="inline-start" />
          Resolve review
        </Button>
      }
      title="Accept request as-is"
      description={`Flagged: ${ev.reviewReasons.map(humanize).join(", ")}.`}
      fields={[{ name: "reason", label: "Reason", required: true }]}
      confirmLabel="Accept"
      onSubmit={(v) =>
        act("Review resolved", () =>
          unwrap(
            api.events[":id"]["resolve-review"].$post({
              param: { id: ev.id },
              json: { reason: v.reason ?? "" },
            })
          )
        )
      }
    />
  )
}

function CancelAction({ ev, act }: ActionProps) {
  const me = useUser()
  return (
    <TextActionDialog
      trigger={
        <Button variant="outline">
          <BanIcon data-icon="inline-start" />
          Cancel request
        </Button>
      }
      title="Cancel request"
      description="Cancelling releases the studio and equipment."
      fields={cancelFields(isOwnRequest(ev, me.id))}
      confirmLabel="Cancel request"
      destructive
      onSubmit={(v) =>
        act("Cancelled", () =>
          unwrap(
            api.events[":id"].cancel.$post({
              param: { id: ev.id },
              json: { reason: v.reason ?? "" },
            })
          )
        )
      }
    />
  )
}

/** Links to the checkout, check-in and results pages of the request. */
function FulfilmentLinks({ ev }: { ev: EventDetail }) {
  return (
    <>
      {ev.can.checkout && (
        <Button variant="outline" asChild>
          <Link to={`/events/${ev.id}/checkout`}>
            <PackageOpenIcon data-icon="inline-start" />
            Check out
          </Link>
        </Button>
      )}
      {ev.can.checkin && (
        <Button variant="outline" asChild>
          <Link to={`/events/${ev.id}/checkin`}>
            <PackageCheckIcon data-icon="inline-start" />
            Check in
          </Link>
        </Button>
      )}
      {ev.resultPackage && (
        <Button variant="outline" asChild>
          <Link to={`/results/${ev.id}`}>
            <FileTextIcon data-icon="inline-start" />
            Results
          </Link>
        </Button>
      )}
    </>
  )
}
