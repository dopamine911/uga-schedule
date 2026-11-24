import type { DialogField, EventDetail } from "@/components/events/shared"
import { humanize } from "@/lib/format"

/** True when the user is the requester or the sponsor of the request. */
export function isOwnRequest(ev: EventDetail, userId: string): boolean {
  return ev.requester.id === userId || ev.sponsor?.id === userId
}

/** Cancel dialog fields: a reason is only required when cancelling someone else's request. */
export function cancelFields(ownRequest: boolean): DialogField[] {
  return [
    {
      name: "reason",
      label: "Reason",
      required: !ownRequest,
      description: ownRequest
        ? undefined
        : "Required when you cancel someone else's request.",
    },
  ]
}

/** Staff confirm dialog fields: an override reason is required when the student asked for exceptions. */
export function staffFields(
  overrideCodes: EventDetail["overrideRequested"]
): DialogField[] {
  return [
    { name: "note", label: "Note to the requester", required: false },
    ...(overrideCodes.length
      ? [
          {
            name: "overrideReason",
            label: "Reason for the policy exception",
            required: true,
            description: `Approves: ${overrideCodes.map(humanize).join(", ")}.`,
          } satisfies DialogField,
        ]
      : []),
  ]
}
