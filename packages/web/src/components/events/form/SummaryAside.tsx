import type { DayInput } from "@studio/domain"
import { CircleCheckIcon, ClipboardListIcon } from "lucide-react"
import { ConfirmButton } from "@/components/admin/shared"
import { ErrorAlert, IconTitle, IssueList } from "@/components/common"
import type { DraftForm } from "@/components/events/draft"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { fmtDays } from "@/lib/format"
import type { CheckView } from "./useEventCheck"
import { type EventTypeRow, type SaveMode, type StudioRow, type SubmitState, submitHintOf } from "./rules"

interface SummaryAsideProps {
  form: DraftForm
  type: EventTypeRow | undefined
  studio: StudioRow | undefined
  days: DayInput[]
  scheduleComplete: boolean
  sponsorName: string | undefined
  selectedLines: { id: string; qty: number; name: string }[]
  check: CheckView
  submitState: SubmitState
  canSave: boolean
  canSubmit: boolean
  isDraft: boolean
  isNew: boolean
  currentId: string | undefined
  justification: string
  setJustification: (value: string) => void
  saving: boolean
  savingMode: SaveMode | undefined
  saveError: Error | null
  removing: boolean
  onSave: (mode: SaveMode) => void
  onDelete: () => void
}

/** Right-hand column: the request summary, live checks, justification and the submit/save/delete actions. */
export function SummaryAside(props: SummaryAsideProps) {
  const { check, saveError } = props
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={ClipboardListIcon}>Your request</IconTitle>
          </CardTitle>
          <CardDescription>Checks run as you change the form.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RequestSummary
            title={props.form.title.trim()}
            type={props.type}
            studio={props.studio}
            days={props.days}
            scheduleComplete={props.scheduleComplete}
            sponsorName={props.sponsorName}
            lines={props.selectedLines}
          />
          <Separator />
          <ChecksPanel check={check} />
          {check.soft && !check.hard && (
            <JustificationField justification={props.justification} setJustification={props.setJustification} />
          )}
          {saveError && <ErrorAlert error={saveError} />}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-2">
          <SubmitActions
            isDraft={props.isDraft}
            isNew={props.isNew}
            currentId={props.currentId}
            canSave={props.canSave}
            canSubmit={props.canSubmit}
            submitState={props.submitState}
            saving={props.saving}
            savingMode={props.savingMode}
            removing={props.removing}
            onSave={props.onSave}
            onDelete={props.onDelete}
          />
        </CardFooter>
      </Card>
    </aside>
  )
}

function RequestSummary({
  title,
  type,
  studio,
  days,
  scheduleComplete,
  sponsorName,
  lines,
}: {
  title: string
  type: EventTypeRow | undefined
  studio: StudioRow | undefined
  days: DayInput[]
  scheduleComplete: boolean
  sponsorName: string | undefined
  lines: { id: string; qty: number; name: string }[]
}) {
  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      <dt className="text-muted-foreground">What</dt>
      <dd className="truncate">{title || "—"}</dd>
      <dt className="text-muted-foreground">Type</dt>
      <dd>{type?.name ?? "—"}</dd>
      <dt className="text-muted-foreground">Studio</dt>
      <dd>{studio?.name ?? "—"}</dd>
      <dt className="text-muted-foreground">When</dt>
      <dd>{scheduleComplete ? fmtDays(days) : "—"}</dd>
      <dt className="text-muted-foreground">Sponsor</dt>
      <dd>{sponsorName ?? "—"}</dd>
      <dt className="text-muted-foreground">Equipment</dt>
      <dd>
        <EquipmentSummary lines={lines} />
      </dd>
    </dl>
  )
}

function EquipmentSummary({ lines }: { lines: { id: string; qty: number; name: string }[] }) {
  if (lines.length === 0) return "None"
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((l) => (
        <li key={l.id} className="flex justify-between gap-2">
          <span className="truncate">{l.name}</span>
          <span className="text-muted-foreground tabular-nums">×{l.qty}</span>
        </li>
      ))}
    </ul>
  )
}

