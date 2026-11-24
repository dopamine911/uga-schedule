import { useQuery } from "@tanstack/react-query"
import { DownloadIcon, FileTextIcon } from "lucide-react"
import { useState } from "react"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import {
  type AuditRow,
  LabeledField,
  SimpleSelect,
  TextField,
  useForm,
} from "@/components/admin/pickers"
import { RequirePerm } from "@/components/admin/shared"
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
  const [v, set] = useForm({ entityType: "", limit: "200" })
  const [open, setOpen] = useState<AuditRow | null>(null)
  const query = {
    ...(v.entityType.trim() ? { entityType: v.entityType.trim() } : {}),
    limit: v.limit,
  }
  const rows = useQuery({
    queryKey: ["audit", query],
    queryFn: () => unwrap(api.audit.$get({ query })),
  })
  const csvHref = `/api/audit/export.csv?${new URLSearchParams({
    limit: v.limit,
    ...(v.entityType.trim() ? { entityType: v.entityType.trim() } : {}),
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
        <div className="w-64">
          <TextField
            id="audit-entity"
            label="Entity type"
            placeholder="e.g. equipment_type"
            value={v.entityType}
            onChange={(x) => set("entityType", x)}
          />
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
                  {list.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        {fmtInstant(r.at, tz)}
                      </TableCell>
                      <TableCell>{r.actorName ?? "System"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.action}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {humanize(r.entityType)}
                        </span>
                        <div className="font-mono text-xs break-all">
                          {r.entityId}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">
                        {r.reason || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpen(r)}
                        >
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
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
