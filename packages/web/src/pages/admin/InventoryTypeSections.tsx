import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BoxIcon,
  CalendarClockIcon,
  HistoryIcon,
  InfoIcon,
  LayersIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"
import { EmptyState, IconTitle, PageHeader } from "@/components/common"
import { toastSaved } from "@/components/admin/formHelpers"
import { UNIT_TRANSITIONS } from "@/components/admin/unitStatus"
import {
  type EquipmentTypeDetail,
  SwitchField,
} from "@/components/admin/pickers"
import { StatusBadge } from "@/components/admin/shared"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { bulkStockRows } from "./inventoryTypeView"

type EquipmentUnit = EquipmentTypeDetail["units"][number]

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

export function TypeHeader({
  type,
  manage,
  onEdit,
}: {
  type: EquipmentTypeDetail
  manage: boolean
  onEdit: () => void
}) {
  return (
    <PageHeader
      title={type.name}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <Link
            to="/admin/inventory"
            className="underline-offset-4 hover:underline"
          >
            Inventory
          </Link>
          <span aria-hidden>/</span>
          <span>{type.class.name}</span>
          <StatusBadge status={type.status} />
        </span>
      }
      actions={
        manage && (
          <Button variant="outline" onClick={() => onEdit()}>
            <PencilIcon data-icon="inline-start" />
            Edit type
          </Button>
        )
      }
    />
  )
}

export function TypeDetailsCard({ type }: { type: EquipmentTypeDetail }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>
          <IconTitle icon={InfoIcon}>Details</IconTitle>
        </CardTitle>
        <CardDescription>
          {type.description || "No description."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Detail label="Class" value={type.class.name} />
          <Detail label="Minimum level" value={type.minLevel.name} />
          <Detail label="Tracking" value={humanize(type.tracking)} />
          <Detail
            label="Max per event"
            value={type.maxPerEvent ?? "No limit"}
          />
          <Detail label="Manufacturer" value={type.manufacturer || "—"} />
          <Detail label="Model" value={type.model || "—"} />
        </dl>
      </CardContent>
    </Card>
  )
}

function CountsGrid({ type }: { type: EquipmentTypeDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      <Detail label="Available" value={type.counts.available} />
      <Detail label="In use" value={type.counts.in_use} />
      <Detail label="Damaged" value={type.counts.damaged} />
      <Detail label="In repair" value={type.counts.in_repair} />
      <Detail label="Lost" value={type.counts.lost} />
      <Detail label="Total" value={type.counts.total} />
    </dl>
  )
}

/** Active switch for managers; turning it off asks for confirmation first. */
function ActiveToggle({ type }: { type: EquipmentTypeDetail }) {
  const qc = useQueryClient()
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const toggle = useMutation({
    mutationFn: (active: boolean) =>
      unwrap(
        api.equipment.types[":id"].$patch({
          param: { id: type.id },
          json: { status: active ? "active" : "inactive" },
        })
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["equipment"] })
      toastSaved(
        res.status === "active" ? "Type is active." : "Type is inactive.",
        res.flaggedEvents
      )
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not change status."
      ),
  })

  return (
    <>
      <SwitchField
        id="type-active"
        label="Active"
        description="Inactive types are hidden from students and removed from new bookings."
        checked={type.status === "active"}
        onCheckedChange={(v) =>
          v ? toggle.mutate(true) : setConfirmDeactivate(true)
        }
        disabled={toggle.isPending}
      />
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {type.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Students can no longer request it and it is removed from new bookings. Open events that use it are flagged for review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep active</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => toggle.mutate(false)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function TypeAvailabilityCard({
  type,
  manage,
}: {
  type: EquipmentTypeDetail
  manage: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={CalendarClockIcon}>Availability</IconTitle>
        </CardTitle>
        <CardDescription>
          Counts by status (retired units excluded).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CountsGrid type={type} />
        {manage && <ActiveToggle type={type} />}
      </CardContent>
    </Card>
  )
}

/** Change-status action for one unit, shown only where a transition exists. */
function UnitStatusAction({
  unit,
  manage,
  onChangeStatus,
}: {
  unit: EquipmentUnit
  manage: boolean
  onChangeStatus: (unit: EquipmentUnit) => void
}) {
  return (
    manage &&
    (UNIT_TRANSITIONS[unit.status]?.length ?? 0) > 0 && (
      <Button size="sm" variant="outline" onClick={() => onChangeStatus(unit)}>
        Change status
      </Button>
    )
  )
}

function ManagedCardHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action: { label: string; onClick: () => void } | null
}) {
  return (
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <CardTitle>
          <IconTitle icon={icon}>{title}</IconTitle>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      {action && (
        <Button onClick={action.onClick}>
          <PlusIcon data-icon="inline-start" />
          {action.label}
        </Button>
      )}
    </CardHeader>
  )
}

export function UnitsCard({
  type,
  manage,
  onAddUnit,
  onChangeStatus,
}: {
  type: EquipmentTypeDetail
  manage: boolean
  onAddUnit: () => void
  onChangeStatus: (unit: EquipmentUnit) => void
}) {
  return (
    <Card>
      <ManagedCardHeader
        icon={PackageIcon}
        title="Units"
        description="Each unit is tracked individually."
        action={manage ? { label: "Add unit", onClick: onAddUnit } : null}
      />
      <CardContent>
        {type.units.length === 0 ? (
          <EmptyState
            icon={BoxIcon}
            title="No units yet"
            description="Add the first unit to make this type bookable."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset tag</TableHead>
                <TableHead>Serial</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expected back</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {type.units.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.assetTag}</TableCell>
                  <TableCell>{u.serialNumber || "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                  <TableCell>
                    {u.expectedBack ? fmtDay(u.expectedBack) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.notes || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <UnitStatusAction
                      unit={u}
                      manage={manage}
                      onChangeStatus={onChangeStatus}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function BulkStockCard({
  type,
  manage,
  onAdjust,
}: {
  type: EquipmentTypeDetail
  manage: boolean
  onAdjust: () => void
}) {
  return (
    <Card>
      <ManagedCardHeader
        icon={LayersIcon}
        title="Stock"
        description="Quantities by status. Adjusting moves stock between buckets."
        action={manage ? { label: "Adjust stock", onClick: onAdjust } : null}
      />
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {bulkStockRows(type).map((row) => (
            <Detail key={row.key} label={row.label} value={row.value} />
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

export function StatusHistoryCard({ type }: { type: EquipmentTypeDetail }) {
  const tz = useTz()
  const unitTag = new Map(type.units.map((u) => [u.id, u.assetTag]))
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={HistoryIcon}>Recent status history</IconTitle>
        </CardTitle>
        <CardDescription>The last 50 changes, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {type.statusHistory.length === 0 ? (
          <EmptyState icon={HistoryIcon} title="No changes yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Change</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {type.statusHistory.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap">
                    {fmtInstant(h.at, tz)}
                  </TableCell>
                  <TableCell>
                    {h.unitId
                      ? (unitTag.get(h.unitId) ?? "Unit")
                      : "Bulk stock"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {h.fromStatus ? (
                        <Badge variant="outline">
                          {humanize(h.fromStatus)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">New</span>
                      )}
                      <span aria-hidden>→</span>
                      <Badge variant="secondary">
                        {humanize(h.toStatus)}
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {h.qty}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {h.reason || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
