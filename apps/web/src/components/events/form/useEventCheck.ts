import type { Issue } from "@studio/domain"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import type { DraftForm } from "@/components/events/draft"
import { api, unwrap } from "@/lib/api"
import { type CheckJson, checkPayloadOf } from "./rules"

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** What the live check tells the form. */
export interface CheckView {
  /** The form has enough to run the checks. */
  ready: boolean
  error: Error | null
  checking: boolean
  issues: readonly Issue[]
  hard: boolean
  soft: boolean
}

/** Live check (F-006 §5) of the draft, debounced so typing does not flood the API. */
export function useEventCheck(
  form: DraftForm,
  currentId: string | undefined
): CheckView {
  const payload = checkPayloadOf(form, currentId)
  const payloadKey = useDebounced(payload ? JSON.stringify(payload) : "", 400)
  const check = useQuery({
    queryKey: ["events", "check", payloadKey],
    queryFn: () =>
      unwrap(
        api.events.check.$post({ json: JSON.parse(payloadKey) as CheckJson })
      ),
    enabled: payloadKey !== "",
    placeholderData: keepPreviousData,
  })
  const issues = payloadKey === "" ? [] : (check.data?.issues ?? [])
  return {
    ready: payload !== null,
    error: check.error,
    checking: check.isFetching,
    issues,
    hard: issues.some((i) => i.severity === "hard"),
    soft: issues.some((i) => i.severity === "soft"),
  }
}
