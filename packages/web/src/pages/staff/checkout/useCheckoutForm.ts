import { useMutation } from "@tanstack/react-query"
import type { Dispatch, SetStateAction } from "react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { useInvalidateEvent } from "@/components/events/shared"
import {
  type CheckoutBody,
  type CheckoutView,
  useInvalidateDesk,
} from "@/components/staff/shared"
import { api, unwrap } from "@/lib/api"
import {
  type CheckoutAttempt,
  type CheckoutRow,
  type CheckoutSelection,
  buildCheckoutBody,
  deriveCheckout,
  keepAvailableUnits,
  scanUnit,
} from "./checkoutForm"

/** Everything the checkout sections read and call. */
export interface CheckoutForm {
  rows: CheckoutRow[]
  hasHardBlocker: boolean
  hasOverridable: boolean
  termsInvalid: boolean
  overrideInvalid: boolean
  canComplete: boolean
  showFillHint: boolean
  scan: string
  setScan: Dispatch<SetStateAction<string>>
  onScan: (raw: string) => void
  overrideReason: string
  setOverrideReason: Dispatch<SetStateAction<string>>
  markOverrideTouched: () => void
  acknowledged: boolean
  setAcknowledged: Dispatch<SetStateAction<boolean>>
  setLineUnits: (lineId: string, next: string[]) => void
  setLineQty: (lineId: string, qty: number) => void
  setLineUnfilled: (lineId: string, reason: string) => void
  markLineUnfilledTouched: (lineId: string) => void
  submitError: Error | null
  submitPending: boolean
  onComplete: () => void
}

/** Selection, scan and submit state for the checkout page; `view` is undefined until loaded. */
export function useCheckoutForm(
  eventId: string,
  view: CheckoutView | undefined,
  refetch: () => Promise<{ data?: CheckoutView }>
): CheckoutForm {
  const navigate = useNavigate()
  const invalidateDesk = useInvalidateDesk()
  const invalidateEvent = useInvalidateEvent()
  const [unitsByLine, setUnitsByLine] = useState<Record<string, string[]>>({})
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({})
  const [unfilledByLine, setUnfilledByLine] = useState<Record<string, string>>(
    {}
  )
  const [overrideReason, setOverrideReason] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [scan, setScan] = useState("")
  // Required fields show as invalid only after a submit attempt or once the user has left them.
  const [submitTried, setSubmitTried] = useState(false)
  const [overrideTouched, setOverrideTouched] = useState(false)
  const [unfilledTouched, setUnfilledTouched] = useState<
    Record<string, boolean>
  >({})

  const submit = useMutation({
    mutationFn: (json: CheckoutBody) =>
      unwrap(api.checkout[":eventId"].$post({ param: { eventId }, json })),
    onSuccess: async (res) => {
      toast.success(
        res.checkedOut
          ? `Checked out ${res.checkedOut} item${res.checkedOut === 1 ? "" : "s"}. Event in progress.`
          : "Event started with no equipment."
      )
      await Promise.all([invalidateDesk(eventId), invalidateEvent(eventId)])
      navigate(`/events/${eventId}`)
    },
    onError: async () => {
      // A failed submit often means units went out or came back since the page loaded:
      // refetch, then drop selected units that are no longer available.
      const fresh = await refetch()
      if (!fresh.data) return
      const lines = fresh.data.lines
      setUnitsByLine((m) => keepAvailableUnits(m, lines))
    },
  })

  const sel: CheckoutSelection = { unitsByLine, qtyByLine, unfilledByLine }
  const attempt: CheckoutAttempt = {
    overrideReason,
    acknowledged,
    submitTried,
    overrideTouched,
    unfilledTouched,
    submitPending: submit.isPending,
  }
  const derived = deriveCheckout(view, sel, attempt)

  const onScan = (raw: string) =>
    scanUnit(raw, view?.lines ?? [], unitsByLine, setUnitsByLine)

  const onComplete = () => {
    setSubmitTried(true)
    if (!derived.canComplete) return
    submit.mutate(
      buildCheckoutBody(
        derived.rows,
        sel,
        overrideReason,
        derived.hasOverridable
      )
    )
  }

  return {
    ...derived,
    scan,
    setScan,
    onScan,
    overrideReason,
    setOverrideReason,
    markOverrideTouched: () => setOverrideTouched(true),
    acknowledged,
    setAcknowledged,
    setLineUnits: (lineId, next) =>
      setUnitsByLine((m) => ({ ...m, [lineId]: next })),
    setLineQty: (lineId, qty) => setQtyByLine((m) => ({ ...m, [lineId]: qty })),
    setLineUnfilled: (lineId, reason) =>
      setUnfilledByLine((m) => ({ ...m, [lineId]: reason })),
    markLineUnfilledTouched: (lineId) =>
      setUnfilledTouched((m) => ({ ...m, [lineId]: true })),
    submitError: submit.error,
    submitPending: submit.isPending,
    onComplete,
  }
}
