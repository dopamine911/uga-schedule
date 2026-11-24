import type { DayInput } from "@studio/domain"
import { PackageIcon } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"
import { IconTitle } from "@/components/common"
import { EquipmentPicker } from "@/components/events/EquipmentPicker"
import type { DraftForm } from "@/components/events/draft"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/** Section 3: equipment available on the request's days. */
export function EquipmentCard({
  days,
  excludeEventId,
  lines,
  setForm,
}: {
  days: DayInput[]
  excludeEventId: string | undefined
  lines: Record<string, number>
  setForm: Dispatch<SetStateAction<DraftForm>>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={PackageIcon}>3. Equipment</IconTitle>
        </CardTitle>
        <CardDescription>
          Available on your days. Items above your access level are locked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EquipmentPicker
          days={days}
          excludeEventId={excludeEventId}
          lines={lines}
          onQtyChange={(equipmentTypeId, qty) =>
            setForm((f) => ({
              ...f,
              lines: { ...f.lines, [equipmentTypeId]: qty },
            }))
          }
        />
      </CardContent>
    </Card>
  )
}
