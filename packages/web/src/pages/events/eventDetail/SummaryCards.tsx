import {
  ActivityIcon,
  CalendarDaysIcon,
  InfoIcon,
  type LucideIcon,
  MapPinIcon,
  PackageIcon,
  UserCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"
import { EquipmentClassIcon } from "@/components/EquipmentClassIcon"
import { IconTitle } from "@/components/common"
import { type EventDetail, LifecycleStepper } from "@/components/events/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { fmtDay, fmtDays, fmtTime, humanize } from "@/lib/format"
import { eventTypeIcon } from "@/lib/icons"

interface EventProps {
  ev: EventDetail
}

export function LifecycleCard({ ev }: EventProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={ActivityIcon}>Lifecycle</IconTitle>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <LifecycleStepper state={ev.state} />
      </CardContent>
    </Card>
  )
}

export function NeedsReviewAlert({ ev }: EventProps) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Needs review</AlertTitle>
      <AlertDescription>
        Something changed that affects this request:{" "}
        {ev.reviewReasons.map(humanize).join(", ")}. Studio staff must review
        it before it can go ahead.
      </AlertDescription>
    </Alert>
  )
}

export function DetailsCard({ ev }: EventProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={InfoIcon}>Details</IconTitle>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <DetailLabel icon={eventTypeIcon(ev.eventType.name)}>Type</DetailLabel>
          <dd>{ev.eventType.name}</dd>
          <DetailLabel icon={MapPinIcon}>Studio</DetailLabel>
          <dd>
            {ev.studio.name}
            {ev.studio.location ? ` · ${ev.studio.location}` : ""}
          </dd>
          <DetailLabel icon={UserIcon}>Requester</DetailLabel>
          <dd>{ev.requester.displayName}</dd>
          <DetailLabel icon={UserCheckIcon}>Sponsor</DetailLabel>
          <dd>{ev.sponsor?.displayName ?? "—"}</dd>
          <DetailLabel icon={UsersIcon}>Participants</DetailLabel>
          <dd>
            {ev.participants.length
              ? ev.participants.map((p) => p.displayName).join(", ")
              : "None"}
          </dd>
          <OptionalDetail label="Description" value={ev.description} />
          <OptionalDetail label="Decision note" value={ev.decisionNote} />
          <OptionalDetail
            label="Exception justification"
            value={ev.overrideJustification}
          />
          <OptionalDetail label="Cancelled because" value={ev.cancelReason} />
        </dl>
      </CardContent>
    </Card>
  )
}

function DetailLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: string
}) {
  return (
    <dt className="flex items-center gap-1.5 text-muted-foreground">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </dt>
  )
}

/** A free-text detail row that is left out when the event has no such text. */
function OptionalDetail({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  if (!value) return null
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{value}</dd>
    </>
  )
}

export function DaysCard({ ev }: EventProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={CalendarDaysIcon}>Days</IconTitle>
        </CardTitle>
        <CardDescription>{fmtDays(ev.days)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ev.days.map((d) => (
              <TableRow key={d.day}>
                <TableCell>{fmtDay(d.day)}</TableCell>
                <TableCell>
                  {fmtTime(d.startTime)}–{fmtTime(d.endTime)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function EquipmentCard({ ev }: EventProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={PackageIcon}>Equipment</IconTitle>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ev.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No equipment requested.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ev.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <EquipmentClassIcon name={l.className} size="sm" />
                      {l.typeName}
                    </span>
                  </TableCell>
                  <TableCell>{l.className}</TableCell>
                  <TableCell>{humanize(l.tracking)}</TableCell>
                  <TableCell className="text-right">{l.qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
