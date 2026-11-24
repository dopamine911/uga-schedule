import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"
import type { PackageData, PackageFlags } from "./model"

export function PublishAlerts({
  pkg,
  flags,
}: {
  pkg: PackageData
  flags: PackageFlags
}) {
  const tz = useTz()
  return (
    <>
      {pkg.can.publish && flags.signoffBlocked && pkg.signoffOverrideAt && (
        <Alert>
          <AlertTitle>Publishing waits for the sponsor</AlertTitle>
          <AlertDescription>
            Publish stays disabled until the sponsor signs off. Without a
            sign-off you can publish with a reason from{" "}
            {fmtInstant(pkg.signoffOverrideAt, tz)}.
          </AlertDescription>
        </Alert>
      )}
      {pkg.can.publish && flags.overrideReasons.length > 0 && (
        <Alert>
          <AlertTitle>Publishing needs a reason</AlertTitle>
          <AlertDescription>
            {flags.overrideReasons.map((r) => humanize(r)).join(", ")}. Give a
            reason when you publish.
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}
