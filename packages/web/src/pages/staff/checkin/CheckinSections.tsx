import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react"
import type { ChangeEvent } from "react"
import { ErrorAlert } from "@/components/common"
import type { CheckoutOutstanding } from "@/components/staff/shared"
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
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmtInstant } from "@/lib/format"
import {
  type CheckinRow,
  type Condition,
  type Counts,
  type Entry,
  labelOf,
} from "./checkinEntries"
import type { CheckinEntries } from "./useCheckinEntries"

export function CheckinBody({
  entries,
  requesterName,
  tz,
  lostAfterDays,
}: {
  entries: CheckinEntries
  requesterName: string
  tz: string
  lostAfterDays: number | undefined
}) {
  const total = entries.rows.length
  return (
    <>
      {entries.overdueCount > 0 && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Overdue</AlertTitle>
          <AlertDescription>
            {entries.overdueCount} item{entries.overdueCount === 1 ? "" : "s"}{" "}
            past due. Late returns place a late-return hold.
          </AlertDescription>
        </Alert>
      )}

      <Field>
        <FieldLabel htmlFor="scan">Scan an asset tag to mark it OK</FieldLabel>
        <Input
          id="scan"
          value={entries.scan}
          autoComplete="off"
          placeholder="Scan, then press Enter"
          onChange={(e) => entries.setScan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            entries.onScan(entries.scan)
            entries.setScan("")
          }}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total} item{total === 1 ? "" : "s"} out
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={entries.markAllOk}
          disabled={entries.untouchedCount === 0}
        >
          Mark all remaining OK
        </Button>
      </div>

      <ul className="flex flex-col divide-y rounded-lg border">
        {entries.rows.map((row) => (
          <CheckinRecordRow
            key={row.r.recordId}
            row={row}
            tz={tz}
            lostAfterDays={lostAfterDays}
            onPatch={(patch) => entries.setEntry(row.r.recordId, patch)}
          />
        ))}
      </ul>

      {entries.submitError && <ErrorAlert error={entries.submitError} />}

      <DamageConfirmDialog
        open={entries.confirmOpen}
        onOpenChange={entries.setConfirmOpen}
        requesterName={requesterName}
        damaged={entries.damagedReady}
        onConfirm={entries.submitReady}
      />

      <CheckinSubmitBar
        readyCount={entries.readyCount}
        total={total}
        disabled={
          entries.readyCount === 0 || entries.anyInvalid || entries.submitPending
        }
        pending={entries.submitPending}
        onSubmit={entries.onSubmit}
      />
    </>
  )
}

function CheckinRecordRow({
  row,
  tz,
  lostAfterDays,
  onPatch,
}: {
  row: CheckinRow
  tz: string
  lostAfterDays: number | undefined
  onPatch: (patch: Partial<Entry>) => void
}) {
  const { r, e, isBulk, invalid, missing, overdue } = row
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            <span>{labelOf(r)}</span>
            {overdue && <Badge variant="destructive">Overdue</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Due {fmtInstant(r.dueAt, tz)}
          </p>
        </div>
        {isBulk ? (
          <BulkCounts
            record={r}
            entry={e}
            invalid={invalid}
            onChange={onPatch}
          />
        ) : (
          <ConditionToggle
            assetTag={r.assetTag ?? ""}
            condition={e.condition}
            onChange={(condition) => onPatch({ condition })}
          />
        )}
      </div>

      {missing && (
        <p className="text-sm text-muted-foreground">
          Stays checked out and is written off as lost{" "}
          {lostAfterDays !== undefined
            ? `${lostAfterDays} days after it was due`
            : "after the grace period"}
          .
        </p>
      )}

      <RecordNote row={row} onPatch={onPatch} />
    </li>
  )
}

function ConditionToggle({
  assetTag,
  condition,
  onChange,
}: {
  assetTag: string
  condition: Condition | undefined
  onChange: (condition: Condition) => void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={condition ?? ""}
      aria-label={`Condition of ${assetTag}`}
      onValueChange={(v) => {
        if (v) onChange(v as Condition)
      }}
    >
      <ToggleGroupItem value="ok">OK</ToggleGroupItem>
      <ToggleGroupItem value="damaged">Damaged</ToggleGroupItem>
      <ToggleGroupItem value="missing">Missing</ToggleGroupItem>
    </ToggleGroup>
  )
}

/** Notes field, or the "Add note" button until the field is opened. */
function RecordNote({
  row,
  onPatch,
}: {
  row: CheckinRow
  onPatch: (patch: Partial<Entry>) => void
}) {
  const { r, e, damaged, needsNote, showNote } = row
  if (!showNote)
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPatch({ noteOpen: true })}
        >
          Add note
        </Button>
      </div>
    )
  return (
    <Field data-invalid={needsNote || undefined}>
      <FieldLabel htmlFor={`notes-${r.recordId}`}>
        Notes {damaged ? "(required for damage)" : "(optional)"}
      </FieldLabel>
      <Textarea
        id={`notes-${r.recordId}`}
        value={e.notes}
        aria-invalid={needsNote || undefined}
        onChange={(ev) => onPatch({ notes: ev.target.value })}
      />
      {needsNote && <FieldError>Describe the damage.</FieldError>}
    </Field>
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
    <Field data-invalid={invalid || undefined} className="w-24">
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
    <FieldGroup className="flex-row flex-wrap items-end gap-3">
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

function DamageConfirmDialog({
  open,
  onOpenChange,
  requesterName,
  damaged,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requesterName: string
  damaged: CheckinRow[]
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Place a damage hold?</AlertDialogTitle>
          <AlertDialogDescription>
            A damage hold will be placed on {requesterName}. They cannot make
            new requests until it is cleared.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex list-disc flex-col gap-1 pl-6 text-sm">
          {damaged.map(({ r }) => (
            <li key={r.recordId}>{labelOf(r)}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Check in and place hold
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CheckinSubmitBar({
  readyCount,
  total,
  disabled,
  pending,
  onSubmit,
}: {
  readyCount: number
  total: number
  disabled: boolean
  pending: boolean
  onSubmit: () => void
}) {
  return (
    <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mb-6 md:px-6">
      <p className="mr-auto text-sm text-muted-foreground">
        {readyCount} of {total} ready. Blank items stay out.
      </p>
      <Button onClick={onSubmit} disabled={disabled}>
        {pending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <CheckCircle2Icon data-icon="inline-start" />
        )}
        Submit check-in
      </Button>
    </div>
  )
}
