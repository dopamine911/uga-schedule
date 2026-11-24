import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastSaved } from "@/components/admin/formHelpers"
import { FormDialog } from "@/components/admin/shared"
import { STOCK_BUCKETS, UNIT_TRANSITIONS } from "@/components/admin/unitStatus"
import {
  LabeledField,
  NONE,
  SimpleSelect,
  TextAreaField,
  TextField,
  useForm,
} from "@/components/admin/pickers"
import { DatePicker } from "@/components/DatePicker"
import { api, unwrap } from "@/lib/api"

// Dialogs on the equipment type page: add a serialized unit, change a unit's status, adjust bulk stock.

export function AddUnitDialog({
  typeId,
  onClose,
}: {
  typeId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, set] = useForm({ assetTag: "", serialNumber: "", notes: "" })
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.equipment.types[":id"].units.$post({
          param: { id: typeId },
          json: {
            assetTag: v.assetTag.trim(),
            serialNumber: v.serialNumber.trim(),
            notes: v.notes.trim(),
          },
        })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment"] })
      toast.success("Unit added.")
      onClose()
    },
  })
  return (
    <FormDialog
      title="Add unit"
      description="Each unit has its own asset tag. It starts as available."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Add unit"
      submitDisabled={!v.assetTag.trim()}
    >
      <TextField
        id="unit-tag"
        label="Asset tag"
        value={v.assetTag}
        onChange={(x) => set("assetTag", x)}
        required
      />
      <TextField
        id="unit-serial"
        label="Serial number"
        value={v.serialNumber}
        onChange={(x) => set("serialNumber", x)}
      />
      <TextAreaField
        id="unit-notes"
        label="Notes"
        value={v.notes}
        onChange={(x) => set("notes", x)}
      />
    </FormDialog>
  )
}

export function UnitStatusDialog({
  unit,
  onClose,
}: {
  unit: { id: string; assetTag: string; status: string }
  onClose: () => void
}) {
  const qc = useQueryClient()
  const options = UNIT_TRANSITIONS[unit.status] ?? []
  const [v, set] = useForm({ status: "", reason: "", expectedBack: "" })
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.equipment.units[":id"].status.$post({
          param: { id: unit.id },
          json: {
            status: v.status as
              | "damaged"
              | "retired"
              | "in_repair"
              | "available",
            reason: v.reason.trim(),
            expectedBack: v.status === "in_repair" ? v.expectedBack : null,
          },
        })
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["equipment"] })
      toastSaved(
        `${unit.assetTag} is now ${v.status.replace("_", " ")}.`,
        res.flaggedEvents
      )
      onClose()
    },
  })
  const needsBack = v.status === "in_repair"
  return (
    <FormDialog
      title={`Change status: ${unit.assetTag}`}
      description={`Currently ${unit.status.replace("_", " ")}. Checkout and check-in move units in and out of use.`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Change status"
      submitDisabled={
        !v.status || !v.reason.trim() || (needsBack && !v.expectedBack)
      }
    >
      <LabeledField label="New status" htmlFor="unit-status">
        <SimpleSelect
          id="unit-status"
          value={v.status}
          onValueChange={(x) => set("status", x)}
          options={options}
          placeholder={
            options.length ? "Choose a status" : "No manual changes from here"
          }
          disabled={options.length === 0}
        />
      </LabeledField>
      {needsBack && (
        <LabeledField
          label="Expected back"
          htmlFor="unit-back"
          description="When the unit should return from repair."
        >
          <DatePicker
            id="unit-back"
            value={v.expectedBack}
            onChange={(x) => set("expectedBack", x)}
          />
        </LabeledField>
      )}
      <TextAreaField
        id="unit-reason"
        label="Reason"
        value={v.reason}
        onChange={(x) => set("reason", x)}
        description="Required. Recorded in the status history and audit log."
      />
    </FormDialog>
  )
}

export function BulkAdjustDialog({
  typeId,
  onClose,
}: {
  typeId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, set] = useForm({ from: NONE, to: NONE, qty: "", reason: "" })
  const from = v.from === NONE ? null : v.from
  const to = v.to === NONE ? null : v.to
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.equipment.types[":id"]["bulk-adjust"].$post({
          param: { id: typeId },
          json: {
            from: from as "available" | "damaged" | "in_repair" | "lost" | null,
            to: to as "available" | "damaged" | "in_repair" | "lost" | null,
            qty: Number(v.qty),
            reason: v.reason.trim(),
          },
        })
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["equipment"] })
      toastSaved("Stock adjusted.", res.flaggedEvents)
      onClose()
    },
  })
  const qty = Number(v.qty)
  const invalid =
    (from === null && to === null) ||
    (from !== null && from === to) ||
    !Number.isInteger(qty) ||
    qty <= 0 ||
    !v.reason.trim()
  const hint =
    from === null && to !== null
      ? "Receiving new stock into this bucket."
      : to === null && from !== null
        ? "Removing stock from this bucket."
        : "Moving stock between buckets."
  return (
    <FormDialog
      title="Adjust stock"
      description="Move quantities between status buckets. Leave From empty to receive new stock; leave To empty to remove stock."
      onClose={onClose}
      onSubmit={() => {
        if (!invalid) save.mutate()
      }}
      pending={save.isPending}
      error={save.error}
      submitLabel="Apply"
      submitDisabled={invalid}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledField label="From" htmlFor="stock-from">
          <SimpleSelect
            id="stock-from"
            value={v.from}
            onValueChange={(x) => set("from", x)}
            options={STOCK_BUCKETS}
            allLabel="None (receive new)"
          />
        </LabeledField>
        <LabeledField label="To" htmlFor="stock-to">
          <SimpleSelect
            id="stock-to"
            value={v.to}
            onValueChange={(x) => set("to", x)}
            options={STOCK_BUCKETS}
            allLabel="None (remove)"
          />
        </LabeledField>
      </div>
      <TextField
        id="stock-qty"
        label="Quantity"
        type="number"
        value={v.qty}
        onChange={(x) => set("qty", x)}
        required
        description={hint}
      />
      <TextAreaField
        id="stock-reason"
        label="Reason"
        value={v.reason}
        onChange={(x) => set("reason", x)}
        description="Required."
      />
    </FormDialog>
  )
}
