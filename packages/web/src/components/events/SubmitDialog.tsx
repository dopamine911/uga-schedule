import { useQuery, useQueryClient } from "@tanstack/react-query"
import { SendIcon } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import { toast } from "sonner"
import { ErrorAlert, IssueList } from "@/components/common"
import {
  type EventDetail,
  useInvalidateEvent,
} from "@/components/events/shared"
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
import { api, unwrap } from "@/lib/api"

// Submit a stored draft: re-runs the live check (F-006 §5) so exceptions and their justification are
// visible before the request goes to the sponsor (BR-006-06).

export function SubmitDialog({ ev }: { ev: EventDetail }) {
  const [open, setOpen] = useState(false)
  const [justification, setJustification] = useState("")
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  const invalidate = useInvalidateEvent()
  const qc = useQueryClient()

  const check = useQuery({
    queryKey: ["events", "check", "submit", ev.id],
    queryFn: () =>
      unwrap(
        api.events.check.$post({
          json: {
            eventTypeId: ev.eventType.id,
            studioId: ev.studio.id,
            sponsorId: ev.sponsor?.id ?? null,
            days: ev.days.map((d) => ({
              day: d.day,
              startTime: d.startTime,
              endTime: d.endTime,
            })),
            lines: ev.lines.map((l) => ({
              equipmentTypeId: l.equipmentTypeId,
              qty: l.qty,
            })),
            excludeEventId: ev.id,
          },
        })
      ),
    enabled: open,
  })
  const issues = check.data?.issues ?? []
  const hard = issues.some((i) => i.severity === "hard")
  const soft = issues.some((i) => i.severity === "soft")
  const needsJustification = soft && justification.trim() === ""
  const disabled = pending || check.isFetching || hard || needsJustification

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setJustification(ev.overrideJustification)
      setError(null)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (disabled) return
    setPending(true)
    setError(null)
    try {
      await unwrap(
        api.events[":id"].submit.$post({
          param: { id: ev.id },
          json: { justification: soft ? justification.trim() : undefined },
        })
      )
      await invalidate(ev.id)
      await qc.invalidateQueries({ queryKey: ["event", ev.id] })
      toast.success("Request submitted for sponsor approval")
      setOpen(false)
    } catch (err) {
      setError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <SendIcon data-icon="inline-start" />
          Submit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Submit request</DialogTitle>
            <DialogDescription>
              Your sponsor is asked to approve it. Check the rules below first.
            </DialogDescription>
          </DialogHeader>
          {check.error ? (
            <ErrorAlert error={check.error} />
          ) : check.isPending ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues found.</p>
          ) : (
            <IssueList issues={issues} />
          )}
          {soft && !hard && (
            <FieldGroup>
              <Field data-invalid={justification.trim() === "" || undefined}>
                <FieldLabel htmlFor="submit-justification">
                  Justification for exception
                </FieldLabel>
                <Textarea
                  id="submit-justification"
                  required
                  aria-invalid={justification.trim() === "" || undefined}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                />
                <FieldDescription>
                  Staff read this when they decide on the exception.
                </FieldDescription>
              </Field>
            </FieldGroup>
          )}
          {error != null && <ErrorAlert error={error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {pending && <Spinner data-icon="inline-start" />}
              Submit request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
