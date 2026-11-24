import { useQuery } from "@tanstack/react-query"
import { FileTextIcon } from "lucide-react"
import { Link, useParams } from "react-router"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ApiError, api, unwrap } from "@/lib/api"
import { CheckinReportCard } from "./resultPackage/CheckinReportCard"
import { ItemsCard } from "./resultPackage/ItemsCard"
import {
  PackageHeaderActions,
  PackageHeaderDescription,
} from "./resultPackage/PackageHeader"
import { PublishAlerts } from "./resultPackage/PublishAlerts"
import { derivePackage, type PackageData } from "./resultPackage/model"
import { StatusCard } from "./resultPackage/StatusCard"

// F-008 results package. Uploads and links are only accepted while collecting (BR-008-02);
// publishing needs check-in complete and may need an override reason (BR-008-06/07).

export function ResultPackagePage() {
  const { eventId } = useParams()
  const query = useQuery({
    queryKey: ["results", eventId],
    queryFn: () =>
      unwrap(
        api.results.events[":eventId"].$get({ param: { eventId: eventId! } })
      ),
    enabled: !!eventId,
  })
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <>
        <PageHeader title="Results" />
        <EmptyState
          icon={FileTextIcon}
          title="Results not found"
          description="There is no results package here, or you can't see it."
        >
          <Button variant="outline" asChild>
            <Link to="/results">Back to results</Link>
          </Button>
        </EmptyState>
      </>
    )
  }
  return (
    <QueryView query={query} rows={4}>
      {(pkg) => <PackageView eventId={eventId!} pkg={pkg} />}
    </QueryView>
  )
}

function PackageView({ eventId, pkg }: { eventId: string; pkg: PackageData }) {
  const flags = derivePackage(pkg)
  return (
    <>
      <PageHeader
        title={pkg.title}
        description={
          <PackageHeaderDescription pkg={pkg} expired={flags.expired} />
        }
        actions={
          <PackageHeaderActions eventId={eventId} pkg={pkg} flags={flags} />
        }
      />

      {pkg.can.signoff && (
        <Alert>
          <AlertTitle>Sponsor sign-off needed</AlertTitle>
          <AlertDescription>
            Please review the results and sign off.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCard pkg={pkg} />
        <PublishAlerts pkg={pkg} flags={flags} />
      </div>

      <ItemsCard eventId={eventId} pkg={pkg} expired={flags.expired} />
      <CheckinReportCard report={flags.report} />
    </>
  )
}
