import { useQuery } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { type ReactNode, useState } from "react"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { api, unwrap } from "@/lib/api"

// Reference-data hooks and selects shared by the admin pages.

export function useLevels() {
  return useQuery({
    queryKey: ["levels"],
    queryFn: () => unwrap(api.levels.$get()),
  })
}

export function useStudios() {
  return useQuery({
    queryKey: ["studios"],
    queryFn: () => unwrap(api.studios.$get()),
  })
}

export function useClasses() {
  return useQuery({
    queryKey: ["equipment", "classes"],
    queryFn: () => unwrap(api.equipment.classes.$get()),
  })
}

export function useEventTypes() {
  return useQuery({
    queryKey: ["event-types"],
    queryFn: () => unwrap(api["event-types"].$get()),
  })
}

/** Sentinel for "no selection" in shadcn Select (items cannot have an empty value). */
export const NONE = "__none__"

export function LevelSelect({
  id,
  value,
  onValueChange,
  disabled,
  placeholder = "Choose a level",
}: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const levels = useLevels()
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue
          placeholder={levels.isPending ? "Loading levels…" : placeholder}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {(levels.data ?? []).map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name} (rank {l.rank}){!l.active && " — inactive"}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function ClassSelect({
  id,
  value,
  onValueChange,
  disabled,
}: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  const classes = useClasses()
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue
          placeholder={
            classes.isPending ? "Loading classes…" : "Choose a class"
          }
        />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {(classes.data ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** Select for a list of options with a leading "none"/"all" entry when `allLabel` is set. */
export function SimpleSelect({
  id,
  value,
  onValueChange,
  options,
  allLabel,
  placeholder,
  disabled,
}: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  allLabel?: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {allLabel !== undefined && (
            <SelectItem value={NONE}>{allLabel}</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** Labelled control with optional description and error text. */
export function LabeledField({
  label,
  htmlFor,
  description,
  error,
  children,
}: {
  label: ReactNode
  htmlFor: string
  description?: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      {error && (
        <FieldDescription className="text-destructive">
          {error}
        </FieldDescription>
      )}
    </Field>
  )
}

export function TextField(props: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  description?: ReactNode
  required?: boolean
  disabled?: boolean
  error?: string
}) {
  const {
    id,
    label,
    value,
    onChange,
    type,
    placeholder,
    description,
    required,
    disabled,
    error,
  } = props
  return (
    <LabeledField
      label={label}
      htmlFor={id}
      description={description}
      error={error}
    >
      <Input
        id={id}
        type={type ?? "text"}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </LabeledField>
  )
}

export function TextAreaField(props: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  description?: ReactNode
  rows?: number
  disabled?: boolean
}) {
  const {
    id,
    label,
    value,
    onChange,
    placeholder,
    description,
    rows = 3,
    disabled,
  } = props
  return (
    <LabeledField label={label} htmlFor={id} description={description}>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </LabeledField>
  )
}

export function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  label: string
  description?: ReactNode
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <Field orientation="horizontal">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </div>
    </Field>
  )
}

/** Local string state helper for form dialogs. */
export function useForm<T extends object>(initial: T) {
  const [values, setValues] = useState<T>(initial)
  const set = <K extends keyof T>(key: K, value: T[K]) =>
    setValues((v) => ({ ...v, [key]: value }))
  return [values, set, setValues] as const
}

export type EquipmentType = InferResponseType<
  typeof api.equipment.types.$get
>[number]
export type EquipmentClass = InferResponseType<
  typeof api.equipment.classes.$get
>[number]
export type EquipmentTypeDetail = InferResponseType<
  (typeof api.equipment.types)[":id"]["$get"]
>
export type LevelRow = InferResponseType<typeof api.levels.$get>[number]
export type CourseSummary = InferResponseType<
  typeof api.levels.courses.$get
>[number]
export type CourseDetail = InferResponseType<
  (typeof api.levels.courses)[":id"]["$get"]
>
export type GrantUser = InferResponseType<typeof api.levels.grants.$get>[number]
export type UserRecord = InferResponseType<(typeof api.users)[":id"]["$get"]>
export type StudioSummary = InferResponseType<typeof api.studios.$get>[number]
export type StudioDetail = InferResponseType<
  (typeof api.studios)[":id"]["$get"]
>
export type EventTypeRow = InferResponseType<
  (typeof api)["event-types"]["$get"]
>[number]
export type EventTypeDetail = InferResponseType<
  (typeof api)["event-types"][":id"]["$get"]
>
export type AuditRow = InferResponseType<typeof api.audit.$get>[number]
