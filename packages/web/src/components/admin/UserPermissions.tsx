import {
  type Permission,
  type PermissionGrant,
  STUDIO_SCOPED_PERMISSIONS,
} from "@studio/domain"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { BanIcon, KeySquareIcon, MapPinIcon, RotateCcwIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, IconTitle } from "@/components/common"
import { FormDialog } from "@/components/admin/shared"
import {
  TextAreaField,
  type UserRecord,
  useStudios,
} from "@/components/admin/pickers"
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
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, unwrap } from "@/lib/api"
import { useTz, useUser } from "@/lib/auth"
import { fmtInstant } from "@/lib/format"
import { PERMISSION_LABELS, ROLE_INFO, SCOPE_LABELS } from "@/lib/roles"

// BR-001-14/15: what this person's roles allow, with the option to remove single permissions for them only,
// everywhere or for one studio.

const GROUPS: { label: string; prefixes: string[] }[] = [
  { label: "Events & approvals", prefixes: ["event.", "stage."] },
  {
    label: "Equipment",
    prefixes: ["checkout.", "inventory.", "unit.", "hold."],
  },
  { label: "Results", prefixes: ["results."] },
  {
    label: "Access & administration",
    prefixes: [
      "level.",
      "course.",
      "grant.",
      "studio.",
      "event_type.",
      "policy.",
      "role.",
      "audit.",
      "user.",
    ],
  },
]

type Denial = UserRecord["denials"][number]

const shortStudio = (name: string | null | undefined) =>
  (name ?? "Studio").split(" – ")[0]

/**
 * Studios where a removal for one studio would change something: the studios of studio-scoped grants,
 * or every studio when a role grants the permission for all of them.
 */
function removableStudios(
  grant: PermissionGrant,
  allStudios: readonly { id: string; name: string }[]
): { id: string; name: string }[] {
  if (!STUDIO_SCOPED_PERMISSIONS.includes(grant.permission)) return []
  const everywhere = grant.sources.some((s) => s.scope === "all")
  const ids = new Set(
    grant.sources
      .filter((s) => s.scope === "studio" && s.studioId)
      .map((s) => s.studioId)
  )
  const denied = new Set(grant.deniedStudioIds)
  return allStudios.filter(
    (s) => (everywhere || ids.has(s.id)) && !denied.has(s.id)
  )
}

