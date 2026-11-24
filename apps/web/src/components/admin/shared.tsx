import type { Permission } from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import { LockIcon, SearchIcon } from "lucide-react"
import {
  type FormEvent,
  type ReactNode,
  useDeferredValue,
  useState,
} from "react"
import { toast } from "sonner"
import { ErrorAlert, PageHeader } from "@/components/common"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { api, unwrap } from "@/lib/api"
import { useCan } from "@/lib/auth"
import { humanize } from "@/lib/format"

// Building blocks shared by the admin pages (F-001..F-005 administration screens).

/** Shown instead of a page when the signed-in user lacks the page permission. */
export function NoAccess({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} />
      <Alert>
        <LockIcon />
        <AlertTitle>You don't have access</AlertTitle>
        <AlertDescription>
          Your roles don't include permission to manage this area. Ask an Admin
          if you need it.
        </AlertDescription>
      </Alert>
    </div>
  )
}

/** Renders children only when the user holds `perm`; otherwise the NoAccess alert. */
export function RequirePerm({
  perm,
  title,
  children,
}: {
  perm: Permission
  title: string
  children: ReactNode
}) {
  const can = useCan()
  if (!can(perm)) return <NoAccess title={title} />
  return <>{children}</>
}

/**
 * Modal form. Mount it only while open (`{open && <FormDialog …/>}`) so field state starts fresh
 * from the props each time it opens.
 */
export function FormDialog({
  title,
  description,
  onClose,
  onSubmit,
  pending,
  error,
  submitLabel = "Save",
  submitDisabled,
  children,
  footer,
  wide,
}: {
  title: string
  description?: ReactNode
  onClose: () => void
  onSubmit: () => void
  pending?: boolean
  error?: unknown
  submitLabel?: string
  submitDisabled?: boolean
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const handle = (e: FormEvent) => {
    e.preventDefault()
    onSubmit()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={wide ? "sm:max-w-2xl" : undefined}>
        <form onSubmit={handle} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <FieldGroup>{children}</FieldGroup>
            {error ? <ErrorAlert error={error} /> : null}
          </div>
          <DialogFooter>
            {footer}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || submitDisabled}>
              {pending && <Spinner data-icon="inline-start" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Destructive confirmation with its own trigger button. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  variant = "outline",
}: {
  label: ReactNode
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  variant?: "outline" | "ghost" | "destructive"
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={variant} disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "destructive" | "neutral"> = {
  active: "success",
  available: "success",
  enrolled: "success",
  in_use: "info",
  scheduled: "info",
  expiring: "warning",
  in_repair: "warning",
  damaged: "destructive",
  lost: "destructive",
  disabled: "destructive",
  revoked: "destructive",
  expired: "neutral",
  inactive: "neutral",
  retired: "neutral",
  dropped: "neutral",
}

/** Active/inactive (or any status code) as a toned badge. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>
}

/** Toast after a change that re-checked open events (BR-003-08, BR-004-07 …). */
export function toastSaved(message: string, flagged?: unknown) {
  const n =
    typeof flagged === "number"
      ? flagged
      : Array.isArray(flagged)
        ? flagged.length
        : 0
  toast.success(
    message,
    n > 0
      ? {
          description: `${n} open event${n === 1 ? "" : "s"} flagged for review.`,
        }
      : undefined
  )
}

/** Parses an optional whole-number input; "" → undefined. */
export function intOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

export interface PickedUser {
  id: string
  displayName: string
}

/** Server-side user search (active users) for picking a person. */
export function UserSearch({
  onPick,
  excludeIds,
  placeholder = "Search by name or email…",
}: {
  onPick: (user: PickedUser) => void
  excludeIds?: readonly string[]
  placeholder?: string
}) {
  const [q, setQ] = useState("")
  const deferred = useDeferredValue(q.trim())
  const results = useQuery({
    queryKey: ["users", "search", deferred],
    queryFn: () => unwrap(api.users.search.$get({ query: { q: deferred } })),
    enabled: deferred.length >= 2,
  })
  const rows = (results.data ?? []).filter((u) => !excludeIds?.includes(u.id))
  return (
    <Command shouldFilter={false} className="rounded-lg border">
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder={placeholder}
        aria-label="Search users"
      />
      <CommandList>
        {deferred.length < 2 ? (
          <CommandEmpty>
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <SearchIcon />
              Type at least 2 characters.
            </span>
          </CommandEmpty>
        ) : results.isPending ? (
          <CommandEmpty>Searching…</CommandEmpty>
        ) : (
          <CommandEmpty>No matching users.</CommandEmpty>
        )}
        {rows.length > 0 && (
          <CommandGroup>
            {rows.map((u) => (
              <CommandItem key={u.id} value={u.id} onSelect={() => onPick(u)}>
                {u.displayName}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
