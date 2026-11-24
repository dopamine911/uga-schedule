import { CalendarIcon, XIcon } from "lucide-react"
import { useState } from "react"
import type { Matcher } from "react-day-picker"
import {
  defaultMonthOf,
  disabledMatchers,
  flaggedModifiers,
  type FlaggedModifiers,
  lastDayOfSpan,
  rangeOf,
  selectedDate,
  toDay,
  triggerLabel,
} from "@/components/date-picker-dates"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { fmtDay } from "@/lib/format"
import { cn } from "@/lib/utils"

// Themed replacement for <input type="date">: the browser's native picker can't take the UGA theme.
// Values stay calendar strings ("YYYY-MM-DD"); Dates exist only inside the picker, pinned to local noon
// so no DST or offset change can shift the day.

/** Roomier cells than the shadcn default, with an Oswald month caption. */
const CALENDAR_CLASS =
  "p-3 [--cell-size:--spacing(9)] [&_.rdp-caption_label]:font-heading [&_.rdp-caption_label]:text-base [&_.rdp-caption_label]:font-medium [&_.rdp-caption_label]:tracking-wide [&_.rdp-caption_label]:uppercase"

/** Soft-rule days: still selectable, but marked so the student knows a justification may be needed. */
const FLAGGED_CLASS = {
  flagged: "font-semibold underline decoration-dashed underline-offset-4",
}

/** Black header band: what is being picked and the chosen day(s). */
function DatePickerHeader({ span, value }: { span: number; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-b-white/20 bg-brand-black px-4 py-3 text-white">
      <span className="flex flex-col leading-tight">
        <span className="text-[0.625rem] font-bold tracking-[0.18em] text-white/70 uppercase">
          {span > 1 ? `${span} consecutive days` : "Select a date"}
        </span>
        <span className="font-heading text-lg font-medium tracking-wide uppercase">
          {value ? fmtDay(value) : "No date yet"}
        </span>
      </span>
      <CalendarIcon aria-hidden="true" className="size-5 text-white/70" />
    </div>
  )
}

/** Legend for the greyed-out and underlined days. */
function DatePickerFooter({
  isDisabled,
  isFlagged,
  flaggedHint,
}: {
  isDisabled: ((day: string) => boolean) | undefined
  isFlagged: ((day: string) => boolean) | undefined
  flaggedHint: string | undefined
}) {
  return (
    <>
      {isDisabled && (
        <p className="w-0 min-w-full border-t px-4 py-2 text-xs text-muted-foreground">
          Greyed-out days are unavailable.
        </p>
      )}
      {isFlagged && flaggedHint && (
        <p className="w-0 min-w-full border-t px-4 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground underline decoration-dashed underline-offset-4">
            Underlined days
          </span>{" "}
          {flaggedHint}
        </p>
      )}
    </>
  )
}

/** Single-day calendar, or a range calendar that highlights `span` days from the selection. */
function DatePickerCalendar({
  span,
  selected,
  last,
  min,
  disabled,
  flagged,
  onPick,
}: {
  span: number
  selected: Date | undefined
  last: Date | undefined
  min: string | undefined
  disabled: Matcher[]
  flagged: FlaggedModifiers | undefined
  onPick: (d: Date | undefined) => void
}) {
  const defaultMonth = defaultMonthOf(selected, min)
  return span > 1 ? (
    <Calendar
      mode="range"
      className={CALENDAR_CLASS}
      selected={rangeOf(selected, last)}
      onDayClick={(d, modifiers) => {
        if (!modifiers.disabled) onPick(d)
      }}
      defaultMonth={defaultMonth}
      disabled={disabled}
      modifiersClassNames={FLAGGED_CLASS}
      {...flagged}
    />
  ) : (
    <Calendar
      mode="single"
      className={CALENDAR_CLASS}
      selected={selected}
      onSelect={onPick}
      defaultMonth={defaultMonth}
      disabled={disabled}
      modifiersClassNames={FLAGGED_CLASS}
      {...flagged}
    />
  )
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  isDisabled,
  isFlagged,
  flaggedHint,
  span = 1,
  clearable = false,
  invalid,
  className,
}: {
  id?: string
  /** "YYYY-MM-DD" or "" */
  value: string
  onChange: (day: string) => void
  placeholder?: string
  /** Earliest selectable day, inclusive. */
  min?: string
  /** Latest selectable day, inclusive. */
  max?: string
  /** Extra rule for unavailable days (e.g. studio closed that weekday). */
  isDisabled?: (day: string) => boolean
  /** Days that stay selectable but are marked (e.g. a soft notice rule needs a justification). */
  isFlagged?: (day: string) => boolean
  /** Legend for the marked days. */
  flaggedHint?: string
  /** Highlight this many consecutive days starting at the selection (multi-day events). */
  span?: number
  clearable?: boolean
  invalid?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = selectedDate(value)
  const disabled = disabledMatchers(min, max, isDisabled)
  const flagged = flaggedModifiers(isFlagged)
  const last = lastDayOfSpan(selected, span)
  const pick = (d: Date | undefined) => {
    if (!d) return
    onChange(toDay(d))
    setOpen(false)
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            aria-invalid={invalid || undefined}
            className={cn(
              "min-w-44 justify-start font-normal",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon data-icon="inline-start" />
            {triggerLabel(value, span, last, placeholder)}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto overflow-x-hidden overflow-y-auto p-0"
          align="start"
        >
          <DatePickerHeader span={span} value={value} />
          <DatePickerCalendar
            span={span}
            selected={selected}
            last={last}
            min={min}
            disabled={disabled}
            flagged={flagged}
            onPick={pick}
          />
          <DatePickerFooter
            isDisabled={isDisabled}
            isFlagged={isFlagged}
            flaggedHint={flaggedHint}
          />
        </PopoverContent>
      </Popover>
      {clearable && value && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear date"
          onClick={() => onChange("")}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}
