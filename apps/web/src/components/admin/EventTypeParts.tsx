import { STAGE_ANCHORS, STAGE_KINDS, STAGE_RECIPIENTS } from "@studio/domain"
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
import {
  type EventTypeDetail,
  LabeledField,
  SimpleSelect,
  useStudios,
} from "@/components/admin/pickers"

// Pieces of the event type editor: allowed studios and the pre-event stage schedule (F-005).

export function StudioCheckboxes({
  value,
  onChange,
}: {
  value: readonly string[]
  onChange: (ids: string[]) => void
}) {
  const studios = useStudios()
  return (
    <FieldSet>
      <FieldLegend variant="label">Allowed studios</FieldLegend>
      <FieldDescription>
        Students can request this event type only in the studios you pick.
      </FieldDescription>
      <FieldGroup className="gap-3">
        {(studios.data ?? []).map((s) => {
          const checked = value.includes(s.id)
          return (
            <Field key={s.id} orientation="horizontal">
              <Checkbox
                id={`studio-${s.id}`}
                checked={checked}
                onCheckedChange={(on) =>
                  onChange(
                    on === true
                      ? [...value, s.id]
                      : value.filter((x) => x !== s.id)
                  )
                }
              />
              <FieldLabel htmlFor={`studio-${s.id}`} className="font-normal">
                {s.name}
                {s.status !== "active" && (
                  <span className="text-muted-foreground"> (inactive)</span>
                )}
              </FieldLabel>
            </Field>
          )
        })}
      </FieldGroup>
    </FieldSet>
  )
}

export type StageRow = EventTypeDetail["stages"][number]

export interface StageDraft {
  key: string
  name: string
  kind: (typeof STAGE_KINDS)[number]
  anchor: (typeof STAGE_ANCHORS)[number]
  amount: string
  unit: "minutes" | "hours" | "days"
  direction: "before" | "after"
  recipients: string[]
  assigneeRole: string
  blocksCheckout: boolean
  message: string
}

const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 } as const

let keySeq = 0
/** Local key for React lists; drafts have no server id until saved. */
export function nextKey(): string {
  keySeq += 1
  return `stage-${keySeq}`
}

export function blankStage(): StageDraft {
  return {
    key: nextKey(),
    name: "",
    kind: "reminder",
    anchor: "event_start",
    amount: "1",
    unit: "days",
    direction: "before",
    recipients: ["requester"],
    assigneeRole: "",
    blocksCheckout: false,
    message: "",
  }
}

/** Splits a stored offset into the friendliest unit (days, then hours, then minutes). */
export function stageToDraft(s: StageRow): StageDraft {
  const abs = Math.abs(s.offsetMinutes)
  const unit =
    abs > 0 && abs % 1440 === 0
      ? "days"
      : abs > 0 && abs % 60 === 0
        ? "hours"
        : "minutes"
  return {
    key: nextKey(),
    name: s.name,
    kind: s.kind,
    anchor: s.anchor,
    amount: String(abs / UNIT_MINUTES[unit]),
    unit,
    direction: s.offsetMinutes < 0 ? "before" : "after",
    recipients: [...s.recipients],
    assigneeRole: s.assigneeRole ?? "",
    blocksCheckout: s.blocksCheckout,
    message: s.message,
  }
}

/** Payload for PUT /event-types/:id/stages. Reminders never block; tasks keep their assignee. */
export function draftToPayload(d: StageDraft) {
  const sign = d.direction === "before" ? -1 : 1
  const offsetMinutes =
    Math.round(Number(d.amount) * UNIT_MINUTES[d.unit]) * sign
  const task = d.kind === "task"
  return {
    name: d.name.trim(),
    kind: d.kind,
    anchor: d.anchor,
    offsetMinutes,
    recipients: d.recipients as (typeof STAGE_RECIPIENTS)[number][],
    assigneeRole:
      task && d.assigneeRole
        ? (d.assigneeRole as "requester" | "sponsor" | "studio_staff")
        : null,
    blocksCheckout: task && d.blocksCheckout,
    message: d.message,
  }
}

const ANCHOR_LABEL: Record<(typeof STAGE_ANCHORS)[number], string> = {
  event_start: "event start",
  event_end: "event end",
  each_day_start: "each day's start",
}

const RECIPIENT_LABEL: Record<(typeof STAGE_RECIPIENTS)[number], string> = {
  requester: "Requester",
  participants: "Participants",
  sponsor: "Sponsor",
  studio_staff: "Studio staff",
}

const ASSIGNEE_OPTIONS = [
  { value: "requester", label: "Requester" },
  { value: "sponsor", label: "Sponsor" },
  { value: "studio_staff", label: "Studio staff" },
]

const KIND_OPTIONS = [
  { value: "reminder", label: "Reminder (message only)" },
  { value: "task", label: "Task (someone must complete it)" },
]

const ANCHOR_OPTIONS = [
  { value: "event_start", label: "Event start" },
  { value: "event_end", label: "Event end" },
  { value: "each_day_start", label: "Each day's start" },
]

