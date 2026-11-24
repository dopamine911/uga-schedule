import { HandIcon, PackageCheckIcon, ShieldAlertIcon } from "lucide-react"
import { IconTitle } from "@/components/common"
import type { EventDetail } from "@/components/events/shared"
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

interface EventProps {
  ev: EventDetail
}

export function CheckoutsCard({ ev }: EventProps) {
  const tz = useTz()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={PackageCheckIcon}>Checkouts</IconTitle>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ev.checkouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing checked out yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Asset tag</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Out</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Returned</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ev.checkouts.map((c) => (
                <CheckoutRow key={c.id} checkout={c} tz={tz} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function CheckoutRow({
  checkout: c,
  tz,
}: {
  checkout: EventDetail["checkouts"][number]
  tz: string
}) {
  return (
    <TableRow>
      <TableCell>{c.typeName}</TableCell>
      <TableCell>{c.assetTag ?? "—"}</TableCell>
      <TableCell>{c.qty}</TableCell>
      <TableCell>{fmtInstant(c.outAt, tz)}</TableCell>
      <TableCell>{fmtInstant(c.dueAt, tz)}</TableCell>
      <TableCell>{c.inAt ? fmtInstant(c.inAt, tz) : "—"}</TableCell>
      <TableCell>{c.conditionIn ? humanize(c.conditionIn) : "—"}</TableCell>
      <TableCell className="flex flex-wrap gap-1">
        {c.outstanding > 0 ? (
          <Badge variant="outline">{c.outstanding} out</Badge>
        ) : (
          <Badge variant="secondary">Returned</Badge>
        )}
        {c.late && <Badge variant="destructive">Late</Badge>}
      </TableCell>
    </TableRow>
  )
}

export function HoldsCard({ ev }: EventProps) {
  const tz = useTz()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={HandIcon}>Holds</IconTitle>
        </CardTitle>
        <CardDescription>
          Holds linked to this request. An active hold blocks new requests.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Placed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ev.holds.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{humanize(h.reason)}</TableCell>
                <TableCell>
                  <Badge
                    variant={h.status === "active" ? "destructive" : "outline"}
                  >
                    {humanize(h.status)}
                  </Badge>
                </TableCell>
                <TableCell>{h.note}</TableCell>
                <TableCell>{fmtInstant(h.createdAt, tz)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function PolicyOverridesCard({ ev }: EventProps) {
  const tz = useTz()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={ShieldAlertIcon}>Policy overrides</IconTitle>
        </CardTitle>
        <CardDescription>Exceptions approved by staff.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {ev.policyOverrides.map((o) => (
            <li key={o.id} className="flex flex-col">
              <span className="font-medium">{humanize(o.ruleCode)}</span>
              <span className="text-muted-foreground">
                {o.reason} · {fmtInstant(o.at, tz)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
