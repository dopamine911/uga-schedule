import { InfoIcon } from "lucide-react"
import { IconTitle } from "@/components/common"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTz } from "@/lib/auth"
import { fmtInstant } from "@/lib/format"
import { type PackageData, statusLabel } from "./model"

export function StatusCard({ pkg }: { pkg: PackageData }) {
  const tz = useTz()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={InfoIcon}>Status</IconTitle>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {statusLabel(pkg.status)}
          </span>
        </div>
        {pkg.resultsDueAt && (
          <p>Results due {fmtInstant(pkg.resultsDueAt, tz)}</p>
        )}
        {pkg.sponsorSignoff !== "not_required" && (
          <SponsorSignoffRow pkg={pkg} />
        )}
      </CardContent>
    </Card>
  )
}

function SponsorSignoffRow({ pkg }: { pkg: PackageData }) {
  const tz = useTz()
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">Sponsor sign-off</span>
      {pkg.sponsorSignoff === "accepted" ? (
        <span>
          Signed off
          {pkg.signedOffAt ? ` ${fmtInstant(pkg.signedOffAt, tz)}` : ""}
          {pkg.sponsorComment ? ` — “${pkg.sponsorComment}”` : ""}
        </span>
      ) : (
        <span className="text-muted-foreground">Waiting for the sponsor</span>
      )}
    </div>
  )
}
