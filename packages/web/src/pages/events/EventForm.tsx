import { utcToLocal } from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useParams } from "react-router"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { useStudioAvailability } from "@/components/events/DayTimePicker"
import {
  DEFAULT_TIMES,
  daysOf,
  type DraftForm,
  EMPTY_FORM,
  isScheduleComplete,
} from "@/components/events/draft"
import type { EventDetail } from "@/components/events/shared"
import { BasicsCard } from "@/components/events/form/BasicsCard"
import { EquipmentCard } from "@/components/events/form/EquipmentCard"
import { FormAlerts } from "@/components/events/form/FormAlerts"
import { PeopleCard } from "@/components/events/form/PeopleCard"
import { ScheduleCard } from "@/components/events/form/ScheduleCard"
import { SummaryAside } from "@/components/events/form/SummaryAside"
import { useEventCheck } from "@/components/events/form/useEventCheck"
import {
  useEventDraft,
  useEventSave,
} from "@/components/events/form/useEventDraft"
import { useEventFormData } from "@/components/events/form/useEventFormData"
import {
  canSaveOf,
  canSubmitOf,
  dayAt,
  formAfterTypeChange,
  granularityOf,
  headerDescriptionOf,
  isInProgressOf,
  scheduleProblemsOf,
  selectedLinesOf,
  type SubmitState,
} from "@/components/events/form/rules"
import { api, unwrap } from "@/lib/api"
import { useUser } from "@/lib/auth"
import { humanize } from "@/lib/format"

// F-006 §1-6: one-page request form. Live checks run against the draft; submit needs no hard issues,
// and soft issues need a justification (BR-006-06). Edits of a non-draft request follow BR-006-11.

/** Form state for an existing request (edit). */
function formOf(ev: EventDetail): DraftForm {
  return {
    title: ev.title,
    description: ev.description,
    eventTypeId: ev.eventType.id,
    studioId: ev.studio.id,
    sponsorId: ev.sponsor?.id ?? "",
    participants: ev.participants,
    firstDay: ev.days[0]?.day ?? "",
    times: ev.days.length
      ? ev.days.map((d) => ({ startTime: d.startTime, endTime: d.endTime }))
      : [DEFAULT_TIMES],
    lines: Object.fromEntries(ev.lines.map((l) => [l.equipmentTypeId, l.qty])),
  }
}

export function EventFormPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const detail = useQuery({
    queryKey: ["event", id],
    queryFn: () => unwrap(api.events[":id"].$get({ param: { id: id! } })),
    enabled: editing,
  })
  if (!editing) return <EventForm initial={EMPTY_FORM} />
  return (
    <QueryView query={detail} rows={5}>
      {(ev) =>
        ev.can.edit ? (
          <EventForm
            key={ev.id}
            eventId={ev.id}
            detail={ev}
            initial={formOf(ev)}
          />
        ) : (
          <>
            <PageHeader title="Edit request" />
            <EmptyState
              title="This request can't be edited"
              description={`It is ${humanize(ev.state)} and you can't change it now.`}
            />
          </>
        )
      }
    </QueryView>
  )
}

function EventForm({
  eventId,
  detail,
  initial,
}: {
  eventId?: string
  detail?: EventDetail
  initial: DraftForm
}) {
  const me = useUser()
  const {
    form,
    setForm,
    patch,
    justification,
    setJustification,
    currentId,
    setCreatedId,
  } = useEventDraft(initial, detail, eventId)
  const data = useEventFormData(form, detail)
  const { type, studio, notice, activeHold, tz, nowMs } = data
  const check = useEventCheck(form, currentId)
  const availability = useStudioAvailability(
    form.studioId,
    form.firstDay,
    dayAt(form, form.times.length - 1) ?? "",
    currentId
  )
  const { save, remove } = useEventSave({
    form,
    justification,
    soft: check.soft,
    eventId,
    currentId,
    setCreatedId,
  })

  // Calendar "today" in campus time. The instant is read once per mount (render must stay pure);
  // the day is re-derived if the campus time zone arrives after the first render.
  const [openedAt] = useState(() => new Date().toISOString())
  const today = utcToLocal(openedAt, tz).day
  const days = daysOf(form)
  const scheduleComplete = isScheduleComplete(form)
  const sponsorId = form.sponsorId || null
  const isDraft = !detail || detail.state === "Draft"
  const submitState: SubmitState = {
    form,
    ready: check.ready,
    checking: check.checking,
    hard: check.hard,
    soft: check.soft,
    hasHold: activeHold !== undefined,
    justification,
  }

  return (
    <>
      <PageHeader
        title={eventId ? "Edit request" : "Request studio time"}
        description={headerDescriptionOf(detail)}
      />

      <FormAlerts inProgress={isInProgressOf(detail)} activeHold={activeHold} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <BasicsCard
            form={form}
            patch={patch}
            onTypeChange={(eventTypeId) =>
              setForm((f) => formAfterTypeChange(f, data.types, eventTypeId))
            }
            types={data.types}
            typesPending={data.typesPending}
            studios={data.studios}
            type={type}
            studio={studio}
          />
          <ScheduleCard
            form={form}
            setForm={setForm}
            patch={patch}
            type={type}
            studio={studio}
            notice={notice}
            today={today}
            tz={tz}
            nowMs={nowMs}
            availability={availability.data}
            availabilityError={availability.error}
            problems={scheduleProblemsOf(form, granularityOf(studio))}
          />
          <EquipmentCard
            days={days}
            excludeEventId={currentId}
            lines={form.lines}
            setForm={setForm}
          />
          <PeopleCard form={form} patch={patch} meId={me.id} />
        </div>

        <SummaryAside
          form={form}
          type={type}
          studio={studio}
          days={days}
          scheduleComplete={scheduleComplete}
          sponsorName={
            data.sponsors?.find((s) => s.id === sponsorId)?.displayName
          }
          selectedLines={selectedLinesOf(form, data.equipmentTypes)}
          check={check}
          submitState={submitState}
          canSave={canSaveOf(form)}
          canSubmit={canSubmitOf(submitState)}
          isDraft={isDraft}
          isNew={!detail}
          currentId={currentId}
          justification={justification}
          setJustification={setJustification}
          saving={save.isPending}
          savingMode={save.variables}
          saveError={save.error}
          removing={remove.isPending}
          onSave={(mode) => save.mutate(mode)}
          onDelete={() => remove.mutate()}
        />
      </div>
    </>
  )
}
