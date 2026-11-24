import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  coursePayload,
  courseDatesChanged,
  courseFormValues,
  courseRangeInvalid,
  courseSubmitDisabled,
} from "@/components/admin/courseForm"
import { toastSaved } from "@/components/admin/formHelpers"
import { FormDialog } from "@/components/admin/shared"
import {
  type CourseSummary,
  LabeledField,
  LevelSelect,
  TextField,
  useForm,
} from "@/components/admin/pickers"
import { DatePicker } from "@/components/DatePicker"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { api, unwrap } from "@/lib/api"

export type CourseFields = Pick<
  CourseSummary,
  "id" | "courseCode" | "section" | "term" | "startDate" | "endDate" | "levelId"
>

function DatesChangedAlert() {
  return (
    <Alert>
      <AlertTitle>
        Enrolled students' grants will follow the new dates
      </AlertTitle>
      <AlertDescription>
        Every course grant of this offering moves to the new start and end dates
        when you save.
      </AlertDescription>
    </Alert>
  )
}

/** Create a course offering, or edit one. Changing dates moves every enrolled student's course grant (BR-002-03). */
export function CourseDialog({
  initial,
  onClose,
}: {
  initial?: CourseFields
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, set] = useForm(courseFormValues(initial))
  const datesChanged = courseDatesChanged(v, initial)
  const invalidRange = courseRangeInvalid(v)

  const save = useMutation({
    mutationFn: () => {
      const json = coursePayload(v)
      return initial
        ? unwrap(
            api.levels.courses[":id"].$patch({
              param: { id: initial.id },
              json,
            })
          )
        : unwrap(api.levels.courses.$post({ json }))
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["courses"] })
      qc.invalidateQueries({ queryKey: ["levels"] })
      if (initial)
        toastSaved(
          "Course saved.",
          "flaggedEvents" in res ? res.flaggedEvents : undefined
        )
      else toast.success("Course created.")
      onClose()
    },
  })

  return (
    <FormDialog
      title={initial ? "Edit course" : "New course"}
      description="A course grants its level to enrolled students for the course dates."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitDisabled={courseSubmitDisabled(v)}
    >
      {datesChanged && <DatesChangedAlert />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="course-code"
          label="Course code"
          value={v.courseCode}
          onChange={(x) => set("courseCode", x)}
          required
        />
        <TextField
          id="course-section"
          label="Section"
          value={v.section}
          onChange={(x) => set("section", x)}
        />
        <TextField
          id="course-term"
          label="Term"
          value={v.term}
          onChange={(x) => set("term", x)}
          required
          placeholder="Fall 2027"
        />
        <LabeledField label="Level granted" htmlFor="course-level">
          <LevelSelect
            id="course-level"
            value={v.levelId}
            onValueChange={(x) => set("levelId", x)}
          />
        </LabeledField>
        <LabeledField label="Start date" htmlFor="course-start">
          <DatePicker
            id="course-start"
            value={v.startDate}
            onChange={(x) => set("startDate", x)}
          />
        </LabeledField>
        <LabeledField
          label="End date"
          htmlFor="course-end"
          error={
            invalidRange
              ? "The end date must be on or after the start date."
              : undefined
          }
        >
          <DatePicker
            id="course-end"
            value={v.endDate}
            min={v.startDate || undefined}
            onChange={(x) => set("endDate", x)}
            invalid={invalidRange}
          />
        </LabeledField>
      </div>
    </FormDialog>
  )
}