function ChecksPanel({ check }: { check: CheckView }) {
  if (!check.ready)
    return (
      <p className="text-sm text-muted-foreground">
        Choose an event type, studio and times to run the checks.
      </p>
    )
  if (check.error) return <ErrorAlert error={check.error} />
  if (check.issues.length === 0)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {check.checking ? <Spinner /> : <CircleCheckIcon />}
        {check.checking ? "Checking…" : "All checks pass."}
      </p>
    )
  return <IssueList issues={check.issues} />
}

function JustificationField({
  justification,
  setJustification,
}: {
  justification: string
  setJustification: (value: string) => void
}) {
  const missing = justification.trim() === "" || undefined
  return (
    <Field data-invalid={missing}>
      <FieldLabel htmlFor="justification">Justification for exception</FieldLabel>
      <Textarea
        id="justification"
        required
        aria-invalid={missing}
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <FieldDescription>Staff read this when they confirm the request.</FieldDescription>
    </Field>
  )
}

function SubmitActions({
  isDraft,
  isNew,
  currentId,
  canSave,
  canSubmit,
  submitState,
  saving,
  savingMode,
  removing,
  onSave,
  onDelete,
}: {
  isDraft: boolean
  isNew: boolean
  currentId: string | undefined
  canSave: boolean
  canSubmit: boolean
  submitState: SubmitState
  saving: boolean
  savingMode: SaveMode | undefined
  removing: boolean
  onSave: (mode: SaveMode) => void
  onDelete: () => void
}) {
  return (
    <>
      {isDraft ? (
        <SubmitButton
          enabled={canSubmit}
          saving={saving}
          savingMode={savingMode}
          onClick={() => onSave("submit")}
        />
      ) : (
        <SaveChangesButton enabled={canSave} saving={saving} onClick={() => onSave("save")} />
      )}
      {(isDraft || isNew) && (
        <SaveDraftButton enabled={canSave} saving={saving} savingMode={savingMode} onClick={() => onSave("save")} />
      )}
      {currentId && isDraft && <DeleteDraftButton removing={removing} saving={saving} onDelete={onDelete} />}
      {!canSubmit && isDraft && <SubmitHint state={submitState} />}
    </>
  )
}

function SubmitButton({
  enabled,
  saving,
  savingMode,
  onClick,
}: {
  enabled: boolean
  saving: boolean
  savingMode: SaveMode | undefined
  onClick: () => void
}) {
  return (
    <Button disabled={!enabled || saving} onClick={onClick}>
      {saving && savingMode === "submit" && <Spinner data-icon="inline-start" />}
      Submit request
    </Button>
  )
}

function SaveChangesButton({
  enabled,
  saving,
  onClick,
}: {
  enabled: boolean
  saving: boolean
  onClick: () => void
}) {
  return (
    <Button disabled={!enabled || saving} onClick={onClick}>
      {saving && <Spinner data-icon="inline-start" />}
      Save changes
    </Button>
  )
}

function SaveDraftButton({
  enabled,
  saving,
  savingMode,
  onClick,
}: {
  enabled: boolean
  saving: boolean
  savingMode: SaveMode | undefined
  onClick: () => void
}) {
  return (
    <Button variant="outline" disabled={!enabled || saving} onClick={onClick}>
      {saving && savingMode === "save" && <Spinner data-icon="inline-start" />}
      Save draft
    </Button>
  )
}

function DeleteDraftButton({
  removing,
  saving,
  onDelete,
}: {
  removing: boolean
  saving: boolean
  onDelete: () => void
}) {
  return (
    <ConfirmButton
      label="Delete draft"
      title="Delete this draft?"
      description="The draft and its equipment and participant selections are removed. This cannot be undone."
      confirmLabel="Delete draft"
      variant="ghost"
      disabled={removing || saving}
      onConfirm={onDelete}
    />
  )
}

function SubmitHint({ state }: { state: SubmitState }) {
  return <p className="text-center text-xs text-muted-foreground">{submitHintOf(state)}</p>
}
