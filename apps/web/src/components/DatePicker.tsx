import { CalendarIcon, XIcon } from "lucide-react"
import { useState } from "react"
import type { Matcher } from "react-day-picker"
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
const toDate = (day: string) => new Date(`${day}T12:00:00`)
const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  isDisabled,
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
  /** Highlight this many consecutive days starting at the selection (multi-day events). */
  span?: number
  clearable?: boolean
  invalid?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? toDate(value) : undefined
  const disabled: Matcher[] = []
  if (min) disabled.push({ before: toDate(min) })
  if (max) disabled.push({ after: toDate(max) })
  if (isDisabled) disabled.push((d: Date) => isDisabled(toDay(d)))
  const last =
    selected && span > 1
      ? new Date(
          selected.getFullYear(),
          selected.getMonth(),
          selected.getDate() + span - 1
        )
      : undefined
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
            {value
              ? span > 1 && last
                ? `${fmtDay(value)} – ${fmtDay(toDay(last))}`
                : fmtDay(value)
              : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <div className="flex items-center justify-between gap-6 border-b-4 border-b-primary bg-brand-black px-4 py-3 text-white">
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
          {span > 1 ? (
            <Calendar
              mode="range"
              className={CALENDAR_CLASS}
              selected={selected ? { from: selected, to: last } : undefined}
              onDayClick={(d, modifiers) => {
                if (!modifiers.disabled) pick(d)
              }}
              defaultMonth={selected ?? (min ? toDate(min) : undefined)}
              disabled={disabled}
            />
          ) : (
            <Calendar
              mode="single"
              className={CALENDAR_CLASS}
              selected={selected}
              onSelect={pick}
              defaultMonth={selected ?? (min ? toDate(min) : undefined)}
              disabled={disabled}
            />
          )}
          {isDisabled && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Greyed-out days are unavailable.
            </p>
          )}
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
