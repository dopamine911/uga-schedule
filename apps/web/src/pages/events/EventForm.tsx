import { isLocalDate, minutesOf, utcToLocal, weekdayOf } from "@studio/domain"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  CalendarClockIcon,
  CircleCheckIcon,
  ClipboardListIcon,
  FileTextIcon,
  PackageIcon,
  UsersIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import {
  EmptyState,
  ErrorAlert,
  IconTitle,
  IssueList,
  PageHeader,
  QueryView,
} from "@/components/common"
import { EquipmentPicker } from "@/components/events/EquipmentPicker"
import {
  type EventDetail,
  useInvalidateEvent,
} from "@/components/events/shared"
import {
  ParticipantsPicker,
  SponsorSelect,
} from "@/components/events/PeoplePicker"
import { DatePicker } from "@/components/DatePicker"
import {
  DayTimePicker,
  useStudioAvailability,
} from "@/components/events/DayTimePicker"
import {
  addDays,
  DEFAULT_TIMES,
  type DraftForm,
  EMPTY_FORM,
  daysOf,
  draftPayload,
  isScheduleComplete,
  linesOf,
  withNumDays,
} from "@/components/events/draft"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, unwrap } from "@/lib/api"
import { useTz, useUser } from "@/lib/auth"
import { fmtDays, humanize } from "@/lib/format"

// F-006 §1-6: one-page request form. Live checks run against the draft; submit needs no hard issues,
// and soft issues need a justification (BR-006-06). Edits of a non-draft request follow BR-006-11.

