import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { FileTextIcon } from "lucide-react"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"

// F-008 post-event results. Packages you may view (BR-008-05).

export function ResultsListPage() {
  const tz = useTz()
  const query = useQuery({
    queryKey: ["results"],
    queryFn: () => unwrap(api.results.$get()),
  })
  return (
    <>
      <PageHeader
        title="Results"
        description="Files and links from events you took part in or can review."
      />
      <QueryView query={query} rows={3}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              icon={FileTextIcon}
              title="No results yet"
              description="Results appear here once an event's package is ready."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Days left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.eventId}>
                    <TableCell className="font-medium">
                      <Link
                        to={`/results/${r.eventId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {r.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "expired"
                            ? "destructive"
                            : r.status === "published"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {humanize(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.publishedAt
                        ? fmtInstant(r.publishedAt, tz)
                        : "Not yet published"}
                    </TableCell>
                    <TableCell>
                      {r.status === "expired"
                        ? "Expired"
                        : r.status === "collecting"
                          ? "Starts when published"
                          : (r.daysLeft ?? "—")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </QueryView>
    </>
  )
}
