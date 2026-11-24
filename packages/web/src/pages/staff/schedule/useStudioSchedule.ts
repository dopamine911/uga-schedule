import { useQuery } from "@tanstack/react-query"
import type { LocalDate } from "@studio/domain"
import { useState } from "react"
import { api, unwrap } from "@/lib/api"

function fetchSchedule(studioId: string, from: LocalDate, to: LocalDate) {
  return unwrap(
    api.studios[":id"].schedule.$get({
      param: { id: studioId },
      query: { from, to },
    })
  )
}

/** Studio choice (first active studio by default) and the schedule for one week. */
export function useStudioSchedule(weekStart: LocalDate, weekEnd: LocalDate) {
  const [studioPick, setStudioPick] = useState<string | null>(null)
  const studios = useQuery({
    queryKey: ["studios"],
    queryFn: () => unwrap(api.studios.$get()),
  })
  const activeStudios = (studios.data ?? []).filter(
    (s) => s.status === "active"
  )
  const studioId = studioPick ?? activeStudios[0]?.id ?? ""

  const schedule = useQuery({
    queryKey: ["studios", studioId, "schedule", weekStart, weekEnd],
    queryFn: () => fetchSchedule(studioId, weekStart, weekEnd),
    enabled: !!studioId,
  })

  return { studios, activeStudios, studioId, schedule, setStudioPick }
}
