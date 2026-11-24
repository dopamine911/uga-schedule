import { toast } from "sonner"
import { TextActionDialog } from "@/components/events/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"
import {
  type PackageData,
  type PackageFlags,
  publishFields,
  statusBadgeVariant,
} from "./model"
import { useRefreshPackage } from "./usePackageRefresh"

export function PackageHeaderDescription({
  pkg,
  expired,
}: {
  pkg: PackageData
  expired: boolean
}) {
  const tz = useTz()
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge variant={statusBadgeVariant(pkg.status)}>
        {humanize(pkg.status)}
      </Badge>
      {pkg.publishedAt && <span>Published {fmtInstant(pkg.publishedAt, tz)}</span>}
      {pkg.retainUntil !== null && pkg.daysLeft !== null && !expired && (
        <span>
          · {pkg.daysLeft} days left to download, until{" "}
          {fmtInstant(pkg.retainUntil, tz)}
        </span>
      )}
    </span>
  )
}

export function PackageHeaderActions({
  eventId,
  pkg,
  flags,
}: {
  eventId: string
  pkg: PackageData
  flags: PackageFlags
}) {
  return (
    <>
      {pkg.can.signoff && <SignoffAction eventId={eventId} />}
      {pkg.can.publish && <PublishAction eventId={eventId} flags={flags} />}
    </>
  )
}

function SignoffAction({ eventId }: { eventId: string }) {
  const refresh = useRefreshPackage(eventId)
  return (
    <TextActionDialog
      trigger={<Button variant="outline">Sign off</Button>}
      title="Sponsor sign-off"
      description="Confirm the results reflect the event. You can leave a comment."
      fields={[{ name: "comment", label: "Comment", required: false }]}
      confirmLabel="Sign off"
      onSubmit={async (v) => {
        await unwrap(
          api.results.events[":eventId"].signoff.$post({
            param: { eventId },
            json: { comment: v.comment ?? "" },
          })
        )
        await refresh()
        toast.success("Signed off")
      }}
    />
  )
}

function PublishAction({
  eventId,
  flags,
}: {
  eventId: string
  flags: PackageFlags
}) {
  const refresh = useRefreshPackage(eventId)
  if (flags.signoffBlocked) return <Button disabled>Publish</Button>
  return (
    <TextActionDialog
      trigger={<Button>Publish</Button>}
      title="Publish results"
      description="Publishing makes the package available to participants, the sponsor and staff."
      fields={publishFields(flags.overrideReasons)}
      confirmLabel="Publish"
      onSubmit={async (v) => {
        await unwrap(
          api.results.events[":eventId"].publish.$post({
            param: { eventId },
            json: { overrideReason: v.overrideReason || undefined },
          })
        )
        await refresh()
        toast.success("Results published")
      }}
    />
  )
}
