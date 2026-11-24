import type { RoleCode } from "@studio/domain"
import { Badge } from "@/components/ui/badge"
import { ROLE_INFO } from "@/lib/roles"

/** Role chip with its icon; Admin is highlighted in Bulldog Red. */
export function RoleBadge({ role, studioName }: { role: RoleCode; studioName?: string | null }) {
  const { icon: Icon, label } = ROLE_INFO[role]
  return (
    <Badge variant={role === "ADMIN" ? "default" : "secondary"}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {label}
      {studioName ? ` · ${studioName.split(" – ")[0]}` : ""}
    </Badge>
  )
}
