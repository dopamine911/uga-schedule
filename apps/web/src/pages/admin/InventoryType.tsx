import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useParams } from "react-router"
import { QueryView } from "@/components/common"
import { EquipmentTypeDialog } from "@/components/admin/EquipmentTypeDialog"
import {
  AddUnitDialog,
  BulkAdjustDialog,
  UnitStatusDialog,
} from "@/components/admin/UnitDialogs"
import type { EquipmentTypeDetail } from "@/components/admin/pickers"
import { RequirePerm } from "@/components/admin/shared"
import { api, unwrap } from "@/lib/api"
import { useCan } from "@/lib/auth"
import {
  BulkStockCard,
  StatusHistoryCard,
  TypeAvailabilityCard,
  TypeDetailsCard,
  TypeHeader,
  UnitsCard,
} from "./InventoryTypeSections"

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
  const can = useCan()
  const [editing, setEditing] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)
  const [statusUnit, setStatusUnit] = useState<
    EquipmentTypeDetail["units"][number] | null
  >(null)
  const [adjusting, setAdjusting] = useState(false)
  const manage = can("inventory.manage")
  const serialized = type.tracking === "serialized"

  return (
    <div className="flex flex-col gap-6">
      <TypeHeader type={type} manage={manage} onEdit={() => setEditing(true)} />

      <div className="grid gap-6 lg:grid-cols-3">
        <TypeDetailsCard type={type} />
        <TypeAvailabilityCard type={type} manage={manage} />
      </div>

      {serialized ? (
        <UnitsCard
          type={type}
          manage={manage}
          onAddUnit={() => setAddingUnit(true)}
          onChangeStatus={(u) => setStatusUnit(u)}
        />
      ) : (
        <BulkStockCard
          type={type}
          manage={manage}
          onAdjust={() => setAdjusting(true)}
        />
      )}

      <StatusHistoryCard type={type} />

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
