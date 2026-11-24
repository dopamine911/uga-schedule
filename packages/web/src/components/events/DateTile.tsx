import { fmtMonth, fmtWeekday } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Calendar-page tile for a "YYYY-MM-DD" date: red month band over an Oswald day number. */
export function DateTile({ day, className }: { day: string; className?: string }) {
  const d = new Date(`${day}T12:00:00Z`)
  const month = fmtMonth(day)
  const weekday = fmtWeekday(day)
  return (
    <div
      className={cn("bg-card flex w-14 shrink-0 flex-col overflow-hidden rounded-md border text-center", className)}
      aria-hidden="true"
    >
      <span className="bg-primary text-primary-foreground py-0.5 text-[0.625rem] font-bold tracking-[0.15em] uppercase">
        {month}
      </span>
      <span className="font-heading text-2xl leading-8 font-medium">{d.getUTCDate()}</span>
      <span className="text-muted-foreground pb-1 text-[0.625rem] uppercase">{weekday}</span>
    </div>
  )
}
