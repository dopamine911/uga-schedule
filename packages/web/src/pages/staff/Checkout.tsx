import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router"
import { ErrorAlert, LoadingBlock } from "@/components/common"
import { DeskEventHeader } from "@/components/staff/DeskEventHeader"
import { checkoutQuery } from "@/components/staff/shared"
import { api, unwrap } from "@/lib/api"
import {
  BlockersAlert,
  CheckoutFooter,
  CheckoutLines,
  OverrideReasonField,
  PickupWindowAlert,
  ScanField,
} from "./checkout/CheckoutSections"
import { useCheckoutForm } from "./checkout/useCheckoutForm"

export function CheckoutPage() {
  const { id = "" } = useParams()
  const event = useQuery({
    queryKey: ["event", id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id } })),
  })
  const co = useQuery(checkoutQuery(id))
  const form = useCheckoutForm(id, co.data, co.refetch)

  if (co.isPending || event.isPending) return <LoadingBlock rows={4} />
  if (co.error) return <ErrorAlert error={co.error} />
  if (event.error) return <ErrorAlert error={event.error} />
  const view = co.data
  const ev = event.data

  return (
    <div className="flex flex-col gap-6">
      <DeskEventHeader action="Check out" event={ev} />

      <PickupWindowAlert pickupWindow={view.window} />

      <BlockersAlert
        blockers={view.blockers}
        hasHardBlocker={form.hasHardBlocker}
        eventId={id}
      />

      {form.hasOverridable && (
        <OverrideReasonField
          value={form.overrideReason}
          invalid={form.overrideInvalid}
          onChange={form.setOverrideReason}
          onBlur={form.markOverrideTouched}
        />
      )}

      <ScanField
        value={form.scan}
        onChange={form.setScan}
        onScan={form.onScan}
      />

      <CheckoutLines form={form} />

      <CheckoutFooter form={form} termsVersion={view.termsVersion} />
    </div>
  )
}
