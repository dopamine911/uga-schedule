import { PackageCheckIcon, PackageIcon } from "lucide-react"
import { Link } from "react-router"
import { EmptyState, ErrorAlert } from "@/components/common"
import type { CheckoutLine, CheckoutView } from "@/components/staff/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useTz } from "@/lib/auth"
import { fmtInstant } from "@/lib/format"
import { type CheckoutRow, UNFILLED_REASONS } from "./checkoutForm"
import type { CheckoutForm } from "./useCheckoutForm"

export function PickupWindowAlert({
  pickupWindow,
}: {
  pickupWindow: CheckoutView["window"]
}) {
  const tz = useTz()
  return (
    <Alert>
      <AlertTitle>Pickup window</AlertTitle>
      <AlertDescription>
        {pickupWindow.opensAt
          ? `Opens ${fmtInstant(pickupWindow.opensAt, tz)}. `
          : ""}
        {pickupWindow.noShowAt
          ? `No-show after ${fmtInstant(pickupWindow.noShowAt, tz)}.`
          : ""}
      </AlertDescription>
    </Alert>
  )
}

export function BlockersAlert({
  blockers,
  hasHardBlocker,
  eventId,
}: {
  blockers: CheckoutView["blockers"]
  hasHardBlocker: boolean
  eventId: string
}) {
  if (blockers.length === 0) return null
  return (
    <Alert variant={hasHardBlocker ? "destructive" : "default"}>
      <AlertTitle>
        {hasHardBlocker ? "Checkout is blocked" : "Open tasks need an override"}
      </AlertTitle>
      <AlertDescription>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {blockers.map((b) => (
            <li key={`${b.code}-${b.message}`}>
              {b.message}{" "}
              <span className="text-muted-foreground">
                (
                {b.overridable ? "can be overridden" : "must be resolved first"}
                )
              </span>
              <BlockerNextStep code={b.code} eventId={eventId} />
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

export function OverrideReasonField({
  value,
  invalid,
  onChange,
  onBlur,
}: {
  value: string
  invalid: boolean
  onChange: (v: string) => void
  onBlur: () => void
}) {
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor="override-reason">Override with reason</FieldLabel>
      <Input
        id="override-reason"
        value={value}
        aria-invalid={invalid || undefined}
        placeholder="Why the open tasks can be waived"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <FieldDescription>Recorded on each overridden task.</FieldDescription>
    </Field>
  )
}

export function ScanField({
  value,
  onChange,
  onScan,
}: {
  value: string
  onChange: (v: string) => void
  onScan: (raw: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor="scan">Scan or type an asset tag</FieldLabel>
      <Input
        id="scan"
        value={value}
        autoComplete="off"
        placeholder="Scan, then press Enter"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          onScan(value)
          onChange("")
        }}
      />
    </Field>
  )
}

export function CheckoutLines({ form }: { form: CheckoutForm }) {
  if (form.rows.length === 0)
    return (
      <EmptyState
        icon={PackageIcon}
        title="No equipment"
        description="This event has no equipment. Starting it records a checkout with no items."
      />
    )
  return (
    <div className="flex flex-col gap-4">
      {form.rows.map((row) => (
        <CheckoutLineFieldset key={row.line.lineId} row={row} form={form} />
      ))}
    </div>
  )
}

function CheckoutLineFieldset({
  row,
  form,
}: {
  row: CheckoutRow
  form: CheckoutForm
}) {
  const { line, unfilled } = row
  return (
    <FieldSet className="rounded-lg border p-4">
      <FieldLegend>
        {line.typeName} · {line.qty} requested
      </FieldLegend>
      {line.tracking === "serialized" ? (
        <SerializedLine
          line={line}
          selected={row.selectedUnits}
          onChange={(next) => form.setLineUnits(line.lineId, next)}
        />
      ) : (
        <BulkQuantityField
          line={line}
          value={row.qtyValue}
          invalid={row.bulkOver}
          onChange={(qty) => form.setLineQty(line.lineId, qty)}
        />
      )}
      {unfilled > 0 && (
        <UnfilledReasonField
          line={line}
          unfilled={unfilled}
          value={row.unfilledReason}
          invalid={row.unfilledInvalid}
          onChange={(reason) => form.setLineUnfilled(line.lineId, reason)}
          onTouched={() => form.markLineUnfilledTouched(line.lineId)}
        />
      )}
    </FieldSet>
  )
}

function BulkQuantityField({
  line,
  value,
  invalid,
  onChange,
}: {
  line: CheckoutLine
  value: number | ""
  invalid: boolean
  onChange: (qty: number) => void
}) {
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={`qty-${line.lineId}`}>Quantity out</FieldLabel>
      <Input
        id={`qty-${line.lineId}`}
        type="number"
        inputMode="numeric"
        min={0}
        max={Math.min(line.qty, line.bulkAvailable ?? 0)}
        className="w-32"
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      <FieldDescription>
        {line.bulkAvailable ?? 0} available; at most {line.qty} requested.
      </FieldDescription>
      {invalid && (
        <FieldError>Only {line.bulkAvailable ?? 0} available.</FieldError>
      )}
    </Field>
  )
}

function UnfilledReasonField({
  line,
  unfilled,
  value,
  invalid,
  onChange,
  onTouched,
}: {
  line: CheckoutLine
  unfilled: number
  value: string
  invalid: boolean
  onChange: (reason: string) => void
  onTouched: () => void
}) {
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={`unfilled-${line.lineId}`}>
        Reason for {unfilled} unfilled
      </FieldLabel>
      <Select
        value={value}
        onValueChange={onChange}
        onOpenChange={(open) => {
          if (!open) onTouched()
        }}
      >
        <SelectTrigger
          id={`unfilled-${line.lineId}`}
          className="w-72"
          aria-invalid={invalid || undefined}
        >
          <SelectValue placeholder="Choose a reason" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {UNFILLED_REASONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

export function CheckoutFooter({
  form,
  termsVersion,
}: {
  form: CheckoutForm
  termsVersion: CheckoutView["termsVersion"]
}) {
  return (
    <>
      <FieldGroup>
        <Field
          orientation="horizontal"
          data-invalid={form.termsInvalid || undefined}
        >
          <Checkbox
            id="ack"
            checked={form.acknowledged}
            aria-invalid={form.termsInvalid || undefined}
            onCheckedChange={(v) => form.setAcknowledged(v === true)}
          />
          <FieldContent>
            <FieldLabel htmlFor="ack" className="font-normal">
              Requester accepts the equipment terms (version {termsVersion})
            </FieldLabel>
            <FieldDescription>
              The requester is responsible for the listed equipment until it is
              checked in. Damage, loss or a late return places a hold on their
              account.
            </FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>

      {form.submitError && <ErrorAlert error={form.submitError} />}
      {form.showFillHint && (
        <p className="text-sm text-destructive">
          Fill in the highlighted fields and accept the terms to check out.
        </p>
      )}
      <div className="flex justify-end">
        <Button
          onClick={form.onComplete}
          disabled={form.hasHardBlocker || form.submitPending}
        >
          {form.submitPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PackageCheckIcon data-icon="inline-start" />
          )}
          Complete checkout
        </Button>
      </div>
    </>
  )
}

/** What the person handling a hard blocker should do next. Other blocker codes state their own fix. */
function BlockerNextStep({ code, eventId }: { code: string; eventId: string }) {
  if (code === "NEEDS_REVIEW")
    return (
      <span className="block">
        Next: resolve the review on{" "}
        <Link
          to={`/events/${eventId}`}
          className="underline underline-offset-4"
        >
          the event page
        </Link>
        .
      </span>
    )
  if (code === "HOLD_ACTIVE")
    return (
      <span className="block">
        Next: an equipment manager or admin must clear the hold on{" "}
        <Link to="/holds" className="underline underline-offset-4">
          Holds
        </Link>
        .
      </span>
    )
  return null
}

function SerializedLine({
  line,
  selected,
  onChange,
}: {
  line: CheckoutLine
  selected: string[]
  onChange: (next: string[]) => void
}) {
  if (line.candidates.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No available units of this type.
      </p>
    )
  const full = selected.length >= line.qty
  const picked = new Set(selected)
  return (
    <FieldGroup className="gap-2">
      <p className="text-sm">
        {selected.length} of {line.qty} selected
      </p>
      {line.candidates.map((c) => {
        const checked = picked.has(c.unitId)
        const id = `unit-${line.lineId}-${c.unitId}`
        return (
          <Field key={c.unitId} orientation="horizontal">
            <Checkbox
              id={id}
              checked={checked}
              disabled={!checked && full}
              onCheckedChange={(v) =>
                onChange(
                  v === true
                    ? [...selected, c.unitId]
                    : selected.filter((x) => x !== c.unitId)
                )
              }
            />
            <FieldLabel htmlFor={id} className="font-normal">
              {c.assetTag}
            </FieldLabel>
          </Field>
        )
      })}
    </FieldGroup>
  )
}
