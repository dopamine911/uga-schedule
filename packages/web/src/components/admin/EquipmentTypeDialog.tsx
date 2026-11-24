import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { intOrUndefined, toastSaved } from "@/components/admin/formHelpers"
import { FormDialog } from "@/components/admin/shared"
import {
  ClassSelect,
  type EquipmentType,
  LabeledField,
  SimpleSelect,
  TextAreaField,
  TextField,
  useForm,
} from "@/components/admin/pickers"
import { api, unwrap } from "@/lib/api"

const TRACKING_OPTIONS = [
  { value: "serialized", label: "Serialized (one record per unit)" },
  { value: "bulk", label: "Bulk (quantities by status)" },
]

/** Create or edit an equipment type (F-003 §2). Tracking is locked once units or stock exist (BR-003-02). */
export function EquipmentTypeDialog({
  initial,
  onClose,
}: {
  initial?: EquipmentType
  onClose: () => void
}) {
  const qc = useQueryClient()
  const locked = (initial?.counts.total ?? 0) > 0
  const [v, set] = useForm({
    classId: initial?.classId ?? "",
    name: initial?.name ?? "",
    manufacturer: initial?.manufacturer ?? "",
    model: initial?.model ?? "",
    tracking: (initial?.tracking ?? "serialized") as "serialized" | "bulk",
    maxPerEvent:
      initial?.maxPerEvent != null ? String(initial.maxPerEvent) : "",
    description: initial?.description ?? "",
  })

  const save = useMutation({
    mutationFn: () => {
      const json = {
        classId: v.classId,
        name: v.name.trim(),
        manufacturer: v.manufacturer.trim(),
        model: v.model.trim(),
        tracking: v.tracking,
        maxPerEvent: intOrUndefined(v.maxPerEvent) ?? null,
        description: v.description.trim(),
      }
      return initial
        ? unwrap(
            api.equipment.types[":id"].$patch({
              param: { id: initial.id },
              json,
            })
          )
        : unwrap(api.equipment.types.$post({ json }))
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["equipment"] })
      if (initial)
        toastSaved(
          "Equipment type saved.",
          "flaggedEvents" in res ? res.flaggedEvents : undefined
        )
      else toast.success("Equipment type created.")
      onClose()
    },
  })

  return (
    <FormDialog
      title={initial ? "Edit equipment type" : "New equipment type"}
      description={
        locked
          ? "Units or stock already exist, so the tracking mode can't change. Retire this type and create a new one to switch."
          : "Tracking decides how units are recorded: individually, or as a count per status."
      }
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel={initial ? "Save" : "Create type"}
      submitDisabled={!v.classId || !v.name.trim()}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledField label="Equipment class" htmlFor="type-class">
          <ClassSelect
            id="type-class"
            value={v.classId}
            onValueChange={(x) => set("classId", x)}
          />
        </LabeledField>
        <TextField
          id="type-name"
          label="Name"
          value={v.name}
          onChange={(x) => set("name", x)}
          required
        />
        <TextField
          id="type-manufacturer"
          label="Manufacturer"
          value={v.manufacturer}
          onChange={(x) => set("manufacturer", x)}
        />
        <TextField
          id="type-model"
          label="Model"
          value={v.model}
          onChange={(x) => set("model", x)}
        />
        <LabeledField label="Tracking" htmlFor="type-tracking">
          <SimpleSelect
            id="type-tracking"
            value={v.tracking}
            onValueChange={(x) => set("tracking", x as "serialized" | "bulk")}
            options={TRACKING_OPTIONS}
            disabled={locked}
          />
        </LabeledField>
        <TextField
          id="type-max"
          label="Max per event"
          type="number"
          value={v.maxPerEvent}
          onChange={(x) => set("maxPerEvent", x)}
          placeholder="No limit"
          description="Leave empty for no per-event limit."
        />
      </div>
      <TextAreaField
        id="type-description"
        label="Description"
        value={v.description}
        onChange={(x) => set("description", x)}
      />
    </FormDialog>
  )
}
