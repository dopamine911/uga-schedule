import { useQuery } from "@tanstack/react-query"
import { DownloadIcon, FileTextIcon } from "lucide-react"
import { useState } from "react"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import {
  type AuditRow,
  LabeledField,
  NONE,
  SimpleSelect,
  TextField,
  useForm,
} from "@/components/admin/pickers"
import { RequirePerm } from "@/components/admin/shared"
import { DatePicker } from "@/components/DatePicker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { fmtInstant, humanize } from "@/lib/format"

const LIMITS = ["50", "200", "500", "1000"]

export function AuditPage() {
  return (
    <RequirePerm perm="audit.view" title="Audit log">
      <AuditContent />
    </RequirePerm>
  )
}

function AuditContent() {
  const tz = useTz()
  const [v, set] = useForm({
    entityType: "",
    action: "",
    from: "",
    to: "",
    limit: "200",
  })
  const [open, setOpen] = useState<AuditRow | null>(null)
  const types = useQuery({
    queryKey: ["audit", "entity-types"],
    queryFn: () => unwrap(api.audit["entity-types"].$get()),
  })
  // One set of filters drives both the table and the CSV export, so they always match.
  const filters: Record<string, string> = {
    ...(v.entityType ? { entityType: v.entityType } : {}),
    ...(v.action.trim() ? { action: v.action.trim() } : {}),
    ...(v.from ? { from: v.from } : {}),
    ...(v.to ? { to: v.to } : {}),
  }
  const rows = useQuery({
    queryKey: ["audit", { ...filters, limit: v.limit }],
    queryFn: () =>
      unwrap(api.audit.$get({ query: { ...filters, limit: v.limit } })),
  })
  const csvHref = `/api/audit/export.csv?${new URLSearchParams({
    ...filters,
    limit: v.limit,
  }).toString()}`

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Every change to bookings, inventory, access and settings, newest first. Entries are never edited or deleted."
        actions={
          <Button variant="outline" asChild>
            <a href={csvHref} download>
              <DownloadIcon data-icon="inline-start" />
              Export CSV
            </a>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-56">
          <LabeledField label="Entity type" htmlFor="audit-entity">
            <SimpleSelect
              id="audit-entity"
              value={v.entityType || NONE}
              onValueChange={(x) => set("entityType", x === NONE ? "" : x)}
              options={(types.data ?? []).map((t) => ({
                value: t,
                label: humanize(t),
              }))}
              allLabel="All types"
            />
          </LabeledField>
        </div>
        <div className="w-56">
          <TextField
            id="audit-action"
            label="Action contains"
            placeholder="e.g. checkout"
            value={v.action}
            onChange={(x) => set("action", x)}
          />
        </div>
        <div className="w-44">
          <LabeledField label="From" htmlFor="audit-from">
            <DatePicker
              id="audit-from"
              value={v.from}
              max={v.to || undefined}
              onChange={(x) => set("from", x)}
            />
          </LabeledField>
        </div>
        <div className="w-44">
          <LabeledField label="To" htmlFor="audit-to">
            <DatePicker
              id="audit-to"
              value={v.to}
              min={v.from || undefined}
              onChange={(x) => set("to", x)}
            />
          </LabeledField>
        </div>
        <div className="w-40">
          <LabeledField label="Show" htmlFor="audit-limit">
            <SimpleSelect
              id="audit-limit"
              value={v.limit}
              onValueChange={(x) => set("limit", x)}
              options={LIMITS.map((l) => ({ value: l, label: `Latest ${l}` }))}
            />
          </LabeledField>
        </div>
      </div>

      <QueryView query={rows}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              icon={FileTextIcon}
              title="No entries"
              description="Nothing matches these filters."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => {
                    const entity = r.entityLabel ?? humanize(r.entityType)
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">
                          {fmtInstant(r.at, tz)}
                        </TableCell>
                        <TableCell>{r.actorName ?? "System"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.action}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-xs text-muted-foreground">
                              {humanize(r.entityType)}
                            </span>
                            <span>{r.entityLabel ?? "—"}</span>
                            <span className="font-mono text-xs break-all text-muted-foreground">
                              {r.entityId}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-64 truncate text-muted-foreground">
                          {r.reason || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Details for ${r.action} on ${entity}`}
                            onClick={() => setOpen(r)}
                          >
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryView>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{open?.action}</DialogTitle>
            <DialogDescription>
              {open
                ? `${fmtInstant(open.at, tz)} · ${open.actorName ?? "System"}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <JsonBlock label="Before" value={open?.before} />
            <JsonBlock label="After" value={open?.after} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">
        {value === null || value === undefined
          ? "—"
          : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
