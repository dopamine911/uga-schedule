import { utcToLocal } from "@studio/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { InferRequestType, InferResponseType } from "hono/client"
import { useEffect, useState } from "react"
import { api, unwrap } from "@/lib/api"
import { useMe } from "@/lib/auth"

export type CheckoutView = InferResponseType<
  (typeof api.checkout)[":eventId"]["$get"]
>
export type CheckoutLine = CheckoutView["lines"][number]
export type CheckoutOutstanding = CheckoutView["outstanding"][number]
export type CheckoutBody = InferRequestType<
  (typeof api.checkout)[":eventId"]["$post"]
>["json"]
export type CheckinBody = InferRequestType<
  (typeof api.checkout)[":eventId"]["checkin"]["$post"]
>["json"]
export type CheckinResult = InferResponseType<
  (typeof api.checkout)[":eventId"]["checkin"]["$post"]
>

/**
 * Current time in ms, shifted by the dev clock offset when dev mode is on (routes/dev.ts), so
 * highlighting (overdue, pickup open) agrees with the server's notion of "now". Re-renders every 30 s.
 */
export function useNow(): number {
  const me = useMe()
  const clock = useQuery({
    queryKey: ["dev", "clock"],
    queryFn: () => unwrap(api.dev.clock.$get()),
    enabled: !!me.data?.devMode,
  })
  const [wall, setWall] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setWall(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return wall + (clock.data?.offsetMs ?? 0)
}

/** Campus calendar date ("YYYY-MM-DD") of an instant in ms. */
export function campusDay(ms: number, tz: string): string {
  return utcToLocal(new Date(ms).toISOString(), tz).day
}

/** Calendar date arithmetic on "YYYY-MM-DD" (time-zone independent). */
export function addDaysTo(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function checkoutQuery(eventId: string) {
  return {
    queryKey: ["checkout", eventId],
    queryFn: () =>
      unwrap(api.checkout[":eventId"].$get({ param: { eventId } })),
  }
}

/** Invalidates every cached view touched by checkout or check-in of one event. */
export function useInvalidateDesk() {
  const qc = useQueryClient()
  return (eventId: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["checkout", eventId] }),
      qc.invalidateQueries({ queryKey: ["event", eventId] }),
      qc.invalidateQueries({ queryKey: ["events"] }),
      qc.invalidateQueries({ queryKey: ["holds"] }),
      qc.invalidateQueries({ queryKey: ["equipment"] }),
      qc.invalidateQueries({ queryKey: ["notifications"] }),
    ])
}
