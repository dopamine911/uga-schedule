import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useInvalidateEvent } from "@/components/events/shared"

/** Reloads every results query and the event after the package changes. */
export function useRefreshPackage(eventId: string) {
  const qc = useQueryClient()
  const invalidateEvent = useInvalidateEvent()
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["results"] }),
      invalidateEvent(eventId),
    ])
  }
}

/** A mutation of the package: reloads every results query and the event, then runs `onDone`. */
export function usePackageMutation<TVariables = void>(
  eventId: string,
  options: {
    mutationFn: (variables: TVariables) => Promise<unknown>
    onDone?: () => void
    onError?: (error: Error) => void
  }
) {
  const qc = useQueryClient()
  const invalidateEvent = useInvalidateEvent()
  return useMutation({
    mutationFn: options.mutationFn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["results"] }),
        invalidateEvent(eventId),
      ])
      options.onDone?.()
    },
    onError: options.onError,
  })
}
