import type { EquipmentTypeDetail } from "@/components/admin/pickers"
import { STOCK_BUCKETS } from "@/components/admin/unitStatus"

export type StockRow = { key: string; label: string; value: number }

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

/** Quantities for the bulk stock card: each status bucket, then the units in use. */
export function bulkStockRows(type: EquipmentTypeDetail): StockRow[] {
  return [
    ...STOCK_BUCKETS.map((b) => ({
      key: b.value,
      label: b.label,
      value: stockOf(type, b.value),
    })),
    { key: "in_use", label: "In use", value: type.bulkStock?.qtyInUse ?? 0 },
  ]
}
