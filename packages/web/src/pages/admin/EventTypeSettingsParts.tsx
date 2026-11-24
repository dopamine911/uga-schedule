import {
  LabeledField,
  SwitchField,
  TextField,
} from "@/components/admin/pickers"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { type SetSettings, type SettingsForm, whole } from "./eventTypeSettings"

type SectionProps = {
  v: SettingsForm
  set: SetSettings
  editable: boolean
}

/** A number input that must hold a whole number of 1 or more. */
function AtLeastOneField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const valid = whole(value, 1)
  return (
    <LabeledField
      label={label}
      htmlFor={id}
      error={valid ? undefined : "Enter a whole number, 1 or more."}
    >
      <Input
        id={id}
        type="number"
        min={1}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={valid ? undefined : true}
      />
    </LabeledField>
  )
}

/** Day, hour and minute limits of the event type. */
export function SettingsLimitsGrid({ v, set, editable }: SectionProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <AtLeastOneField
        id="et-max-days"
        label="Max days"
        value={v.maxDays}
        onChange={(x) => set("maxDays", x)}
        disabled={!editable}
      />
      <AtLeastOneField
        id="et-max-hours"
        label="Max hours per day"
        value={v.maxHoursPerDay}
        onChange={(x) => set("maxHoursPerDay", x)}
        disabled={!editable}
      />
      <TextField
        id="et-pickup"
        label="Pickup window (minutes)"
        type="number"
        value={v.pickupWindowMinutes}
        onChange={(x) => set("pickupWindowMinutes", x)}
        disabled={!editable}
        description="How long before the start a pickup may happen."
      />
      <TextField
        id="et-grace"
        label="Check-in grace (minutes)"
        type="number"
        value={v.checkinGraceMinutes}
        onChange={(x) => set("checkinGraceMinutes", x)}
        disabled={!editable}
      />
      <TextField
        id="et-results-days"
        label="Results due (days)"
        type="number"
        value={v.resultsDueDays}
        onChange={(x) => set("resultsDueDays", x)}
        disabled={!editable || !v.requiresResults}
        description="After the event ends."
      />
    </div>
  )
}

/** The yes/no rules of the event type. */
export function SettingsSwitches({ v, set, editable }: SectionProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SwitchField
        id="et-daily-return"
        label="Equipment returned daily"
        description="Equipment goes back at the end of each day instead of at the end of the event."
        checked={v.dailyEquipmentReturn}
        onCheckedChange={(x) => set("dailyEquipmentReturn", x)}
        disabled={!editable}
      />
      <SwitchField
        id="et-requires-results"
        label="Requires results"
        description="The requester must submit results after the event."
        checked={v.requiresResults}
        onCheckedChange={(x) => set("requiresResults", x)}
        disabled={!editable}
      />
      <SwitchField
        id="et-requester-upload"
        label="Requester can upload results"
        checked={v.requesterCanUpload}
        onCheckedChange={(x) => set("requesterCanUpload", x)}
        disabled={!editable}
      />
      <SwitchField
        id="et-signoff"
        label="Requires sponsor sign-off"
        description="A sponsor must sign off before the event is confirmed."
        checked={v.requiresSponsorSignoff}
        onCheckedChange={(x) => set("requiresSponsorSignoff", x)}
        disabled={!editable}
      />
    </div>
  )
}

/** Asks before deactivating a type that still has open events. */
export function DeactivateRunningDialog({
  open,
  onOpenChange,
  message,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  message: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate with open events?</AlertDialogTitle>
          <AlertDialogDescription>
            {message} They keep running under the current version; no new
            bookings will be accepted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep active</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Deactivate anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