export function UserPermissionsCard({ user }: { user: UserRecord }) {
  const me = useUser()
  const tz = useTz()
  const qc = useQueryClient()
  const studios = useStudios()
  const [removing, setRemoving] = useState<PermissionGrant | null>(null)
  const studioName = new Map(user.roles.map((r) => [r.studioId, r.studioName]))
  const removedCount = user.denials.length

  const restore = useMutation({
    mutationFn: (d: Denial) =>
      unwrap(
        api.users[":id"].denials[":permission"].$delete({
          param: { id: user.id, permission: d.permission },
          query: d.studioId ? { studioId: d.studioId } : {},
        })
      ),
    onSuccess: (_, d) => {
      void qc.invalidateQueries({ queryKey: ["users"] })
      toast.success(
        `Restored “${PERMISSION_LABELS[d.permission]}”${d.studioId ? ` at ${shortStudio(d.studioName)}` : ""}.`
      )
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not restore the permission."
      ),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={KeySquareIcon}>Permissions</IconTitle>
        </CardTitle>
        <CardDescription>
          Everything this person's roles allow. Remove a permission to take it
          away from this person only — everywhere, or just at one studio. Their
          roles and everyone else holding them are unchanged.
          {removedCount > 0 &&
            ` ${removedCount} removal${removedCount === 1 ? "" : "s"} in place.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {user.permissions.length === 0 ? (
          <EmptyState
            icon={KeySquareIcon}
            title="No permissions"
            description="Add a role to give this person access."
          />
        ) : (
          GROUPS.map((g) => {
            const rows = user.permissions.filter((p) =>
              g.prefixes.some((x) => p.permission.startsWith(x))
            )
            if (rows.length === 0) return null
            return (
              <section key={g.label} className="flex flex-col gap-2">
                <h3 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
                  {g.label}
                </h3>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Permission</TableHead>
                        <TableHead>Granted by</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((p) => {
                        const denials = user.denials.filter(
                          (d) => d.permission === p.permission
                        )
                        const deniedStudios = new Set(p.deniedStudioIds)
                        // Mirror the server's lockout guard so the button isn't offered where it would fail.
                        const selfLockout =
                          p.permission === "role.assign" && user.id === me.id
                        // "Everywhere" is always still possible until it's removed everywhere.
                        const canStillRemove = !p.denied
                        return (
                          <TableRow
                            key={p.permission}
                            className={
                              p.denied ? "bg-destructive/5" : undefined
                            }
                          >
                            <TableCell
                              className={
                                p.denied
                                  ? "font-medium text-muted-foreground line-through"
                                  : "font-medium"
                              }
                            >
                              {PERMISSION_LABELS[p.permission]}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {p.sources.map((s) => {
                                  const studioOff =
                                    s.studioId !== null &&
                                    deniedStudios.has(s.studioId)
                                  return (
                                    <Badge
                                      key={`${s.role}:${s.scope}:${s.studioId ?? "all"}`}
                                      variant="outline"
                                      className={
                                        studioOff
                                          ? "font-normal line-through opacity-60"
                                          : "font-normal"
                                      }
                                    >
                                      {ROLE_INFO[s.role].label}
                                      <span className="text-muted-foreground">
                                        {" · "}
                                        {s.scope === "studio"
                                          ? shortStudio(
                                              studioName.get(s.studioId)
                                            )
                                          : SCOPE_LABELS[s.scope]}
                                      </span>
                                    </Badge>
                                  )
                                })}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1.5">
                                {denials.length === 0 && (
                                  <Badge variant="success">Allowed</Badge>
                                )}
                                {denials.length > 0 && !p.denied && (
                                  <Badge variant="warning">
                                    Allowed elsewhere
                                  </Badge>
                                )}
                                {denials.map((d) => (
                                  <div
                                    key={d.studioId ?? "all"}
                                    className="flex flex-wrap items-center gap-2"
                                  >
                                    <Badge variant="destructive">
                                      {d.studioId ? (
                                        <MapPinIcon data-icon="inline-start" />
                                      ) : (
                                        <BanIcon data-icon="inline-start" />
                                      )}
                                      {d.studioId
                                        ? `Removed at ${shortStudio(d.studioName)}`
                                        : "Removed everywhere"}
                                    </Badge>
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      disabled={restore.isPending}
                                      onClick={() => restore.mutate(d)}
                                    >
                                      <RotateCcwIcon data-icon="inline-start" />
                                      Restore
                                    </Button>
                                    <span className="w-full text-xs text-muted-foreground">
                                      “{d.reason}” ·{" "}
                                      {d.createdByName ?? "Admin"},{" "}
                                      {fmtInstant(d.createdAt, tz)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {canStillRemove && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={selfLockout}
                                  title={
                                    selfLockout
                                      ? "You can't remove your own access to user management."
                                      : undefined
                                  }
                                  onClick={() => setRemoving(p)}
                                >
                                  <BanIcon data-icon="inline-start" />
                                  Remove
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )
          })
        )}
      </CardContent>
      {removing && (
        <RemovePermissionDialog
          user={user}
          grant={removing}
          studios={removableStudios(removing, studios.data ?? [])}
          onClose={() => setRemoving(null)}
        />
      )}
    </Card>
  )
}

function RemovePermissionDialog({
  user,
  grant,
  studios,
  onClose,
}: {
  user: UserRecord
  grant: PermissionGrant
  /** Studios it can be removed at individually; empty for system-wide permissions. */
  studios: { id: string; name: string }[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const permission: Permission = grant.permission
  const [where, setWhere] = useState<string>("everywhere")
  const [reason, setReason] = useState("")
  const studioId = where === "everywhere" ? null : where
  const studio = studios.find((s) => s.id === studioId)
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.users[":id"].denials.$post({
          param: { id: user.id },
          json: { permission, studioId, reason: reason.trim() },
        })
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] })
      toast.success(
        `Removed “${PERMISSION_LABELS[permission]}” for ${user.displayName}${studio ? ` at ${shortStudio(studio.name)}` : ""}.`
      )
      onClose()
    },
  })
  return (
    <FormDialog
      title={`Remove “${PERMISSION_LABELS[permission]}”?`}
      description={`${user.displayName} keeps their roles. Takes effect on their next request and can be restored at any time.`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Remove permission"
      submitDisabled={reason.trim().length < 3}
    >
      {studios.length > 0 ? (
        <FieldSet>
          <FieldLegend variant="label">Where</FieldLegend>
          <RadioGroup value={where} onValueChange={setWhere}>
            <Field orientation="horizontal">
              <RadioGroupItem value="everywhere" id="where-everywhere" />
              <FieldLabel htmlFor="where-everywhere" className="font-normal">
                Everywhere
              </FieldLabel>
            </Field>
            {studios.map((s) => (
              <Field key={s.id} orientation="horizontal">
                <RadioGroupItem value={s.id} id={`where-${s.id}`} />
                <FieldLabel htmlFor={`where-${s.id}`} className="font-normal">
                  Only at {s.name}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
          <FieldDescription>
            {studioId
              ? `They can still do this at their other studios. Records in ${shortStudio(studio?.name)} are off limits for this permission.`
              : "They can't do this anywhere, whichever roles grant it. Any studio-only removals are replaced by this one."}
          </FieldDescription>
        </FieldSet>
      ) : (
        <p className="text-sm text-muted-foreground">
          This permission isn't tied to a studio, so it's removed everywhere.
        </p>
      )}
      <TextAreaField
        id="denial-reason"
        label="Reason"
        value={reason}
        onChange={setReason}
        description="Recorded in the audit log and shown on this profile. At least 3 characters."
      />
    </FormDialog>
  )
}