type CheckJson = Parameters<typeof api.events.check.$post>[0]["json"]

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

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
  const navigate = useNavigate()
  const invalidate = useInvalidateEvent()
  const qc = useQueryClient()

  const [form, setForm] = useState<DraftForm>(initial)
  const [justification, setJustification] = useState(
    detail?.overrideJustification ?? ""
  )
  const patch = (p: Partial<DraftForm>) => setForm((f) => ({ ...f, ...p }))

  const types = useQuery({
    queryKey: ["event-types"],
    queryFn: () => unwrap(api["event-types"].$get()),
  })
  const studios = useQuery({
    queryKey: ["studios"],
    queryFn: () => unwrap(api.studios.$get()),
  })

  const type = types.data?.find((t) => t.id === form.eventTypeId)
  const maxDays = type?.maxDays ?? 31
  const studio = studios.data?.find((s) => s.id === form.studioId)
  const granularity = studio?.slotGranularityMinutes ?? 15
  const days = daysOf(form)
  const scheduleComplete = isScheduleComplete(form)
  const sponsorId = form.sponsorId || null
  const isDraft = !detail || detail.state === "Draft"

  const tz = useTz()
  const today = utcToLocal(new Date().toISOString(), tz).day
  const lastDay = isLocalDate(form.firstDay)
    ? addDays(form.firstDay, form.times.length - 1)
    : ""
  const availability = useStudioAvailability(
    form.studioId,
    form.firstDay,
    lastDay,
    eventId
  )
  // Live check (F-006 §5), debounced so typing does not flood the API.
  const payload: CheckJson | null =
    form.eventTypeId && form.studioId && scheduleComplete
      ? {
          eventTypeId: form.eventTypeId,
          studioId: form.studioId,
          sponsorId,
          days,
          lines: linesOf(form),
          excludeEventId: eventId,
        }
      : null
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
  const hard = issues.some((i) => i.severity === "hard")
  const soft = issues.some((i) => i.severity === "soft")

  const save = useMutation({
    mutationFn: async (mode: "save" | "submit") => {
      const body = draftPayload(form, sponsorId)
      const reason = justification.trim()
      const ev = eventId
        ? await unwrap(
            api.events[":id"].$put({
              param: { id: eventId },
              json: {
                ...body,
                ...(soft && reason ? { justification: reason } : {}),
              },
            })
          )
        : await unwrap(api.events.$post({ json: body }))
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
      toast.success(
        mode === "submit"
          ? "Request submitted for sponsor approval"
          : eventId
            ? "Changes saved"
            : "Draft saved"
      )
      navigate(`/events/${ev.id}`)
    },
  })

  const canSave =
    form.title.trim() !== "" && form.eventTypeId !== "" && form.studioId !== ""
  const canSubmit =
    canSave &&
    sponsorId !== null &&
    scheduleComplete &&
    payload !== null &&
    !check.isFetching &&
    !hard &&
    (!soft || justification.trim() !== "")
  const scheduleProblems = scheduleProblemsOf(form, granularity)

  // Type change: drop a studio the type doesn't allow; keep the day count within the type limit.
  const onTypeChange = (eventTypeId: string) => {
    const next = types.data?.find((t) => t.id === eventTypeId)
    const allowed = next?.allowedStudios.some((s) => s.id === form.studioId)
    const limit = next?.maxDays ?? 31
    setForm((f) => ({
      ...withNumDays(f, Math.min(f.times.length, limit)),
      eventTypeId,
      studioId: allowed ? f.studioId : "",
    }))
  }

  const allowedStudios = type?.allowedStudios ?? []
  const equipmentTypes = useQuery({
    queryKey: ["equipment", "types"],
    queryFn: () => unwrap(api.equipment.types.$get({ query: {} })),
  })
  const sponsors = useQuery({
    queryKey: ["users", "sponsors"],
    queryFn: () => unwrap(api.users.sponsors.$get()),
  })
  const sponsorName = sponsors.data?.find(
    (s) => s.id === sponsorId
  )?.displayName
  const selectedLines = Object.entries(form.lines)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({
      id,
      qty,
      name: equipmentTypes.data?.find((t) => t.id === id)?.name ?? "…",
    }))
  const studioOptions = allowedStudios.map((s) => ({
    ...s,
    rule: studios.data?.find((x) => x.id === s.id),
  }))

  return (
    <>
      <PageHeader
        title={eventId ? "Edit request" : "Request studio time"}
        description={
          detail && !isDraft
            ? `This request is ${humanize(detail.state)}.`
            : "Pick a studio, the days and equipment. Checks run as you go."
        }
      />

      {detail && !isDraft && (
        <Alert>
          <AlertTitle>
            Changing a request that is already in progress
          </AlertTitle>
          <AlertDescription>
            Changing dates, studio or equipment sends this back to staff for
            confirmation. Changing the sponsor or event type needs sponsor
            approval again. Changing only the title, description or participants
            does not.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <IconTitle icon={FileTextIcon}>1. Basics</IconTitle>
              </CardTitle>
              <CardDescription>
                What the session is and where it happens.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="title">Title</FieldLabel>
                  <Input
                    id="title"
                    required
                    maxLength={200}
                    value={form.title}
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="description">Description</FieldLabel>
                  <Textarea
                    id="description"
                    maxLength={5000}
                    value={form.description}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="event-type">Event type</FieldLabel>
                  <Select value={form.eventTypeId} onValueChange={onTypeChange}>
                    <SelectTrigger id="event-type" className="w-full">
                      <SelectValue
                        placeholder={
                          types.isPending ? "Loading…" : "Choose an event type"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(types.data ?? []).map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {type && (
                    <FieldDescription>
                      Up to {type.maxDays} {type.maxDays === 1 ? "day" : "days"}
                      {type.maxHoursPerDay
                        ? ` · up to ${type.maxHoursPerDay} hours a day`
                        : ""}
                    </FieldDescription>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="studio">Studio</FieldLabel>
                  <Select
                    value={form.studioId}
                    onValueChange={(studioId) => patch({ studioId })}
                    disabled={!type}
                  >
                    <SelectTrigger id="studio" className="w-full">
                      <SelectValue
                        placeholder={
                          type
                            ? "Choose a studio"
                            : "Choose an event type first"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {studioOptions.map((s) => {
                          const locked =
                            s.rule !== undefined && !s.rule.eligibleToday
                          return (
                            <SelectItem
                              key={s.id}
                              value={s.id}
                              disabled={locked}
                            >
                              {s.name}
                              {s.rule && ` · min level ${s.rule.minLevel.name}`}
                              {locked &&
                                " · Requires " + (s.rule?.minLevel.name ?? "")}
                            </SelectItem>
                          )
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {studio && !studio.eligibleToday && (
                    <FieldError>
                      Requires {studio.minLevel.name}. Your access does not
                      cover this studio yet.
                    </FieldError>
                  )}
                  {studio && studio.eligibleToday && (
                    <FieldDescription>
                      Studio minimum: {studio.minLevel.name}
                    </FieldDescription>
                  )}
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <IconTitle icon={CalendarClockIcon}>2. Schedule</IconTitle>
              </CardTitle>
              <CardDescription>
                Consecutive days, one start and end time per day.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <FieldGroup>
                <div className="flex flex-wrap items-end gap-6">
                  <Field className="w-auto">
                    <FieldLabel htmlFor="first-day">
                      {form.times.length > 1 ? "Dates" : "Date"}
                    </FieldLabel>
                    <DatePicker
                      id="first-day"
                      value={form.firstDay}
                      onChange={(firstDay) => patch({ firstDay })}
                      min={today}
                      isDisabled={
                        studio
                          ? (d) =>
                              !studio.openingHours.some(
                                (h) => h.weekday === weekdayOf(d)
                              )
                          : undefined
                      }
                      span={form.times.length}
                      placeholder="Choose the first day"
                    />
                    <FieldDescription>
                      {studio
                        ? "Days the studio is closed are greyed out."
                        : "Choose a studio first to see closed days."}
                    </FieldDescription>
                  </Field>
                  <Field className="w-auto">
                    <FieldLabel>Number of days</FieldLabel>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      aria-label="Number of days"
                      value={String(form.times.length)}
                      onValueChange={(v) =>
                        v && setForm((f) => withNumDays(f, Number(v)))
                      }
                    >
                      {Array.from({ length: Math.min(maxDays, 7) }, (_, i) => (
                        <ToggleGroupItem
                          key={i}
                          value={String(i + 1)}
                          className="min-w-9"
                        >
                          {i + 1}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <FieldDescription>
                      {type
                        ? `${type.name} allows up to ${maxDays} consecutive ${maxDays === 1 ? "day" : "days"}.`
                        : "Consecutive days."}
                    </FieldDescription>
                  </Field>
                </div>
                <div className="flex flex-col gap-3">
                  {availability.error && (
                    <ErrorAlert error={availability.error} />
                  )}
                  {form.times.map((t, i) => {
                    const day = isLocalDate(form.firstDay)
                      ? addDays(form.firstDay, i)
                      : undefined
                    return (
                      <DayTimePicker
                        key={i}
                        day={day}
                        index={i}
                        startTime={t.startTime}
                        endTime={t.endTime}
                        onChange={(times) =>
                          setForm((f) => ({
                            ...f,
                            times: f.times.map((x, j) => (j === i ? times : x)),
                          }))
                        }
                        step={granularity}
                        turnaround={studio?.turnaroundMinutes ?? 0}
                        maxHours={type?.maxHoursPerDay ?? 24}
                        availability={
                          day && form.studioId
                            ? availability.data?.get(day)
                            : undefined
                        }
                      />
                    )
                  })}
                  <p className="text-xs text-muted-foreground">
                    Times are campus time ({tz}).
                  </p>
                </div>
              </FieldGroup>
              {scheduleProblems.length > 0 && (
                <Alert>
                  <AlertTitle>Schedule</AlertTitle>
                  <AlertDescription>
                    {scheduleProblems.join(" ")}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <IconTitle icon={PackageIcon}>3. Equipment</IconTitle>
              </CardTitle>
              <CardDescription>
                Available on your days. Items above your access level are
                locked.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EquipmentPicker
                days={days}
                excludeEventId={eventId}
                lines={form.lines}
                onQtyChange={(equipmentTypeId, qty) =>
                  setForm((f) => ({
                    ...f,
                    lines: { ...f.lines, [equipmentTypeId]: qty },
                  }))
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <IconTitle icon={UsersIcon}>4. People</IconTitle>
              </CardTitle>
              <CardDescription>
                Your sponsor approves the request. Participants see it on their
                calendar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="sponsor">Sponsor</FieldLabel>
                  <SponsorSelect
                    id="sponsor"
                    value={form.sponsorId}
                    onValueChange={(sponsorId) =>
                      patch({
                        sponsorId,
                        participants: form.participants.filter(
                          (p) => p.id !== sponsorId
                        ),
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>Participants</FieldLabel>
                  <ParticipantsPicker
                    value={form.participants}
                    excludeIds={[me.id, ...(sponsorId ? [sponsorId] : [])]}
                    onChange={(participants) => patch({ participants })}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <IconTitle icon={ClipboardListIcon}>Your request</IconTitle>
              </CardTitle>
              <CardDescription>
                Checks run as you change the form.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">What</dt>
                <dd className="truncate">{form.title.trim() || "—"}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd>{type?.name ?? "—"}</dd>
                <dt className="text-muted-foreground">Studio</dt>
                <dd>{studio?.name ?? "—"}</dd>
                <dt className="text-muted-foreground">When</dt>
                <dd>{scheduleComplete ? fmtDays(days) : "—"}</dd>
                <dt className="text-muted-foreground">Sponsor</dt>
                <dd>{sponsorName ?? "—"}</dd>
                <dt className="text-muted-foreground">Equipment</dt>
                <dd>
                  {selectedLines.length === 0 ? (
                    "None"
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {selectedLines.map((l) => (
                        <li key={l.id} className="flex justify-between gap-2">
                          <span className="truncate">{l.name}</span>
                          <span className="text-muted-foreground tabular-nums">
                            ×{l.qty}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </dl>
              <Separator />
              {payload === null ? (
                <p className="text-sm text-muted-foreground">
                  Choose an event type, studio and times to run the checks.
                </p>
              ) : check.error ? (
                <ErrorAlert error={check.error} />
              ) : issues.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  {check.isFetching ? <Spinner /> : <CircleCheckIcon />}
                  {check.isFetching ? "Checking…" : "All checks pass."}
                </p>
              ) : (
                <IssueList issues={issues} />
              )}
              {soft && !hard && (
                <Field data-invalid={justification.trim() === "" || undefined}>
                  <FieldLabel htmlFor="justification">
                    Justification for exception
                  </FieldLabel>
                  <Textarea
                    id="justification"
                    required
                    aria-invalid={justification.trim() === "" || undefined}
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                  />
                  <FieldDescription>
                    Staff read this when they confirm the request.
                  </FieldDescription>
                </Field>
              )}
              {save.error && <ErrorAlert error={save.error} />}
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-2">
              {isDraft ? (
                <Button
                  disabled={!canSubmit || save.isPending}
                  onClick={() => save.mutate("submit")}
                >
                  {save.isPending && save.variables === "submit" && (
                    <Spinner data-icon="inline-start" />
                  )}
                  Submit request
                </Button>
              ) : (
                <Button
                  disabled={!canSave || save.isPending}
                  onClick={() => save.mutate("save")}
                >
                  {save.isPending && <Spinner data-icon="inline-start" />}
                  Save changes
                </Button>
              )}
              {(isDraft || !detail) && (
                <Button
                  variant="outline"
                  disabled={!canSave || save.isPending}
                  onClick={() => save.mutate("save")}
                >
                  {save.isPending && save.variables === "save" && (
                    <Spinner data-icon="inline-start" />
                  )}
                  Save draft
                </Button>
              )}
              {!canSubmit && isDraft && (
                <p className="text-center text-xs text-muted-foreground">
                  {!canSave
                    ? "Add a title, event type and studio to save."
                    : !sponsorId
                      ? "Choose a sponsor to submit."
                      : !scheduleComplete
                        ? "Complete the schedule to submit."
                        : hard
                          ? "Fix the issues above to submit."
                          : soft && !justification.trim()
                            ? "Add a justification to submit."
                            : "Checking…"}
                </p>
              )}
            </CardFooter>
          </Card>
        </aside>
      </div>
    </>
  )
}

/** Plain-language schedule problems the API would otherwise only report on submit. */
function scheduleProblemsOf(form: DraftForm, granularity: number): string[] {
  const out: string[] = []
  form.times.forEach((t, i) => {
    if (minutesOf(t.endTime) <= minutesOf(t.startTime)) return
    const start = minutesOf(t.startTime)
    const end = minutesOf(t.endTime)
    if (start % granularity !== 0 || end % granularity !== 0)
      out.push(
        `Day ${i + 1} must start and end on a ${granularity}-minute boundary.`
      )
  })
  return out
}
