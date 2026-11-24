import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, UploadIcon, UserPlusIcon, UsersIcon } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import {
  EmptyState,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import { CourseDialog } from "@/components/admin/CourseDialog"
import {
  type CourseDetail,
  TextAreaField,
  useForm,
} from "@/components/admin/pickers"
import {
  ConfirmButton,
  FormDialog,
  RequirePerm,
  StatusBadge,
  type PickedUser,
  UserSearch,
  toastSaved,
} from "@/components/admin/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, unwrap } from "@/lib/api"
import { useCan } from "@/lib/auth"
import { fmtDay } from "@/lib/format"

type Enrollment = CourseDetail["enrollments"][number]

export function CoursePage() {
  return (
    <RequirePerm perm="course.manage" title="Course">
      <CourseDetailView />
    </RequirePerm>
  )
}

function CourseDetailView() {
  const { id = "" } = useParams()
  const query = useQuery({
    queryKey: ["courses", id],
    queryFn: () => unwrap(api.levels.courses[":id"].$get({ param: { id } })),
  })
  return (
    <QueryView query={query}>
      {(course) => <CourseContent course={course} />}
    </QueryView>
  )
}

function CourseContent({ course }: { course: CourseDetail }) {
  const qc = useQueryClient()
  const can = useCan()
  const manage = can("course.manage")
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  const enrolled = course.enrollments.filter((e) => e.status === "enrolled")

  const drop = useMutation({
    mutationFn: (enrollmentId: string) =>
      unwrap(
        api.levels.courses[":id"].enrollments[":enrollmentId"].drop.$post({
          param: { id: course.id, enrollmentId },
        })
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["courses"] })
      toastSaved("Student dropped from the course.", res.flaggedEvents)
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${course.courseCode}${course.section ? ` · Section ${course.section}` : ""}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link
              to="/admin/levels"
              className="underline-offset-4 hover:underline"
            >
              Levels & courses
            </Link>
            <span aria-hidden>/</span>
            <span>{course.term}</span>
            <span>
              {fmtDay(course.startDate)} – {fmtDay(course.endDate)}
            </span>
            <span className="text-muted-foreground">
              Grants {course.level.name}
            </span>
          </span>
        }
        actions={
          manage && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon data-icon="inline-start" />
              Edit course
            </Button>
          )
        }
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>
              <IconTitle icon={UsersIcon}>Enrollments</IconTitle>
            </CardTitle>
            <CardDescription>
              {enrolled.length} enrolled. Enrolling grants {course.level.name}{" "}
              for the course dates; dropping revokes it from today.
            </CardDescription>
          </div>
          {manage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setImporting(true)}>
                <UploadIcon data-icon="inline-start" />
                Import roster
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {manage && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>
                  <IconTitle icon={UserPlusIcon}>Add students</IconTitle>
                </CardTitle>
                <CardDescription>
                  Search for active users and add them to this course.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {adding ? (
                  <AddStudent
                    courseId={course.id}
                    enrolledIds={enrolled.map((e) => e.user.id)}
                    onDone={() => setAdding(false)}
                  />
                ) : (
                  <Button variant="outline" onClick={() => setAdding(true)}>
                    <UserPlusIcon data-icon="inline-start" />
                    Add students
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {course.enrollments.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No students yet"
              description="Add students or import a roster to enroll them."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Dropped on</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {course.enrollments.map((e) => (
                    <EnrollmentRow
                      key={e.id}
                      enrollment={e}
                      canDrop={manage && e.status === "enrolled"}
                      onDrop={() => drop.mutate(e.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <CourseDialog initial={course} onClose={() => setEditing(false)} />
      )}
      {importing && (
        <RosterDialog
          courseId={course.id}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  )
}

function EnrollmentRow({
  enrollment,
  canDrop,
  onDrop,
}: {
  enrollment: Enrollment
  canDrop: boolean
  onDrop: () => void
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {enrollment.user.displayName}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {enrollment.user.email}
      </TableCell>
      <TableCell>
        <StatusBadge status={enrollment.status} />
      </TableCell>
      <TableCell>
        {enrollment.droppedOn ? fmtDay(enrollment.droppedOn) : "—"}
      </TableCell>
      <TableCell className="text-right">
        {canDrop && (
          <ConfirmButton
            label="Drop"
            title={`Drop ${enrollment.user.displayName}?`}
            description="Their course grant is revoked from today. Open events that rely on it are flagged for review."
            confirmLabel="Drop student"
            onConfirm={onDrop}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

function AddStudent({
  courseId,
  enrolledIds,
  onDone,
}: {
  courseId: string
  enrolledIds: readonly string[]
  onDone: () => void
}) {
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: (user: PickedUser) =>
      unwrap(
        api.levels.courses[":id"].enrollments.$post({
          param: { id: courseId },
          json: { userIds: [user.id] },
        })
      ),
    onSuccess: (res, user) => {
      qc.invalidateQueries({ queryKey: ["courses"] })
      if (res.added > 0) toast.success(`${user.displayName} enrolled.`)
      else toast(`${user.displayName} is already enrolled.`)
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not add the student."
      ),
  })
  return (
    <div className="flex flex-col gap-3">
      <UserSearch
        onPick={(u) => add.mutate(u)}
        excludeIds={enrolledIds}
        placeholder="Search students by name or email…"
      />
      <div>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

function RosterDialog({
  courseId,
  onClose,
}: {
  courseId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, set] = useForm({ emails: "" })
  const [result, setResult] = useState<{
    added: number
    dropped: number
    unchanged: number
    unmatched: string[]
    flaggedEvents: number
  } | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const emails = v.emails
        .split(/[\n,]/)
        .map((e) => e.trim())
        .filter(Boolean)
      return unwrap(
        api.levels.courses[":id"].roster.$post({
          param: { id: courseId },
          json: { emails },
        })
      )
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["courses"] })
      setResult(res)
    },
  })

  if (result)
    return (
      <FormDialog
        title="Roster imported"
        onClose={onClose}
        onSubmit={onClose}
        submitLabel="Done"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Added" value={result.added} />
          <Stat label="Dropped" value={result.dropped} />
          <Stat label="Unchanged" value={result.unchanged} />
          <Stat label="Unmatched" value={result.unmatched.length} />
        </div>
        {result.unmatched.length > 0 && (
          <Alert>
            <AlertTitle>No active account for these emails</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {result.unmatched.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {result.flaggedEvents > 0 && (
          <Alert>
            <AlertTitle>Events flagged for review</AlertTitle>
            <AlertDescription>
              {result.flaggedEvents} open event
              {result.flaggedEvents === 1 ? "" : "s"} relied on dropped grants.
            </AlertDescription>
          </Alert>
        )}
      </FormDialog>
    )

  return (
    <FormDialog
      title="Import roster"
      description="The roster replaces current enrollments: listed students are enrolled, enrolled students not listed are dropped."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Import roster"
      submitDisabled={!v.emails.trim()}
    >
      <TextAreaField
        id="roster-emails"
        label="Emails"
        value={v.emails}
        onChange={(x) => set("emails", x)}
        rows={8}
        placeholder={
          "one@university.edu\ntwo@university.edu, three@university.edu"
        }
        description="One per line or comma separated. Emails that don't match an active account are reported back."
      />
    </FormDialog>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}
