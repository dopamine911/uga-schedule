import { createElement } from "react"
import { equipmentClassIcon } from "@/lib/icons"
import { cn } from "@/lib/utils"

/** Red-on-tint tile with the Lucide icon for an equipment class (matched by class name). */
export function EquipmentClassIcon({
  name,
  size = "md",
}: {
  name: string
  size?: "sm" | "md"
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-accent text-primary",
        size === "sm" ? "size-6 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4"
      )}
    >
      {createElement(equipmentClassIcon(name))}
    </span>
  )
}
