import { ClipboardCheckIcon } from "lucide-react"
import { IconTitle } from "@/components/common"
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
import { useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"
import { type CheckinReportView, countsOf } from "./model"

type ReportItem = CheckinReportView["items"][number]
type ReportHold = CheckinReportView["holds"][number]

export function CheckinReportCard({
  report,
}: {
  report: CheckinReportView | null
}) {
  const tz = useTz()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={ClipboardCheckIcon}>Check-in report</IconTitle>
        </CardTitle>
        <CardDescription>
          What went out, what came back, and any holds.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!report ? (
          <p className="text-sm text-muted-foreground">
            The check-in report is not available yet.
          </p>
        ) : (
          <>
            <CheckinItemsTable items={report.items} tz={tz} />
            {report.holds.length > 0 && (
              <CheckinHoldsTable holds={report.holds} tz={tz} />
            )}
            <p className="text-xs text-muted-foreground">
              Generated {fmtInstant(report.generatedAt, tz)}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function CheckinItemsTable({
  items,
  tz,
}: {
  items: ReportItem[]
  tz: string
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Out</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Returned</TableHead>
          <TableHead>Condition in</TableHead>
          <TableHead>Result</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => (
          <CheckinItemRow key={r.recordId} row={r} tz={tz} />
        ))}
      </TableBody>
    </Table>
  )
}

function CheckinItemRow({ row: r, tz }: { row: ReportItem; tz: string }) {
  return (
    <TableRow>
      <TableCell>
        {r.typeName}
        <span className="block text-xs text-muted-foreground">
          {r.assetTag ?? `Qty ${r.qty}`}
        </span>
      </TableCell>
      <TableCell>
        {fmtInstant(r.outAt, tz)}
        <span className="block text-xs text-muted-foreground">
          by {r.outBy}
        </span>
      </TableCell>
      <TableCell>{fmtInstant(r.dueAt, tz)}</TableCell>
      <TableCell>
        {r.inAt ? fmtInstant(r.inAt, tz) : "—"}
        {r.inBy && (
          <span className="block text-xs text-muted-foreground">
            by {r.inBy}
          </span>
        )}
      </TableCell>
      <TableCell>
        {r.conditionIn ? (
          <Badge variant="outline">{humanize(r.conditionIn)}</Badge>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        <CheckinResultCell row={r} />
      </TableCell>
      <TableCell className="whitespace-normal">{r.notes ?? ""}</TableCell>
    </TableRow>
  )
}

function CheckinResultCell({ row: r }: { row: ReportItem }) {
  return (
    <>
      {countsOf(r) || "—"}
      {r.late && (
        <Badge variant="destructive" className="ml-1">
          Late
        </Badge>
      )}
    </>
  )
}

function CheckinHoldsTable({
  holds,
  tz,
}: {
  holds: ReportHold[]
  tz: string
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Hold</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Placed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holds.map((h) => (
          <TableRow key={`${h.reason}-${h.placedAt}`}>
            <TableCell>{humanize(h.reason)}</TableCell>
            <TableCell>{humanize(h.status)}</TableCell>
            <TableCell>{fmtInstant(h.placedAt, tz)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
