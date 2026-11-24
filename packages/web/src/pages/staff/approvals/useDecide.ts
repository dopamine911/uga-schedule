import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useInvalidateEvent } from "@/components/events/shared"
import { ApiError } from "@/lib/api"

/**
 * Runs one decision for an event. On failure the queues reload, so a row someone else already
 * decided (409) drops off.
 */
export function useDecide(eventId: string) {
  const invalidate = useInvalidateEvent()
  const qc = useQueryClient()
  return async (run: () => Promise<unknown>, done: string) => {
    try {
      await run()
    } catch (err) {
      await qc.invalidateQueries({ queryKey: ["events", "approvals"] })
      if (err instanceof ApiError && err.status === 409)
        toast.error("Someone else has already decided this request.")
      throw err
    }
    toast.success(done)
    await invalidate(eventId)
  }
}
