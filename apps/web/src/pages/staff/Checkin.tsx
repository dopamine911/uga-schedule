import { useMutation, useQuery } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
} from "lucide-react"
import type { ChangeEvent } from "react"
import { useState } from "react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import {
  EmptyState,
  ErrorAlert,
  LoadingBlock,
  PageHeader,
  StateBadge,
} from "@/components/common"
import { useInvalidateEvent } from "@/components/events/shared"
import {
  type CheckinBody,
  type CheckinResult,
  type CheckoutOutstanding,
  checkoutQuery,
  useInvalidateDesk,
  useNow,
} from "@/components/staff/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"

type Condition = "ok" | "damaged" | "missing"
type Counts = "qtyOk" | "qtyDamaged" | "qtyMissing"

/** What staff entered for one outstanding record. Serialized units use `condition`; bulk uses the counts. */
interface Entry {
  condition?: Condition
  qtyOk: number
  qtyDamaged: number
  qtyMissing: number
  notes: string
}

const blankEntry: Entry = { qtyOk: 0, qtyDamaged: 0, qtyMissing: 0, notes: "" }

export function CheckinPage() {
  const { id = "" } = useParams()
  const tz = useTz()
  const now = useNow()
  const invalidateDesk = useInvalidateDesk()
  const invalidateEvent = useInvalidateEvent()
  const event = useQuery({
    queryKey: ["event", id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id } })),
  })
  const co = useQuery(checkoutQuery(id))
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [scan, setScan] = useState("")
  const [result, setResult] = useState<CheckinResult | null>(null)

  const submit = useMutation({
    mutationFn: (json: CheckinBody) =>
      unwrap(
        api.checkout[":eventId"].checkin.$post({ param: { eventId: id }, json })
      ),
    onSuccess: async (res) => {
      setResult(res)
      setEntries({})
      toast.success(res.complete ? "Check-in complete" : "Check-in saved")
      await Promise.all([invalidateDesk(id), invalidateEvent(id)])
    },
  })

  if (co.isPending || event.isPending) return <LoadingBlock rows={4} />
  if (co.error) return <ErrorAlert error={co.error} />
  if (event.error) return <ErrorAlert error={event.error} />
  const ev = event.data
  const outstanding = co.data.outstanding
  const entryOf = (r: CheckoutOutstanding): Entry =>
    entries[r.recordId] ?? blankEntry
  const setEntry = (r: CheckoutOutstanding, patch: Partial<Entry>) =>
    setEntries((m) => ({ ...m, [r.recordId]: { ...entryOf(r), ...patch } }))

  // A record is ready once fully resolved; untouched records are left out (partial check-in).
  const rows = outstanding.map((r) => {
    const e = entryOf(r)
    const isBulk = r.assetTag === null
    const sum = e.qtyOk + e.qtyDamaged + e.qtyMissing
    const needsNote =
      (isBulk ? e.qtyDamaged > 0 : e.condition === "damaged") && !e.notes.trim()
    const touched = isBulk ? sum > 0 : e.condition !== undefined
    const ready = isBulk
      ? touched && sum === r.outstanding && !needsNote
      : touched && !needsNote
    return {
      r,
      e,
      touched,
      ready,
      invalid: touched && !ready,
      needsNote,
      isBulk,
    }
  })
  const anyInvalid = rows.some((x) => x.invalid)
  const readyCount = rows.filter((x) => x.ready).length
  const overdue = outstanding.filter((r) => Date.parse(r.dueAt) < now)

  // Keyboard-wedge scanners (BR-007-15): a scanned serialized tag marks that unit ok.
  const onScan = (raw: string) => {
    const tag = raw.trim().toUpperCase()
    if (!tag) return
    const r = outstanding.find((x) => x.assetTag?.toUpperCase() === tag)
    if (!r) {
      toast.error(`${tag} is not outstanding on this event.`)
      return
    }
    setEntry(r, { condition: "ok" })
    toast.success(`${r.assetTag} marked OK`)
  }

  const onSubmit = () => {
    const items: CheckinBody["items"] = rows
      .filter((x) => x.ready)
      .map(({ r, e }) => {
        const notes = e.notes.trim() || undefined
        return r.assetTag === null
          ? {
              recordId: r.recordId,
              qtyOk: e.qtyOk,
              qtyDamaged: e.qtyDamaged,
              qtyMissing: e.qtyMissing,
              notes,
            }
          : { recordId: r.recordId, condition: e.condition, notes }
      })
    submit.mutate({ items })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Check in: ${ev.title}`}
        description={`${ev.requester.displayName} · ${ev.studio.name}`}
        actions={
          <>
            <StateBadge state={ev.state} />
            <Button variant="outline" asChild>
              <Link to={`/events/${id}`}>
                <ArrowLeftIcon data-icon="inline-start" />
                Back to event
              </Link>
            </Button>
          </>
        }
      />

      {result && <ResultPanel result={result} eventId={id} tz={tz} />}

      {outstanding.length === 0 ? (
        result ? null : (
          <EmptyState
            icon={CheckCircle2Icon}
            title="Nothing outstanding"
            description="Every checked-out item for this event has been returned."
          >
            <Button variant="outline" asChild>
              <Link to={`/events/${id}`}>Back to event</Link>
            </Button>
          </EmptyState>
        )
      ) : (
        <>
          {overdue.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>Overdue</AlertTitle>
              <AlertDescription>
                {overdue.length} item{overdue.length === 1 ? "" : "s"} past due.
                Late returns place a late-return hold.
              </AlertDescription>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="scan">
              Scan an asset tag to mark it OK
            </FieldLabel>
            <Input
              id="scan"
              value={scan}
              autoComplete="off"
              placeholder="Scan, then press Enter"
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                e.preventDefault()
                onScan(scan)
                setScan("")
              }}
            />
          </Field>

          <div className="flex flex-col gap-4">
            {rows.map(({ r, e, needsNote, isBulk, invalid }) => (
              <FieldSet key={r.recordId} className="rounded-lg border p-4">
                <FieldLegend className="flex flex-wrap items-center gap-2">
                  {isBulk
                    ? `${r.typeName} ×${r.outstanding} out`
                    : `${r.typeName} ${r.assetTag}`}
                  {Date.parse(r.dueAt) < now && (
                    <Badge variant="destructive">Overdue</Badge>
                  )}
                </FieldLegend>
                <p className="text-sm text-muted-foreground">
                  Due {fmtInstant(r.dueAt, tz)}
                </p>
                {isBulk ? (
                  <BulkCounts
                    record={r}
                    entry={e}
                    invalid={invalid}
                    onChange={(patch) => setEntry(r, patch)}
                  />
                ) : (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel>Condition</FieldLabel>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={e.condition ?? ""}
                      aria-label={`Condition of ${r.assetTag}`}
                      onValueChange={(v) => {
                        if (v) setEntry(r, { condition: v as Condition })
                      }}
                    >
                      <ToggleGroupItem value="ok">OK</ToggleGroupItem>
                      <ToggleGroupItem value="damaged">Damaged</ToggleGroupItem>
                      <ToggleGroupItem value="missing">Missing</ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                )}
                <Field data-invalid={needsNote || undefined}>
                  <FieldLabel htmlFor={`notes-${r.recordId}`}>
                    Notes{" "}
                    {needsNote || e.qtyDamaged > 0 || e.condition === "damaged"
                      ? "(required for damage)"
                      : "(optional)"}
                  </FieldLabel>
                  <Textarea
                    id={`notes-${r.recordId}`}
                    value={e.notes}
                    aria-invalid={needsNote || undefined}
                    onChange={(ev2) => setEntry(r, { notes: ev2.target.value })}
                  />
                  {needsNote && <FieldError>Describe the damage.</FieldError>}
                </Field>
              </FieldSet>
            ))}
          </div>

          {submit.error && <ErrorAlert error={submit.error} />}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="text-sm text-muted-foreground">
              {readyCount} of {outstanding.length} ready. Blank items stay out.
            </p>
            <Button
              onClick={onSubmit}
              disabled={readyCount === 0 || anyInvalid || submit.isPending}
            >
              {submit.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CheckCircle2Icon data-icon="inline-start" />
              )}
              Submit check-in
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function BulkCounts({
  record,
  entry,
  invalid,
  onChange,
}: {
  record: CheckoutOutstanding
  entry: Entry
  invalid: boolean
  onChange: (patch: Partial<Entry>) => void
}) {
  const sum = entry.qtyOk + entry.qtyDamaged + entry.qtyMissing
  const mismatch = sum > 0 && sum !== record.outstanding
  const idOf = (k: Counts) => `${k}-${record.recordId}`
  const count = (k: Counts, label: string) => (
    <Field data-invalid={invalid || undefined} className="w-28">
      <FieldLabel htmlFor={idOf(k)}>{label}</FieldLabel>
      <Input
        id={idOf(k)}
        type="number"
        min={0}
        value={entry[k]}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          onChange({ [k]: Math.max(0, Number(e.target.value) || 0) })
        }
      />
    </Field>
  )
  return (
    <FieldGroup className="flex-row flex-wrap items-end gap-4">
      {count("qtyOk", "OK")}
      {count("qtyDamaged", "Damaged")}
      {count("qtyMissing", "Missing")}
      <FieldDescription className="pb-2">
        {sum} of {record.outstanding} counted
      </FieldDescription>
      {mismatch && (
        <FieldError className="w-full">
          OK + damaged + missing must equal {record.outstanding}.
        </FieldError>
      )}
    </FieldGroup>
  )
}

function ResultPanel({
  result,
  eventId,
  tz,
}: {
  result: CheckinResult
  eventId: string
  tz: string
}) {
  const event = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id: eventId } })),
  })
  const activeHolds = (event.data?.holds ?? []).filter(
    (h) => h.status === "active"
  )
  return (
    <Alert>
      <CheckCircle2Icon />
      <AlertTitle>
        {result.complete
          ? "All equipment is back. Check-in complete."
          : "Check-in saved. Items are still out."}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {result.items.map((i) => (
            <li key={i.recordId}>
              OK {i.qtyOk} · damaged {i.qtyDamaged} · missing {i.qtyMissing}
              {i.outstanding > 0 ? ` · ${i.outstanding} still out` : ""}
              {i.late ? " · returned late" : ""}
            </li>
          ))}
        </ul>
        {activeHolds.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-medium">Active holds on this event</p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {activeHolds.map((h) => (
                <li key={h.id}>
                  {humanize(h.reason)}: {h.note}
                  {h.autoClearAt
                    ? ` (auto-clears ${fmtInstant(h.autoClearAt, tz)})`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/events/${eventId}`}>Back to event</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