export function StageEditor({
  stages,
  onChange,
}: {
  stages: StageDraft[]
  onChange: (next: StageDraft[]) => void
}) {
  const patch = (i: number, p: Partial<StageDraft>) =>
    onChange(stages.map((s, n) => (n === i ? { ...s, ...p } : s)))
  const move = (i: number, by: number) => {
    const j = i + by
    if (j < 0 || j >= stages.length) return
    const next = [...stages]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }
  const remove = (i: number) => onChange(stages.filter((_, n) => n !== i))

  return (
    <div className="flex flex-col gap-4">
      {stages.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No stages yet. Add reminders or tasks that run before the event.
        </p>
      )}
      {stages.map((s, i) => (
        <Card key={s.key} size="sm">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Stage {i + 1}</span>
              <div className="flex gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move stage ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move stage ${i + 1} down`}
                  disabled={i === stages.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove stage ${i + 1}`}
                  onClick={() => remove(i)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <LabeledField label="Name" htmlFor={`stage-name-${s.key}`}>
                  <Input
                    id={`stage-name-${s.key}`}
                    value={s.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                  />
                </LabeledField>
                <LabeledField label="Kind" htmlFor={`stage-kind-${s.key}`}>
                  <SimpleSelect
                    id={`stage-kind-${s.key}`}
                    value={s.kind}
                    onValueChange={(x) =>
                      patch(i, {
                        kind: x as StageDraft["kind"],
                        blocksCheckout: x === "task" ? s.blocksCheckout : false,
                      })
                    }
                    options={KIND_OPTIONS}
                  />
                </LabeledField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`stage-amount-${s.key}`}>
                    When
                  </FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id={`stage-amount-${s.key}`}
                      type="number"
                      min={0}
                      className="w-24"
                      value={s.amount}
                      onChange={(e) => patch(i, { amount: e.target.value })}
                      aria-label="Amount"
                    />
                    <SimpleSelect
                      value={s.unit}
                      onValueChange={(x) =>
                        patch(i, { unit: x as StageDraft["unit"] })
                      }
                      options={[
                        { value: "minutes", label: "minutes" },
                        { value: "hours", label: "hours" },
                        { value: "days", label: "days" },
                      ]}
                      placeholder="Unit"
                    />
                    <SimpleSelect
                      value={s.direction}
                      onValueChange={(x) =>
                        patch(i, { direction: x as StageDraft["direction"] })
                      }
                      options={[
                        { value: "before", label: "before" },
                        { value: "after", label: "after" },
                      ]}
                      placeholder="Direction"
                    />
                  </div>
                  <FieldDescription>
                    Relative to the anchor. Up to 90 days before, 30 days after.
                  </FieldDescription>
                </Field>
                <LabeledField label="Anchor" htmlFor={`stage-anchor-${s.key}`}>
                  <SimpleSelect
                    id={`stage-anchor-${s.key}`}
                    value={s.anchor}
                    onValueChange={(x) =>
                      patch(i, { anchor: x as StageDraft["anchor"] })
                    }
                    options={ANCHOR_OPTIONS}
                  />
                  <FieldDescription>
                    Counted from the {ANCHOR_LABEL[s.anchor]}.
                  </FieldDescription>
                </LabeledField>
              </div>
              <FieldSet>
                <FieldLegend variant="label">Recipients</FieldLegend>
                <FieldGroup className="flex-row flex-wrap gap-4">
                  {STAGE_RECIPIENTS.map((r) => (
                    <Field key={r} orientation="horizontal">
                      <Checkbox
                        id={`stage-${s.key}-${r}`}
                        checked={s.recipients.includes(r)}
                        onCheckedChange={(on) =>
                          patch(i, {
                            recipients:
                              on === true
                                ? [...s.recipients, r]
                                : s.recipients.filter((x) => x !== r),
                          })
                        }
                      />
                      <FieldLabel
                        htmlFor={`stage-${s.key}-${r}`}
                        className="font-normal"
                      >
                        {RECIPIENT_LABEL[r]}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
              {s.kind === "task" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <LabeledField
                    label="Assignee role"
                    htmlFor={`stage-assignee-${s.key}`}
                  >
                    <SimpleSelect
                      id={`stage-assignee-${s.key}`}
                      value={s.assigneeRole}
                      onValueChange={(x) => patch(i, { assigneeRole: x })}
                      options={ASSIGNEE_OPTIONS}
                      placeholder="Choose who completes it"
                    />
                  </LabeledField>
                  <Field orientation="horizontal">
                    <Switch
                      id={`stage-blocks-${s.key}`}
                      checked={s.blocksCheckout}
                      onCheckedChange={(x) => patch(i, { blocksCheckout: x })}
                    />
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor={`stage-blocks-${s.key}`}>
                        Blocks checkout
                      </FieldLabel>
                      <FieldDescription>
                        Equipment can't be handed out until this task is done.
                      </FieldDescription>
                    </div>
                  </Field>
                </div>
              )}
              <LabeledField label="Message" htmlFor={`stage-message-${s.key}`}>
                <Textarea
                  id={`stage-message-${s.key}`}
                  rows={3}
                  value={s.message}
                  onChange={(e) => patch(i, { message: e.target.value })}
                  placeholder="Your {event.title} at {studio.name} starts {event.first_day}. Pickup window: {pickup.window}."
                />
                <FieldDescription>
                  Placeholders: {"{event.title}"} {"{studio.name}"}{" "}
                  {"{event.first_day}"} {"{pickup.window}"}
                </FieldDescription>
              </LabeledField>
            </FieldGroup>
          </CardContent>
        </Card>
      ))}
      <div>
        <Button
          variant="outline"
          onClick={() => onChange([...stages, blankStage()])}
        >
          <PlusIcon data-icon="inline-start" />
          Add stage
        </Button>
      </div>
    </div>
  )
}
