import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BoxIcon,
  CalendarClockIcon,
  HistoryIcon,
  InfoIcon,
  LayersIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import {
  EmptyState,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import { EquipmentTypeDialog } from "@/components/admin/EquipmentTypeDialog"
import {
  AddUnitDialog,
  BulkAdjustDialog,
  STOCK_BUCKETS,
  UNIT_TRANSITIONS,
  UnitStatusDialog,
} from "@/components/admin/UnitDialogs"
import {
  type EquipmentTypeDetail,
  SwitchField,
} from "@/components/admin/pickers"
import { RequirePerm, StatusBadge, toastSaved } from "@/components/admin/shared"
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
import { useCan, useTz } from "@/lib/auth"
import { fmtDay, fmtInstant, humanize } from "@/lib/format"

export function InventoryTypePage() {
  return (
    <RequirePerm perm="inventory.manage" title="Equipment type">
      <TypeDetail />
    </RequirePerm>
  )
}

function TypeDetail() {
  const { id = "" } = useParams()
  const query = useQuery({
    queryKey: ["equipment", "type", id],
    queryFn: () => unwrap(api.equipment.types[":id"].$get({ param: { id } })),
  })
  return (
    <QueryView query={query}>{(type) => <TypeContent type={type} />}</QueryView>
  )
}

function TypeContent({ type }: { type: EquipmentTypeDetail }) {
  const qc = useQueryClient()
  const can = useCan()
  const tz = useTz()
  const [editing, setEditing] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)
  const [statusUnit, setStatusUnit] = useState<
    EquipmentTypeDetail["units"][number] | null
  >(null)
  const [adjusting, setAdjusting] = useState(false)
  const manage = can("inventory.manage")
  const serialized = type.tracking === "serialized"
  const unitTag = new Map(type.units.map((u) => [u.id, u.assetTag]))

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
    <div className="flex flex-col gap-6">
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
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon data-icon="inline-start" />
              Edit type
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
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
            <dl className="grid grid-cols-2 gap-3">
              <Detail label="Available" value={type.counts.available} />
              <Detail label="In use" value={type.counts.in_use} />
              <Detail label="Damaged" value={type.counts.damaged} />
              <Detail label="In repair" value={type.counts.in_repair} />
              <Detail label="Lost" value={type.counts.lost} />
              <Detail label="Total" value={type.counts.total} />
            </dl>
            {manage && (
              <SwitchField
                id="type-active"
                label="Active"
                description="Inactive types are hidden from students and removed from new bookings."
                checked={type.status === "active"}
                onCheckedChange={(v) => toggle.mutate(v)}
                disabled={toggle.isPending}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {serialized ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>
                <IconTitle icon={PackageIcon}>Units</IconTitle>
              </CardTitle>
              <CardDescription>
                Each unit is tracked individually.
              </CardDescription>
            </div>
            {manage && (
              <Button onClick={() => setAddingUnit(true)}>
                <PlusIcon data-icon="inline-start" />
                Add unit
              </Button>
            )}
          </CardHeader>
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
                      <TableCell className="font-medium">
                        {u.assetTag}
                      </TableCell>
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
                        {manage &&
                          (UNIT_TRANSITIONS[u.status]?.length ?? 0) > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setStatusUnit(u)}
                            >
                              Change status
                            </Button>
                          )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>
                <IconTitle icon={LayersIcon}>Stock</IconTitle>
              </CardTitle>
              <CardDescription>
                Quantities by status. Adjusting moves stock between buckets.
              </CardDescription>
            </div>
            {manage && (
              <Button onClick={() => setAdjusting(true)}>
                <PlusIcon data-icon="inline-start" />
                Adjust stock
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {STOCK_BUCKETS.map((b) => (
                <Detail
                  key={b.value}
                  label={b.label}
                  value={stockOf(type, b.value)}
                />
              ))}
              <Detail label="In use" value={type.bulkStock?.qtyInUse ?? 0} />
            </dl>
          </CardContent>
        </Card>
      )}

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

      {editing && (
        <EquipmentTypeDialog initial={type} onClose={() => setEditing(false)} />
      )}
      {addingUnit && (
        <AddUnitDialog typeId={type.id} onClose={() => setAddingUnit(false)} />
      )}
      {statusUnit && (
        <UnitStatusDialog
          unit={statusUnit}
          onClose={() => setStatusUnit(null)}
        />
      )}
      {adjusting && (
        <BulkAdjustDialog
          typeId={type.id}
          onClose={() => setAdjusting(false)}
        />
      )}
    </div>
  )
}

function stockOf(type: EquipmentTypeDetail, bucket: string): number {
  const s = type.bulkStock
  if (!s) return 0
  switch (bucket) {
    case "available":
      return s.qtyAvailable
    case "damaged":
      return s.qtyDamaged
    case "in_repair":
      return s.qtyInRepair
    case "lost":
      return s.qtyLost
    default:
      return 0
  }
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
