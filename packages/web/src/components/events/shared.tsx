import { type EventState, TERMINAL } from "@studio/domain"
import { useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { CheckIcon } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import { ErrorAlert } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { api } from "@/lib/api"
import { humanize } from "@/lib/format"

// Building blocks shared by the event and results pages.

export type EventSummary = InferResponseType<typeof api.events.$get>[number]
export type EventDetail = InferResponseType<(typeof api.events)[":id"]["$get"]>

/** Invalidates every cached view of one event after a mutation. */
export function useInvalidateEvent() {
  const qc = useQueryClient()
  return (id: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["event", id] }),
      qc.invalidateQueries({ queryKey: ["events"] }),
      qc.invalidateQueries({ queryKey: ["notifications"] }),
    ])
}

/** "Needs review" flag plus its reasons, and requested policy exceptions. */
export function ReviewBadges({
  needsReview,
  reviewReasons,
  overrideRequested,
}: {
  needsReview: boolean
  reviewReasons?: readonly string[]
  overrideRequested?: readonly string[]
}) {
  if (!needsReview && !overrideRequested?.length) return null
  return (
    <span className="flex flex-wrap items-center gap-1">
      {needsReview && <Badge variant="destructive">Needs review</Badge>}
      {needsReview &&
        reviewReasons?.map((r) => (
          <Badge key={r} variant="outline">
            {humanize(r)}
          </Badge>
        ))}
      {overrideRequested?.map((r) => (
        <Badge key={r} variant="secondary">
          Exception: {humanize(r)}
        </Badge>
      ))}
    </span>
  )
}

const HAPPY_PATH: { state: EventState; label: string }[] = [
  { state: "Draft", label: "Draft" },
  { state: "Submitted", label: "Submitted" },
  { state: "SponsorApproved", label: "Sponsor approved" },
  { state: "Confirmed", label: "Confirmed" },
  { state: "InProgress", label: "In progress" },
  { state: "PostEvent", label: "Post-event" },
  { state: "Closed", label: "Closed" },
]

/** Lifecycle stepper (F-006 §3). Terminal off-path states are shown as a final badge. */
export function LifecycleStepper({ state }: { state: EventState }) {
  const index = HAPPY_PATH.findIndex((s) => s.state === state)
  const offPath = index === -1
  return (
    <ol
      className="flex flex-wrap items-center gap-2"
      aria-label="Event lifecycle"
    >
      {HAPPY_PATH.map((s, i) => {
        const done = !offPath && i < index
        const current = !offPath && i === index
        return (
          <li
            key={s.state}
            className="flex items-center gap-2"
            aria-current={current ? "step" : undefined}
          >
            <Badge
              variant={current ? "default" : done ? "secondary" : "outline"}
            >
              {done && <CheckIcon data-icon="inline-start" />}
              {s.label}
            </Badge>
            {i < HAPPY_PATH.length - 1 && (
              <span className="text-xs text-muted-foreground">→</span>
            )}
          </li>
        )
      })}
      {offPath && TERMINAL.includes(state) && (
        <li className="flex items-center gap-2" aria-current="step">
          <span className="text-xs text-muted-foreground">·</span>
          <Badge variant="destructive">
            {state === "NoShow" ? "No-show" : humanize(state)}
          </Badge>
        </li>
      )}
    </ol>
  )
}

export interface DialogField {
  name: string
  label: string
  description?: string
  required?: boolean
  placeholder?: string
}

/**
 * Dialog that collects one or more free-text fields (notes, reasons) and runs an async action.
 * Closes on success; API errors are shown inline.
 */
export function TextActionDialog({
  trigger,
  title,
  description,
  fields,
  confirmLabel,
  destructive,
  onSubmit,
  children,
}: {
  trigger: ReactNode
  title: string
  description?: ReactNode
  fields: DialogField[]
  confirmLabel: string
  destructive?: boolean
  onSubmit: (values: Record<string, string>) => Promise<unknown>
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  const missing = fields.some(
    (f) => f.required && !(values[f.name] ?? "").trim()
  )

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setValues({})
      setError(null)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (missing) return
    setPending(true)
    setError(null)
    try {
      await onSubmit(
        Object.fromEntries(
          fields.map((f) => [f.name, (values[f.name] ?? "").trim()])
        )
      )
      setOpen(false)
    } catch (err) {
      setError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          {children}
          <FieldGroup>
            {fields.map((f) => (
              <Field key={f.name}>
                <FieldLabel htmlFor={`dlg-${f.name}`}>
                  {f.label}
                  {!f.required && (
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  )}
                </FieldLabel>
                <Textarea
                  id={`dlg-${f.name}`}
                  value={values[f.name] ?? ""}
                  placeholder={f.placeholder}
                  required={f.required}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.name]: e.target.value }))
                  }
                />
                {f.description && (
                  <FieldDescription>{f.description}</FieldDescription>
                )}
              </Field>
            ))}
          </FieldGroup>
          {error != null && <ErrorAlert error={error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending || missing}
            >
              {pending && <Spinner data-icon="inline-start" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
