import type { CourseFields } from "@/components/admin/CourseDialog"

// Pure form logic of the course dialog: initial values, derived flags and the request body.

export interface CourseFormValues {
  courseCode: string
  section: string
  term: string
  startDate: string
  endDate: string
  levelId: string
}

const EMPTY_COURSE: CourseFormValues = {
  courseCode: "",
  section: "",
  term: "",
  startDate: "",
  endDate: "",
  levelId: "",
}

/** Form values for a new course, or for the course being edited. */
export function courseFormValues(initial?: CourseFields): CourseFormValues {
  if (!initial) return EMPTY_COURSE
  return {
    courseCode: initial.courseCode,
    section: initial.section,
    term: initial.term,
    startDate: initial.startDate,
    endDate: initial.endDate,
    levelId: initial.levelId,
  }
}

/** True when an existing course's dates were edited: saving moves every course grant (BR-002-03). */
export function courseDatesChanged(
  v: CourseFormValues,
  initial?: CourseFields
): boolean {
  return (
    !!initial &&
    (v.startDate !== initial.startDate || v.endDate !== initial.endDate)
  )
}

/** True when both dates are set and the end date is before the start date. */
export function courseRangeInvalid(v: CourseFormValues): boolean {
  return !!v.startDate && !!v.endDate && v.endDate < v.startDate
}

export function courseSubmitDisabled(v: CourseFormValues): boolean {
  return (
    !v.courseCode.trim() ||
    !v.term.trim() ||
    !v.startDate ||
    !v.endDate ||
    !v.levelId ||
    courseRangeInvalid(v)
  )
}

/** Request body for both create and edit. */
export function coursePayload(v: CourseFormValues) {
  return {
    courseCode: v.courseCode.trim(),
    section: v.section.trim(),
    term: v.term.trim(),
    startDate: v.startDate,
    endDate: v.endDate,
    levelId: v.levelId,
  }
}
