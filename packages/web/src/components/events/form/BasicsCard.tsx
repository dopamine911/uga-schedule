import { FileTextIcon } from "lucide-react"
import { IconTitle } from "@/components/common"
import type { DraftForm } from "@/components/events/draft"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { Textarea } from "@/components/ui/textarea"
import {
  type EventTypeRow,
  isStudioLocked,
  lockReasonOf,
  type StudioRow,
  studioRuleSuffix,
} from "./rules"

interface BasicsCardProps {
  form: DraftForm
  patch: (p: Partial<DraftForm>) => void
  onTypeChange: (eventTypeId: string) => void
  types: EventTypeRow[] | undefined
  typesPending: boolean
  studios: StudioRow[] | undefined
  type: EventTypeRow | undefined
  studio: StudioRow | undefined
}

/** Section 1: what the session is and where it happens. */
export function BasicsCard({
  form,
  patch,
  onTypeChange,
  types,
  typesPending,
  studios,
  type,
  studio,
}: BasicsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={FileTextIcon}>1. Basics</IconTitle>
        </CardTitle>
        <CardDescription>
          What the session is and where it happens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="title">Title</FieldLabel>
            <Input
              id="title"
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Textarea
              id="description"
              maxLength={5000}
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
          <EventTypeField
            value={form.eventTypeId}
            onTypeChange={onTypeChange}
            types={types}
            typesPending={typesPending}
            studios={studios}
            type={type}
          />
          <StudioField
            value={form.studioId}
            onStudioChange={(studioId) => patch({ studioId })}
            studios={studios}
            type={type}
            studio={studio}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function EventTypeField({
  value,
  onTypeChange,
  types,
  typesPending,
  studios,
  type,
}: {
  value: string
  onTypeChange: (eventTypeId: string) => void
  types: EventTypeRow[] | undefined
  typesPending: boolean
  studios: StudioRow[] | undefined
  type: EventTypeRow | undefined
}) {
  return (
    <Field>
      <FieldLabel htmlFor="event-type">Event type</FieldLabel>
      <Select value={value} onValueChange={onTypeChange}>
        <SelectTrigger id="event-type" className="w-full">
          <SelectValue
            placeholder={typesPending ? "Loading…" : "Choose an event type"}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {(types ?? []).map((t) => (
              <EventTypeOption key={t.id} type={t} studios={studios} />
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <EventTypeHint type={type} />
    </Field>
  )
}

function EventTypeOption({
  type,
  studios,
}: {
  type: EventTypeRow
  studios: StudioRow[] | undefined
}) {
  const lock = lockReasonOf(type, studios)
  return (
    <SelectItem value={type.id} disabled={lock !== null}>
      {type.name}
      {lock && ` · ${lock}`}
    </SelectItem>
  )
}

function EventTypeHint({ type }: { type: EventTypeRow | undefined }) {
  if (!type) return null
  return (
    <FieldDescription>
      Up to {type.maxDays} {type.maxDays === 1 ? "day" : "days"}
      {type.maxHoursPerDay ? ` · up to ${type.maxHoursPerDay} hours a day` : ""}
    </FieldDescription>
  )
}

function StudioField({
  value,
  onStudioChange,
  studios,
  type,
  studio,
}: {
  value: string
  onStudioChange: (studioId: string) => void
  studios: StudioRow[] | undefined
  type: EventTypeRow | undefined
  studio: StudioRow | undefined
}) {
  const options = (type?.allowedStudios ?? []).map((s) => ({
    ...s,
    rule: studios?.find((x) => x.id === s.id),
  }))
  return (
    <Field>
      <FieldLabel htmlFor="studio">Studio</FieldLabel>
      <Select value={value} onValueChange={onStudioChange} disabled={!type}>
        <SelectTrigger id="studio" className="w-full">
          <SelectValue
            placeholder={
              type ? "Choose a studio" : "Choose an event type first"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((s) => (
              <StudioOption key={s.id} id={s.id} name={s.name} rule={s.rule} />
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <StudioHint studio={studio} />
    </Field>
  )
}

function StudioOption({
  id,
  name,
  rule,
}: {
  id: string
  name: string
  rule: StudioRow | undefined
}) {
  return (
    <SelectItem value={id} disabled={isStudioLocked(rule)}>
      {name}
      {studioRuleSuffix(rule)}
    </SelectItem>
  )
}

function StudioHint({ studio }: { studio: StudioRow | undefined }) {
  if (!studio) return null
  if (!studio.eligibleToday)
    return (
      <FieldError>
        Requires {studio.minLevel.name}. Your access does not cover this studio
        yet.
      </FieldError>
    )
  return (
    <FieldDescription>Studio minimum: {studio.minLevel.name}</FieldDescription>
  )
}
