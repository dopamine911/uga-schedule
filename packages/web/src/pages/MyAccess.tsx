import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { HandIcon, KeyRoundIcon } from "lucide-react"
import {
  EmptyState,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { fmtDay, fmtInstant, humanize } from "@/lib/format"

// F-002 levels and F-007 holds, from the student's side. Holds block new requests (BR-007-11).

const GRANT_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "secondary",
  scheduled: "outline",
  expiring: "default",
  expired: "outline",
  revoked: "destructive",
}

export function MyAccessPage() {
  const tz = useTz()
  const access = useQuery({
    queryKey: ["levels", "me"],
    queryFn: () => unwrap(api.levels.me.$get()),
  })
  const holds = useQuery({
    queryKey: ["holds", "mine"],
    queryFn: () => unwrap(api.holds.$get({ query: { scope: "mine" } })),
  })

  return (
    <>
      <PageHeader
        title="My access"
        description="Your access level, where it comes from, and any holds on your account."
      />

      <QueryView query={access} rows={2}>
        {(data) => (
          <Card>
            <CardHeader>
              <CardTitle>
                <IconTitle icon={KeyRoundIcon}>Effective level today</IconTitle>
              </CardTitle>
              <CardDescription>
                Studios and equipment up to this level are open to you.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <p className="text-lg font-semibold">
                {data.effectiveLevelToday
                  ? `${data.effectiveLevelToday.name} (level ${data.effectiveLevelToday.rank})`
                  : "No access level yet"}
              </p>
              {data.grants.length === 0 ? (
                <EmptyState
                  icon={KeyRoundIcon}
                  title="No grants"
                  description="Access comes from course enrolment or a manual grant by staff."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Level</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Valid</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.grants.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell>{g.levelName}</TableCell>
                        <TableCell>
                          {g.source === "course"
                            ? (g.courseCode ?? "Course")
                            : "Manual grant"}
                        </TableCell>
                        <TableCell>
                          {fmtDay(g.validFrom)} –{" "}
                          {g.validUntil ? fmtDay(g.validUntil) : "Open-ended"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={GRANT_VARIANT[g.status] ?? "outline"}>
                            {humanize(g.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </QueryView>

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={HandIcon}>My holds</IconTitle>
          </CardTitle>
          <CardDescription>
            A hold blocks new requests until it is cleared. Requests you already
            have are kept but may be sent back for review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryView query={holds} rows={2}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No holds on your account.
                </p>
              ) : (
                <>
                  {rows.some((h) => h.status === "active") && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertTitle>New requests are blocked</AlertTitle>
                      <AlertDescription>
                        Clear the hold with studio staff to request studio time
                        again.{" "}
                        <Link to="/inbox" className="underline">
                          Check your inbox
                        </Link>{" "}
                        for details.
                      </AlertDescription>
                    </Alert>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reason</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{humanize(h.reason)}</span>
                              {h.note && (
                                <span className="text-xs text-muted-foreground">
                                  {h.note}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {h.eventId && h.eventTitle ? (
                              <Link
                                to={`/events/${h.eventId}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {h.eventTitle}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>{fmtInstant(h.createdAt, tz)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                h.status === "active"
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {humanize(h.status)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )
            }
          </QueryView>
        </CardContent>
      </Card>
    </>
  )
}
