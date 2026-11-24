import { useMutation, useQuery } from "@tanstack/react-query"
import type { Dispatch, SetStateAction } from "react"
import { useState } from "react"
import { toast } from "sonner"
import { useInvalidateEvent } from "@/components/events/shared"
import {
  type CheckinBody,
  type CheckinResult,
  type CheckoutView,
  useInvalidateDesk,
  useNow,
} from "@/components/staff/shared"
import { api, unwrap } from "@/lib/api"
import { humanize } from "@/lib/format"
import {
  type CheckinRow,
  type Entry,
  blankEntry,
  buildItems,
  deriveRows,
  entryOf,
  labelOf,
} from "./checkinEntries"

/** Entry state, derivations and submit for the check-in page. */
export interface CheckinEntries {
  rows: CheckinRow[]
  scan: string
  setScan: Dispatch<SetStateAction<string>>
  onScan: (raw: string) => void
  setEntry: (recordId: string, patch: Partial<Entry>) => void
  markAllOk: () => void
  untouchedCount: number
  overdueCount: number
  anyInvalid: boolean
  readyCount: number
  damagedReady: CheckinRow[]
  confirmOpen: boolean
  setConfirmOpen: Dispatch<SetStateAction<boolean>>
  onSubmit: () => void
  submitReady: () => void
  submitError: Error | null
  submitPending: boolean
  result: CheckinResult | null
  labels: Record<string, string>
}

/** `view` is undefined until the checkout view has loaded. */
export function useCheckinEntries(
  eventId: string,
  view: CheckoutView | undefined
): CheckinEntries {
  const outstanding = view?.outstanding ?? []
  const now = useNow()
  const invalidateDesk = useInvalidateDesk()
  const invalidateEvent = useInvalidateEvent()
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [scan, setScan] = useState("")
  const [result, setResult] = useState<CheckinResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Labels of the items in the last submission, so the completion summary can name items that
  // have since left the outstanding list.
  const [labels, setLabels] = useState<Record<string, string>>({})

  const submit = useMutation({
    mutationFn: (json: CheckinBody) =>
      unwrap(
        api.checkout[":eventId"].checkin.$post({ param: { eventId }, json })
      ),
    onSuccess: async (res) => {
      setLabels(
        Object.fromEntries(outstanding.map((r) => [r.recordId, labelOf(r)]))
      )
      setResult(res)
      setEntries({})
      toast.success(res.complete ? "Check-in complete" : "Check-in saved")
      await Promise.all([invalidateDesk(eventId), invalidateEvent(eventId)])
    },
  })

  const rows = deriveRows(outstanding, entries, now)
  const readyRows = rows.filter((x) => x.ready)
  const damagedReady = readyRows.filter((x) => x.damaged)
  const submitReady = () => submit.mutate({ items: buildItems(readyRows) })

  const setEntry = (recordId: string, patch: Partial<Entry>) =>
    setEntries((m) => ({
      ...m,
      [recordId]: { ...entryOf(entries, recordId), ...patch },
    }))

  // Keyboard-wedge scanners (BR-007-15): a scanned serialized tag marks that unit ok.
  const onScan = (raw: string) => {
    const tag = raw.trim().toUpperCase()
    if (!tag) return
    const r = outstanding.find((x) => x.assetTag?.toUpperCase() === tag)
    if (!r) {
      toast.error(`${tag} is not outstanding on this event.`)
      return
    }
    const current = entryOf(entries, r.recordId).condition
    if (current !== undefined) {
      // Never overwrite a damaged or missing choice made on purpose.
      toast.info(`${r.assetTag} is already marked ${humanize(current)}.`)
      return
    }
    setEntry(r.recordId, { condition: "ok" })
    toast.success(`${r.assetTag} marked OK`)
  }

  const markAllOk = () => {
    setEntries((m) => {
      const next = { ...m }
      for (const r of outstanding) {
        const e = next[r.recordId] ?? blankEntry
        if (r.assetTag === null) {
          const sum = e.qtyOk + e.qtyDamaged + e.qtyMissing
          if (sum === 0) next[r.recordId] = { ...e, qtyOk: r.outstanding }
        } else if (e.condition === undefined) {
          next[r.recordId] = { ...e, condition: "ok" }
        }
      }
      return next
    })
  }

  // Damage places a hold on the requester (routes/checkout.ts), so confirm first.
  const onSubmit = () => {
    if (damagedReady.length) setConfirmOpen(true)
    else submitReady()
  }

  return {
    rows,
    scan,
    setScan,
    onScan,
    setEntry,
    markAllOk,
    untouchedCount: rows.filter((x) => !x.touched).length,
    overdueCount: rows.filter((x) => x.overdue).length,
    anyInvalid: rows.some((x) => x.invalid),
    readyCount: readyRows.length,
    damagedReady,
    confirmOpen,
    setConfirmOpen,
    onSubmit,
    submitReady,
    submitError: submit.error,
    submitPending: submit.isPending,
    result,
    labels,
  }
}

/** The LOST_AFTER_DAYS policy, used to word the missing-item warning. */
export function useLostAfterDays(): number | undefined {
  const policies = useQuery({
    queryKey: ["policies"],
    queryFn: () => unwrap(api.policies.$get()),
  })
  return policies.data?.LOST_AFTER_DAYS
}
