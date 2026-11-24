import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowLeftIcon, PackageCheckIcon, PackageIcon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
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
  type CheckoutBody,
  type CheckoutLine,
  checkoutQuery,
  useInvalidateDesk,
} from "@/components/staff/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtInstant } from "@/lib/format"

const UNFILLED_REASONS = [
  { value: "unit_unavailable", label: "Unit unavailable" },
  { value: "declined_by_requester", label: "Declined by requester" },
] as const

export function CheckoutPage() {
  const { id = "" } = useParams()
  const tz = useTz()
  const navigate = useNavigate()
  const invalidateDesk = useInvalidateDesk()
  const invalidateEvent = useInvalidateEvent()
  const event = useQuery({
    queryKey: ["event", id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id } })),
  })
  const co = useQuery(checkoutQuery(id))

  const [unitsByLine, setUnitsByLine] = useState<Record<string, string[]>>({})
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({})
  const [unfilledByLine, setUnfilledByLine] = useState<Record<string, string>>(
    {}
  )
  const [overrideReason, setOverrideReason] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [scan, setScan] = useState("")

  const submit = useMutation({
    mutationFn: (json: CheckoutBody) =>
      unwrap(api.checkout[":eventId"].$post({ param: { eventId: id }, json })),
    onSuccess: async (res) => {
      toast.success(
        res.checkedOut
          ? `Checked out ${res.checkedOut} item${res.checkedOut === 1 ? "" : "s"}. Event in progress.`
          : "Event started with no equipment."
      )
      await Promise.all([invalidateDesk(id), invalidateEvent(id)])
      navigate(`/events/${id}`)
    },
  })

  if (co.isPending || event.isPending) return <LoadingBlock rows={4} />
  if (co.error) return <ErrorAlert error={co.error} />
  if (event.error) return <ErrorAlert error={event.error} />
  const view = co.data
  const ev = event.data

  const blockers = view.blockers
  const hard = blockers.filter((b) => !b.overridable)
  const overridable = blockers.filter((b) => b.overridable)

  const selectedCount = (line: CheckoutLine) =>
    line.tracking === "serialized"
      ? (unitsByLine[line.lineId]?.length ?? 0)
      : (qtyByLine[line.lineId] ?? 0)

  // Keyboard-wedge scanners type the tag and press Enter (BR-007-15).
  const onScan = (raw: string) => {
    const tag = raw.trim().toUpperCase()
    if (!tag) return
    for (const line of view.lines) {
      if (line.tracking !== "serialized") continue
      const unit = line.candidates.find((c) => c.assetTag.toUpperCase() === tag)
      if (!unit) continue
      const selected = unitsByLine[line.lineId] ?? []
      if (selected.includes(unit.unitId)) {
        toast.info(`${unit.assetTag} is already selected.`)
        return
      }
      if (selected.length >= line.qty) {
        toast.error(`${line.typeName} already has ${line.qty} selected.`)
        return
      }
      setUnitsByLine((m) => ({
        ...m,
        [line.lineId]: [...selected, unit.unitId],
      }))
      toast.success(`Selected ${unit.assetTag}`)
      return
    }
    toast.error(`No available unit ${tag} on this event's equipment.`)
  }

  const rows = view.lines.map((line) => {
    const got = selectedCount(line)
    return {
      line,
      unfilled: line.qty - got,
      bulkOver: line.tracking === "bulk" && got > (line.bulkAvailable ?? 0),
    }
  })
  const reasonMissing = rows.some(
    (r) => r.unfilled > 0 && !unfilledByLine[r.line.lineId]
  )
  const bulkInvalid = rows.some((r) => r.bulkOver)
  const overrideMissing = overridable.length > 0 && !overrideReason.trim()
  const canComplete =
    hard.length === 0 &&
    !reasonMissing &&
    !bulkInvalid &&
    !overrideMissing &&
    acknowledged &&
    !submit.isPending

  const onComplete = () => {
    submit.mutate({
      acknowledged: true,
      ...(overridable.length
        ? { taskOverrideReason: overrideReason.trim() }
        : {}),
      lines: rows.map(({ line, unfilled }) => {
        const unfilledReason =
          unfilled > 0 ? unfilledByLine[line.lineId] : undefined
        const base =
          line.tracking === "serialized"
            ? { lineId: line.lineId, unitIds: unitsByLine[line.lineId] ?? [] }
            : { lineId: line.lineId, qty: qtyByLine[line.lineId] ?? 0 }
        return unfilledReason ? { ...base, unfilledReason } : base
      }),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Check out: ${ev.title}`}
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

      <Alert>
        <AlertTitle>Pickup window</AlertTitle>
        <AlertDescription>
          {view.window.opensAt
            ? `Opens ${fmtInstant(view.window.opensAt, tz)}. `
            : ""}
          {view.window.noShowAt
            ? `No-show after ${fmtInstant(view.window.noShowAt, tz)}.`
            : ""}
        </AlertDescription>
      </Alert>

      {blockers.length > 0 && (
        <Alert variant={hard.length ? "destructive" : "default"}>
          <AlertTitle>
            {hard.length
              ? "Checkout is blocked"
              : "Open tasks need an override"}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {blockers.map((b) => (
                <li key={`${b.code}-${b.message}`}>
                  {b.message}{" "}
                  <span className="text-muted-foreground">
                    (
                    {b.overridable
                      ? "can be overridden"
                      : "must be resolved first"}
                    )
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {overridable.length > 0 && (
        <Field data-invalid={overrideMissing || undefined}>
          <FieldLabel htmlFor="override-reason">
            Override with reason
          </FieldLabel>
          <Input
            id="override-reason"
            value={overrideReason}
            aria-invalid={overrideMissing || undefined}
            placeholder="Why the open tasks can be waived"
            onChange={(e) => setOverrideReason(e.target.value)}
          />
          <FieldDescription>Recorded on each overridden task.</FieldDescription>
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor="scan">Scan or type an asset tag</FieldLabel>
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

      {view.lines.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title="No equipment"
          description="This event has no equipment. Starting it records a checkout with no items."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ line, unfilled, bulkOver }) => (
            <FieldSet key={line.lineId} className="rounded-lg border p-4">
              <FieldLegend>
                {line.typeName} · {line.qty} requested
              </FieldLegend>
              {line.tracking === "serialized" ? (
                <SerializedLine
                  line={line}
                  selected={unitsByLine[line.lineId] ?? []}
                  onChange={(next) =>
                    setUnitsByLine((m) => ({ ...m, [line.lineId]: next }))
                  }
                />
              ) : (
                <Field data-invalid={bulkOver || undefined}>
                  <FieldLabel htmlFor={`qty-${line.lineId}`}>
                    Quantity out
                  </FieldLabel>
                  <Input
                    id={`qty-${line.lineId}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={Math.min(line.qty, line.bulkAvailable ?? 0)}
                    className="w-32"
                    aria-invalid={bulkOver || undefined}
                    value={qtyByLine[line.lineId] ?? ""}
                    onChange={(e) =>
                      setQtyByLine((m) => ({
                        ...m,
                        [line.lineId]: Number(e.target.value) || 0,
                      }))
                    }
                  />
                  <FieldDescription>
                    {line.bulkAvailable ?? 0} available; at most {line.qty}{" "}
                    requested.
                  </FieldDescription>
                  {bulkOver && (
                    <FieldError>
                      Only {line.bulkAvailable ?? 0} available.
                    </FieldError>
                  )}
                </Field>
              )}
              {unfilled > 0 && (
                <Field data-invalid={!unfilledByLine[line.lineId] || undefined}>
                  <FieldLabel htmlFor={`unfilled-${line.lineId}`}>
                    Reason for {unfilled} unfilled
                  </FieldLabel>
                  <Select
                    value={unfilledByLine[line.lineId] ?? ""}
                    onValueChange={(v) =>
                      setUnfilledByLine((m) => ({ ...m, [line.lineId]: v }))
                    }
                  >
                    <SelectTrigger
                      id={`unfilled-${line.lineId}`}
                      className="w-72"
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
              )}
            </FieldSet>
          ))}
        </div>
      )}

      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox
            id="ack"
            checked={acknowledged}
            onCheckedChange={(v) => setAcknowledged(v === true)}
          />
          <FieldLabel htmlFor="ack" className="font-normal">
            Requester accepts the equipment terms
          </FieldLabel>
        </Field>
      </FieldGroup>

      {submit.error && <ErrorAlert error={submit.error} />}
      <div className="flex justify-end">
        <Button onClick={onComplete} disabled={!canComplete}>
          {submit.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PackageCheckIcon data-icon="inline-start" />
          )}
          Complete checkout
        </Button>
      </div>
    </div>
  )
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
  return (
    <FieldGroup className="gap-2">
      <p className="text-sm">
        {selected.length} of {line.qty} selected
      </p>
      {line.candidates.map((c) => {
        const checked = selected.includes(c.unitId)
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
