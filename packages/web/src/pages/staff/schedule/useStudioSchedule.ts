import { useQueries, useQuery } from "@tanstack/react-query"
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

/** Studio picker value meaning "every active studio" (month view only). */
export const ALL_STUDIOS = "all"

/**
 * Studio choice (first active studio by default) and the schedule for a day range: one week, or one month
 * (at most 31 days, the API's limit). With ALL_STUDIOS picked, `studioMonths` holds one schedule per active studio.
 */
export function useStudioSchedule(from: LocalDate, to: LocalDate) {
  const [studioPick, setStudioPick] = useState<string | null>(null)
  const studios = useQuery({
    queryKey: ["studios"],
    queryFn: () => unwrap(api.studios.$get()),
  })
  const activeStudios = (studios.data ?? []).filter(
    (s) => s.status === "active"
  )
  const studioId = studioPick ?? activeStudios[0]?.id ?? ""
  const pickedStudios =
    studioId === ALL_STUDIOS
      ? activeStudios
      : activeStudios.filter((s) => s.id === studioId)

  const schedules = useQueries({
    queries: pickedStudios.map((studio) => ({
      queryKey: ["studios", studio.id, "schedule", from, to],
      queryFn: () => fetchSchedule(studio.id, from, to),
    })),
  })
  const schedule = {
    data: studioId === ALL_STUDIOS ? undefined : schedules[0]?.data,
    error: schedules.find((query) => query.error)?.error ?? null,
    isPending: schedules.some((query) => query.isPending),
  }
  const studioMonths = pickedStudios.flatMap((studio, index) => {
    const data = schedules[index]?.data
    return data
      ? [{ studioId: studio.id, studioName: studio.name, schedule: data }]
      : []
  })

  return {
    studios,
    activeStudios,
    studioId,
    schedule,
    studioMonths,
    setStudioPick,
  }
}
