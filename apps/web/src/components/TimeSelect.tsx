import { minutesOf, timeOf } from "@studio/domain"
import { ClockIcon } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { fmtTime } from "@/lib/format"
import { cn } from "@/lib/utils"

// Themed replacement for <input type="time">: a list of slots on the studio's granularity, with
// unavailable slots shown but disabled (and labelled why).

export function timeSlots(min: string, max: string, step: number): string[] {
  const out: string[] = []
  for (let m = minutesOf(min); m <= minutesOf(max); m += step)
    out.push(timeOf(m))
  return out
}

export function TimeSelect({
  id,
  value,
  onChange,
  min = "00:00",
  max = "23:45",
  step = 15,
  unavailable,
  placeholder = "Time",
  invalid,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string
  /** "HH:MM" or "" */
  value: string
  onChange: (time: string) => void
  min?: string
  max?: string
  step?: number
  /** Returns a short reason when a slot can't be chosen, e.g. "booked". */
  unavailable?: (time: string) => string | null
  placeholder?: string
  invalid?: boolean
  className?: string
  "aria-label"?: string
}) {
  const slots = timeSlots(min, max, step)
  // Keep an out-of-range current value selectable so editing old requests never silently drops it.
  if (value && !slots.includes(value)) slots.unshift(value)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn("w-36", className)}
      >
        <ClockIcon data-icon="inline-start" />
        <SelectValue placeholder={placeholder}>
          {value ? fmtTime(value) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectGroup>
          {slots.map((t) => {
            const reason = unavailable?.(t) ?? null
            return (
              <SelectItem
                key={t}
                value={t}
                disabled={reason !== null && t !== value}
              >
                {fmtTime(t)}
                {reason && (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {reason}
                  </span>
                )}
              </SelectItem>
            )
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
