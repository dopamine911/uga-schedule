import type { HoldReason } from "@studio/domain"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { HandIcon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"
import {
  EmptyState,
  ErrorAlert,
  LoadingBlock,
  PageHeader,
} from "@/components/common"
import { type DialogField, TextActionDialog } from "@/components/events/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, unwrap } from "@/lib/api"
import { useCan, useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"
import { cn } from "@/lib/utils"

type StatusFilter = "active" | "cleared" | "all"
type Hold = InferResponseType<(typeof api.holds)["$get"]>[number]

const REASON_VARIANT: Record<
  HoldReason,
  "destructive" | "secondary" | "outline"
> = {
  DAMAGE: "destructive",
  LOSS: "destructive",
  LATE_RETURN: "secondary",
  MANUAL: "outline",
}

const CLEAR_FIELDS: DialogField[] = [
  {
    name: "reason",
    label: "Reason for clearing",
    required: true,
    placeholder: "e.g. Replacement received",
  },
]

export function HoldsPage() {
  const can = useCan()
  const tz = useTz()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<StatusFilter>("active")
  const holds = useQuery({
    queryKey: ["holds", "all"],
    queryFn: () => unwrap(api.holds.$get({ query: { scope: "all" } })),
  })
  const rows = (holds.data ?? []).filter((h) =>
    filter === "all"
      ? true
      : filter === "active"
        ? h.status === "active"
        : h.status !== "active"
  )

  const clear = async (hold: Hold, values: Record<string, string>) => {
    await unwrap(
      api.holds[":id"].clear.$post({
        param: { id: hold.id },
        json: { reason: values.reason ?? "" },
      })
    )
    toast.success(`Hold cleared for ${hold.userName}`)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["holds"] }),
      qc.invalidateQueries({ queryKey: ["notifications"] }),
    ])
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Holds"
        description="Account holds block new requests until cleared."
        actions={
          can("checkout.perform") || can("hold.clear") ? (
            <PlaceHoldDialog />
          ) : null
        }
      />

      <ToggleGroup
        type="single"
        variant="outline"
        value={filter}
        aria-label="Filter holds by status"
        onValueChange={(v) => {
          if (v) setFilter(v as StatusFilter)
        }}
      >
        <ToggleGroupItem value="active">Active</ToggleGroupItem>
        <ToggleGroupItem value="cleared">Cleared</ToggleGroupItem>
        <ToggleGroupItem value="all">All</ToggleGroupItem>
      </ToggleGroup>

      {holds.error ? (
        <ErrorAlert error={holds.error} />
      ) : holds.isPending ? (
        <LoadingBlock rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheckIcon}
          title="No holds"
          description={`No ${filter === "all" ? "" : filter} holds.`}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Auto-clears</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="font-medium">{h.userName}</TableCell>
                <TableCell>
                  <Badge variant={REASON_VARIANT[h.reason]}>
                    {humanize(h.reason)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {h.eventId ? (
                    <Link
                      to={`/events/${h.eventId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {h.eventTitle ?? "Event"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-72 whitespace-pre-wrap">
                  {h.note || "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {fmtInstant(h.createdAt, tz)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {h.autoClearAt ? fmtInstant(h.autoClearAt, tz) : "—"}
                </TableCell>
                <TableCell>
                  {h.status === "active" ? (
                    <Badge variant="destructive">Active</Badge>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline">Cleared</Badge>
                      {h.clearedReason && (
                        <span className="text-xs text-muted-foreground">
                          {h.clearedReason}
                        </span>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {h.status === "active" && can("hold.clear") && (
                    <TextActionDialog
                      trigger={
                        <Button variant="outline" size="sm">
                          <ShieldCheckIcon data-icon="inline-start" />
                          Clear
                        </Button>
                      }
                      title={`Clear hold for ${h.userName}`}
                      description={`${humanize(h.reason)} hold. Record why it is cleared.`}
                      fields={CLEAR_FIELDS}
                      confirmLabel="Clear hold"
                      onSubmit={(v) => clear(h, v)}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function PlaceHoldDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [userId, setUserId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const search = useQuery({
    queryKey: ["users", "search", q],
    queryFn: () => unwrap(api.users.search.$get({ query: { q } })),
    enabled: open && q.trim().length >= 2,
  })
  const place = useMutation({
    mutationFn: () =>
      unwrap(
        api.holds.$post({
          json: { userId: userId!, note: note.trim(), eventId: null },
        })
      ),
    onSuccess: async () => {
      toast.success("Hold placed")
      setOpen(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["holds"] }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
      ])
    },
  })

  const reset = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setQ("")
      setUserId(null)
      setNote("")
      place.reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button>
          <HandIcon data-icon="inline-start" />
          Place hold
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Place a manual hold</DialogTitle>
          <DialogDescription>
            The user is notified and new requests are blocked until the hold is
            cleared.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="hold-user">Find user</FieldLabel>
            <Input
              id="hold-user"
              value={q}
              placeholder="Name or email (2+ characters)"
              autoComplete="off"
              onChange={(e) => {
                setQ(e.target.value)
                setUserId(null)
              }}
            />
            <FieldDescription>Only active users are listed.</FieldDescription>
          </Field>
          <div
            className="flex flex-col gap-1"
            role="group"
            aria-label="Matching users"
          >
            {search.isFetching && (
              <p className="text-sm text-muted-foreground">Searching…</p>
            )}
            {search.data?.map((u) => (
              <Button
                key={u.id}
                type="button"
                variant="ghost"
                aria-pressed={userId === u.id}
                className={cn("justify-start", userId === u.id && "bg-accent")}
                onClick={() => setUserId(u.id)}
              >
                {u.displayName}
              </Button>
            ))}
            {q.trim().length >= 2 && search.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No active users match.
              </p>
            )}
          </div>
          <Field>
            <FieldLabel htmlFor="hold-note">Note</FieldLabel>
            <Textarea
              id="hold-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this hold is placed"
            />
          </Field>
        </FieldGroup>
        {place.error && <ErrorAlert error={place.error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Close
          </Button>
          <Button
            onClick={() => place.mutate()}
            disabled={!userId || !note.trim() || place.isPending}
          >
            <HandIcon data-icon="inline-start" />
            {place.isPending && <Spinner data-icon="inline-start" />}
            Place hold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
