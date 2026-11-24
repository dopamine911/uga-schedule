import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type CalendarView = "week" | "month"

export function ScheduleToolbar({
  view,
  onViewChange,
  studioId,
  studios,
  studiosPending,
  allStudiosValue,
  label,
  unit,
  onStudioChange,
  onPrev,
  onToday,
  onNext,
}: {
  view: CalendarView
  onViewChange: (view: CalendarView) => void
  studioId: string
  studios: { id: string; name: string }[]
  studiosPending: boolean
  /** When set, the picker offers "All studios" with this value (month view only). */
  allStudiosValue?: string
  label: string
  unit: string
  onStudioChange: (id: string) => void
  onPrev: () => void
  onToday: () => void
  onNext: () => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2">
        <span id="calendar-view-label" className="text-sm font-medium">
          View
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(next) => {
            if (next === "week" || next === "month") onViewChange(next)
          }}
          aria-labelledby="calendar-view-label"
        >
          <ToggleGroupItem value="week">Week</ToggleGroupItem>
          <ToggleGroupItem value="month">Month</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="studio" className="text-sm font-medium">
          Studio
        </label>
        <Select
          value={studioId}
          onValueChange={onStudioChange}
          disabled={!studios.length}
        >
          <SelectTrigger id="studio" className="w-64 max-w-full">
            <SelectValue
              placeholder={studiosPending ? "Loading…" : "Choose a studio"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {allStudiosValue && (
                <SelectItem value={allStudiosValue}>All studios</SelectItem>
              )}
              {studios.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={`Previous ${unit}`}
          onClick={onPrev}
        >
          <ChevronLeftIcon />
        </Button>
        <Button variant="outline" onClick={onToday}>
          Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Next ${unit}`}
          onClick={onNext}
        >
          <ChevronRightIcon />
        </Button>
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}
