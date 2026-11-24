import { type STAGE_ANCHORS, STAGE_RECIPIENTS } from "@studio/domain"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
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
  LabeledField,
  SimpleSelect,
  useStudios,
} from "@/components/admin/pickers"
import { type StageDraft, blankStage } from "@/components/admin/stageDraft"

// Pieces of the event type editor: allowed studios and the pre-event stage schedule (F-005).

export function StudioCheckboxes({
  value,
  onChange,
}: {
  value: readonly string[]
  onChange: (ids: string[]) => void
}) {
  const studios = useStudios()
  const selected = new Set(value)
  return (
    <FieldSet>
      <FieldLegend variant="label">Allowed studios</FieldLegend>
      <FieldDescription>
        Students can request this event type only in the studios you pick.
      </FieldDescription>
      <FieldGroup className="gap-3">
        {(studios.data ?? []).map((s) => {
          const checked = selected.has(s.id)
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

/** Placeholders the server fills in when a stage message is sent (renderMessage, services/lifecycle.ts). */
const MESSAGE_PLACEHOLDERS: readonly (readonly [string, string])[] = [
  ["event.title", "the event's title"],
  ["studio.name", "the studio's name"],
  ["event.first_day", "the first event day"],
  ["event.days", "every event day with its hours"],
  ["equipment.list", "requested equipment and quantities"],
  ["pickup.window", "when pickup opens"],
  ["links.event", "a link to the event"],
  ["task.name", "the task's name (empty in reminders)"],
]

/** One-line description of a stage for its collapsed row: when it runs and who gets it. */
function stageSummary(s: StageDraft): { when: string; who: string } {
  const unit = Number(s.amount) === 1 ? s.unit.replace(/s$/, "") : s.unit
  const assignee =
    s.kind === "task" && s.assigneeRole
      ? ASSIGNEE_OPTIONS.find((o) => o.value === s.assigneeRole)?.label
      : undefined
  const recipients = s.recipients
    .map((r) => RECIPIENT_LABEL[r as (typeof STAGE_RECIPIENTS)[number]])
    .join(", ")
  return {
    when: `${s.amount || "0"} ${unit} ${s.direction} ${ANCHOR_LABEL[s.anchor]}`,
    who: assignee ?? (recipients || "No recipients"),
  }
}

export function StageEditor({
  stages,
  onChange,
}: {
  stages: StageDraft[]
  onChange: (next: StageDraft[]) => void
}) {
  // Stages start collapsed. A stage added in this session opens so its fields can be filled in.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const setOpen = (key: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
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
  const add = () => {
    const stage = blankStage()
    onChange([...stages, stage])
    setOpen(stage.key, true)
  }

  return (
    <div className="flex flex-col gap-4">
      {stages.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No stages yet. Add reminders or tasks that run before the event.
        </p>
      )}
      {stages.map((s, i) => {
        const isOpen = expanded.has(s.key)
        const bodyId = `stage-body-${s.key}`
        const { when, who } = stageSummary(s)
        return (
          <Card key={s.key} size="sm">
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? bodyId : undefined}
                  onClick={() => setOpen(s.key, !isOpen)}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {isOpen ? (
                    <ChevronDownIcon
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                  ) : (
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                  )}
                  <span className="text-sm font-medium">
                    Stage {i + 1}
                    {s.name.trim() ? `: ${s.name.trim()}` : ""}
                  </span>
                  <Badge variant="outline">
                    {s.kind === "task" ? "Task" : "Reminder"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{when}</span>
                  <span className="text-sm text-muted-foreground">{who}</span>
                  {s.kind === "task" && s.blocksCheckout && (
                    <Badge variant="warning">Blocks checkout</Badge>
                  )}
                </button>
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
              {isOpen && (
                <div id={bodyId} className="flex flex-col gap-4">
                  <FieldGroup>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <LabeledField
                        label="Name"
                        htmlFor={`stage-name-${s.key}`}
                      >
                        <Input
                          id={`stage-name-${s.key}`}
                          value={s.name}
                          onChange={(e) => patch(i, { name: e.target.value })}
                        />
                      </LabeledField>
                      <LabeledField
                        label="Kind"
                        htmlFor={`stage-kind-${s.key}`}
                      >
                        <SimpleSelect
                          id={`stage-kind-${s.key}`}
                          value={s.kind}
                          onValueChange={(x) =>
                            patch(i, {
                              kind: x as StageDraft["kind"],
                              blocksCheckout:
                                x === "task" ? s.blocksCheckout : false,
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
                        <div className="flex flex-wrap items-end gap-2">
                          <Input
                            id={`stage-amount-${s.key}`}
                            type="number"
                            min={0}
                            className="w-24"
                            value={s.amount}
                            onChange={(e) =>
                              patch(i, { amount: e.target.value })
                            }
                            aria-label="Amount"
                          />
                          <div className="flex flex-col gap-1">
                            <FieldLabel
                              htmlFor={`stage-unit-${s.key}`}
                              className="text-xs font-normal"
                            >
                              Unit
                            </FieldLabel>
                            <SimpleSelect
                              id={`stage-unit-${s.key}`}
                              value={s.unit}
                              onValueChange={(x) =>
                                patch(i, { unit: x as StageDraft["unit"] })
                              }
                              options={[
                                { value: "minutes", label: "minutes" },
                                { value: "hours", label: "hours" },
                                { value: "days", label: "days" },
                              ]}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <FieldLabel
                              htmlFor={`stage-direction-${s.key}`}
                              className="text-xs font-normal"
                            >
                              Direction
                            </FieldLabel>
                            <SimpleSelect
                              id={`stage-direction-${s.key}`}
                              value={s.direction}
                              onValueChange={(x) =>
                                patch(i, {
                                  direction: x as StageDraft["direction"],
                                })
                              }
                              options={[
                                { value: "before", label: "before" },
                                { value: "after", label: "after" },
                              ]}
                            />
                          </div>
                        </div>
                        <FieldDescription>
                          Relative to the anchor. Up to 90 days before, 30 days
                          after.
                        </FieldDescription>
                      </Field>
                      <LabeledField
                        label="Anchor"
                        htmlFor={`stage-anchor-${s.key}`}
                      >
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
                            onCheckedChange={(x) =>
                              patch(i, { blocksCheckout: x })
                            }
                          />
                          <div className="flex flex-col gap-1">
                            <FieldLabel htmlFor={`stage-blocks-${s.key}`}>
                              Blocks checkout
                            </FieldLabel>
                            <FieldDescription>
                              Equipment can't be handed out until this task is
                              done.
                            </FieldDescription>
                          </div>
                        </Field>
                      </div>
                    )}
                    <LabeledField
                      label="Message"
                      htmlFor={`stage-message-${s.key}`}
                    >
                      <Textarea
                        id={`stage-message-${s.key}`}
                        rows={3}
                        value={s.message}
                        onChange={(e) => patch(i, { message: e.target.value })}
                        placeholder="Your {event.title} at {studio.name} starts {event.first_day}. Pickup window: {pickup.window}."
                      />
                      <FieldDescription>
                        Placeholders, replaced when the message is sent:
                      </FieldDescription>
                      <ul className="ml-4 list-disc text-xs text-muted-foreground">
                        {MESSAGE_PLACEHOLDERS.map(([key, what]) => (
                          <li key={key}>
                            <code>{`{${key}}`}</code> {what}
                          </li>
                        ))}
                      </ul>
                    </LabeledField>
                  </FieldGroup>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
      <div>
        <Button variant="outline" onClick={add}>
          <PlusIcon data-icon="inline-start" />
          Add stage
        </Button>
      </div>
    </div>
  )
}
