import {
  CalendarCheckIcon,
  CheckIcon,
  SearchCheckIcon,
  XIcon,
} from "lucide-react"
import {
  type DialogField,
  type EventSummary,
  TextActionDialog,
} from "@/components/events/shared"
import { Button } from "@/components/ui/button"
import { api, unwrap } from "@/lib/api"
import { humanize } from "@/lib/format"
import { useDecide } from "./useDecide"

export function SponsorDecisionActions({ ev }: { ev: EventSummary }) {
  const decide = useDecide(ev.id)
  const sponsorDecide = async (
    note: string,
    decision: "approve" | "reject"
  ) => {
    const done =
      decision === "approve"
        ? `Approved “${ev.title}”`
        : `Rejected “${ev.title}”`
    await decide(
      () =>
        unwrap(
          api.events[":id"]["sponsor-decision"].$post({
            param: { id: ev.id },
            json: { decision, note },
          })
        ),
      done
    )
  }

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
        description="Studio staff will be asked to confirm."
        fields={[{ name: "note", label: "Note", placeholder: "Optional" }]}
        confirmLabel="Approve"
        onSubmit={(v) => sponsorDecide(v.note ?? "", "approve")}
      />
      <TextActionDialog
        trigger={
          <Button variant="outline">
            <XIcon data-icon="inline-start" />
            Reject
          </Button>
        }
        title="Reject request"
        description="The requester and sponsor are notified with your reason."
        fields={[{ name: "note", label: "Reason", required: true }]}
        confirmLabel="Reject"
        destructive
        onSubmit={(v) => sponsorDecide(v.note ?? "", "reject")}
      />
    </>
  )
}

export function StaffDecisionActions({
  ev,
  overrides,
}: {
  ev: EventSummary
  overrides: string[]
}) {
  const decide = useDecide(ev.id)
  const confirmFields: DialogField[] = [
    { name: "note", label: "Note to requester", placeholder: "Optional" },
    ...(overrides.length
      ? [
          {
            name: "overrideReason",
            label: "Override reason",
            required: true,
            description: `Required to approve the requested exceptions: ${overrides.map(humanize).join(", ")}.`,
          } satisfies DialogField,
        ]
      : []),
  ]

  const staffConfirm = async (values: Record<string, string>) => {
    const json = {
      decision: "confirm" as const,
      note: values.note ?? "",
      overrideReason: values.overrideReason ?? "",
    }
    await decide(
      () =>
        unwrap(
          api.events[":id"]["staff-decision"].$post({
            param: { id: ev.id },
            json,
          })
        ),
      `Confirmed “${ev.title}”`
    )
  }

  const staffReject = async (values: Record<string, string>) => {
    const json = { decision: "reject" as const, note: values.note ?? "" }
    await decide(
      () =>
        unwrap(
          api.events[":id"]["staff-decision"].$post({
            param: { id: ev.id },
            json,
          })
        ),
      `Rejected “${ev.title}”`
    )
  }

  return (
    <>
      <TextActionDialog
        trigger={
          <Button>
            <CalendarCheckIcon data-icon="inline-start" />
            Confirm
          </Button>
        }
        title="Confirm request"
        description={
          overrides.length
            ? "This request has exceptions. Your reason is recorded as a policy override."
            : "The requester is notified that the booking is confirmed."
        }
        fields={confirmFields}
        confirmLabel="Confirm"
        onSubmit={staffConfirm}
      />
      <TextActionDialog
        trigger={
          <Button variant="outline">
            <XIcon data-icon="inline-start" />
            Reject
          </Button>
        }
        title="Reject request"
        description="The requester and sponsor are notified with your reason."
        fields={[{ name: "note", label: "Reason", required: true }]}
        confirmLabel="Reject"
        destructive
        onSubmit={staffReject}
      />
    </>
  )
}

export function ReviewResolveAction({ ev }: { ev: EventSummary }) {
  const decide = useDecide(ev.id)
  const resolveReview = async (values: Record<string, string>) => {
    const json = { reason: values.reason ?? "" }
    await decide(
      () =>
        unwrap(
          api.events[":id"]["resolve-review"].$post({
            param: { id: ev.id },
            json,
          })
        ),
      `Review resolved for “${ev.title}”`
    )
  }

  return (
    <TextActionDialog
      trigger={
        <Button variant="outline">
          <SearchCheckIcon data-icon="inline-start" />
          Resolve review
        </Button>
      }
      title="Resolve review"
      description="Accept the request as-is. Record why the review flag is cleared."
      fields={[{ name: "reason", label: "Reason", required: true }]}
      confirmLabel="Resolve"
      onSubmit={resolveReview}
    />
  )
}
