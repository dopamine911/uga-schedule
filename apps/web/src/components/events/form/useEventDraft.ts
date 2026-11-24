import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { type DraftForm, draftPayload } from "@/components/events/draft"
import {
  type EventDetail,
  useInvalidateEvent,
} from "@/components/events/shared"
import { api, unwrap } from "@/lib/api"
import { type SaveMode, savedMessageOf } from "./rules"

/** Draft state of the request form: the form itself, the exception justification and the id it is saved under. */
export function useEventDraft(
  initial: DraftForm,
  detail: EventDetail | undefined,
  eventId: string | undefined
) {
  const [form, setForm] = useState<DraftForm>(initial)
  const [justification, setJustification] = useState(
    detail?.overrideJustification ?? ""
  )
  const patch = (p: Partial<DraftForm>) => setForm((f) => ({ ...f, ...p }))

  // A new request is saved as a draft on first submit; retries reuse that draft instead of creating another.
  const [createdId, setCreatedId] = useState<string>()
  const currentId = eventId ?? createdId

  return {
    form,
    setForm,
    patch,
    justification,
    setJustification,
    currentId,
    setCreatedId,
  }
}

/** Save, submit and delete of the draft held by `useEventDraft`. */
export function useEventSave({
  form,
  justification,
  soft,
  eventId,
  currentId,
  setCreatedId,
}: {
  form: DraftForm
  justification: string
  /** The live check found soft issues, so the justification is sent. */
  soft: boolean
  eventId: string | undefined
  currentId: string | undefined
  setCreatedId: (id: string) => void
}) {
  const navigate = useNavigate()
  const invalidate = useInvalidateEvent()
  const qc = useQueryClient()

  const save = useMutation({
    mutationFn: async (mode: SaveMode) => {
      const body = draftPayload(form, form.sponsorId || null)
      const reason = justification.trim()
      const ev = currentId
        ? await unwrap(
            api.events[":id"].$put({
              param: { id: currentId },
              json: {
                ...body,
                ...(soft && reason ? { justification: reason } : {}),
              },
            })
          )
        : await unwrap(api.events.$post({ json: body }))
      if (!currentId) {
        // Keep the new draft's id so a failed submit retries this draft instead of creating another.
        setCreatedId(ev.id)
        void invalidate(ev.id)
      }
      if (mode === "save") return ev
      return unwrap(
        api.events[":id"].submit.$post({
          param: { id: ev.id },
          json: { justification: soft ? reason : undefined },
        })
      )
    },
    onSuccess: async (ev, mode) => {
      await invalidate(ev.id)
      await qc.invalidateQueries({ queryKey: ["event", ev.id] })
      toast.success(savedMessageOf(mode, eventId !== undefined))
      navigate(`/events/${ev.id}`)
    },
  })

  const remove = useMutation({
    mutationFn: () =>
      unwrap(api.events[":id"].$delete({ param: { id: currentId! } })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events"] })
      toast.success("Draft deleted")
      navigate("/events")
    },
  })

  return { save, remove }
}
