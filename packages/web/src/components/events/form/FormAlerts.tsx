import { Link } from "react-router"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { humanize } from "@/lib/format"
import type { Hold } from "./rules"

/** Notices above the form: the request is already in progress, and the requester has an active hold. */
export function FormAlerts({
  inProgress,
  activeHold,
}: {
  inProgress: boolean
  activeHold: Hold | undefined
}) {
  return (
    <>
      {inProgress && (
        <Alert>
          <AlertTitle>
            Changing a request that is already in progress
          </AlertTitle>
          <AlertDescription>
            Changing dates, studio or equipment sends this back to staff for
            confirmation. Changing the sponsor or event type needs sponsor
            approval again. Changing only the title, description or participants
            does not.
          </AlertDescription>
        </Alert>
      )}

      {activeHold && (
        <Alert variant="destructive">
          <AlertTitle>Your account has an active hold</AlertTitle>
          <AlertDescription>
            {humanize(activeHold.reason)}
            {activeHold.eventTitle ? ` on “${activeHold.eventTitle}”` : ""}. You
            can fill in this form, but it cannot be submitted until the hold is
            cleared.{" "}
            <Link to="/me/access" className="underline underline-offset-4">
              See details
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}
