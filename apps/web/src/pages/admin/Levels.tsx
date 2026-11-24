import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  GraduationCapIcon,
  KeyRoundIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  UserSearchIcon,
} from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"
import {
  EmptyState,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import { CourseDialog } from "@/components/admin/CourseDialog"
import {
  type CourseSummary,
  type GrantUser,
  type LevelRow,
  LabeledField,
  LevelSelect,
  TextAreaField,
  TextField,
  SwitchField,
  useLevels,
  useForm,
} from "@/components/admin/pickers"
import { DatePicker } from "@/components/DatePicker"
import {
  FormDialog,
  RequirePerm,
  StatusBadge,
  UserSearch,
  type PickedUser,
  intOrUndefined,
  toastSaved,
} from "@/components/admin/shared"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, unwrap } from "@/lib/api"
import { useCan } from "@/lib/auth"
import { fmtDay } from "@/lib/format"

type GrantRow = GrantUser["grants"][number]

export function LevelsPage() {
  return (
    <RequirePerm perm="level.manage" title="Levels & courses">
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Levels & courses"
          description="Access levels, the courses that grant them, and manual grants to individuals (F-002)."
        />
        <Tabs defaultValue="levels">
          <TabsList>
            <TabsTrigger value="levels">Levels</TabsTrigger>
            <TabsTrigger value="courses">Courses</TabsTrigger>
            <TabsTrigger value="grants">Grants</TabsTrigger>
          </TabsList>
          <TabsContent value="levels" className="pt-4">
            <LevelsTab />
          </TabsContent>
          <TabsContent value="courses" className="pt-4">
            <CoursesTab />
          </TabsContent>
          <TabsContent value="grants" className="pt-4">
            <GrantsTab />
          </TabsContent>
        </Tabs>
      </div>
    </RequirePerm>
  )
}

function LevelsTab() {
  const can = useCan()
  const levels = useLevels()
  const [editing, setEditing] = useState<LevelRow | "new" | null>(null)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        {can("level.manage") && (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon data-icon="inline-start" />
            New level
          </Button>
        )}
      </div>
      <QueryView query={levels}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              icon={LayersIcon}
              title="No levels"
              description="Create the first access level."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Rank</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="tabular-nums">{l.rank}</TableCell>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.description || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={l.active ? "active" : "inactive"}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {can("level.manage") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${l.name}`}
                            onClick={() => setEditing(l)}
                          >
                            <PencilIcon data-icon="inline-start" />
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryView>
      {editing !== null && (
        <LevelDialog
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function LevelDialog({
  initial,
  onClose,
}: {
  initial?: LevelRow
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, set] = useForm({
    name: initial?.name ?? "",
    rank: initial ? String(initial.rank) : "",
    description: initial?.description ?? "",
    active: initial?.active ?? true,
  })
  const rank = intOrUndefined(v.rank)
  const save = useMutation({
    mutationFn: () => {
      const base = {
        name: v.name.trim(),
        rank: rank ?? 0,
        description: v.description.trim(),
      }
      return initial
        ? unwrap(
            api.levels[":id"].$patch({
              param: { id: initial.id },
              json: { ...base, active: v.active },
            })
          )
        : unwrap(api.levels.$post({ json: base }))
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["levels"] })
      qc.invalidateQueries({ queryKey: ["equipment"] })
      if (initial)
        toastSaved(
          "Level saved.",
          "flaggedEvents" in res ? res.flaggedEvents : undefined
        )
      else toast.success("Level created.")
      onClose()
    },
  })
  return (
    <FormDialog
      title={initial ? "Edit level" : "New level"}
      description="Rank orders levels: a higher rank includes everything below it. Changing a rank re-checks open events."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitDisabled={!v.name.trim() || !rank || rank < 1}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="level-name"
          label="Name"
          value={v.name}
          onChange={(x) => set("name", x)}
          required
        />
        <TextField
          id="level-rank"
          label="Rank"
          type="number"
          value={v.rank}
          onChange={(x) => set("rank", x)}
          required
        />
      </div>
      <TextAreaField
        id="level-description"
        label="Description"
        value={v.description}
        onChange={(x) => set("description", x)}
      />
      {initial && (
        <SwitchField
          id="level-active"
          label="Active"
          description="Inactive levels can't be granted. Deactivating is refused while grants, equipment classes or studios still use the level."
          checked={v.active}
          onCheckedChange={(x) => set("active", x)}
        />
      )}
    </FormDialog>
  )
}

function CoursesTab() {
  const can = useCan()
  const [creating, setCreating] = useState(false)
  const courses = useQuery({
    queryKey: ["courses"],
    queryFn: () => unwrap(api.levels.courses.$get()),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        {can("course.manage") && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            New course
          </Button>
        )}
      </div>
      <QueryView query={courses}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              icon={GraduationCapIcon}
              title="No courses"
              description="Courses grant a level to enrolled students for their dates."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead className="text-right">Enrolled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c: CourseSummary) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        <Link
                          to={`/admin/courses/${c.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {c.courseCode}
                        </Link>
                      </TableCell>
                      <TableCell>{c.section || "—"}</TableCell>
                      <TableCell>{c.term}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fmtDay(c.startDate)} – {fmtDay(c.endDate)}
                      </TableCell>
                      <TableCell>{c.level.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.enrolledCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryView>
      {creating && <CourseDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function GrantsTab() {
  const can = useCan()
  const [picked, setPicked] = useState<PickedUser | null>(null)
  const [granting, setGranting] = useState(false)
  const [revoking, setRevoking] = useState<GrantRow | null>(null)
  const grants = useQuery({
    queryKey: ["levels", "grants", picked?.id],
    queryFn: () =>
      unwrap(api.levels.grants.$get({ query: { userId: picked?.id } })),
    enabled: !!picked,
  })
  const rows: GrantRow[] =
    (grants.data ?? []).find((u: GrantUser) => u.id === picked?.id)?.grants ??
    []

  if (!picked)
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={UserSearchIcon}>Find a person</IconTitle>
          </CardTitle>
          <CardDescription>
            Search for someone to see or change their level grants.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserSearch onPick={setPicked} />
        </CardContent>
      </Card>
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{picked.displayName}</h2>
          <Button
            variant="link"
            className="h-auto justify-start p-0"
            onClick={() => setPicked(null)}
          >
            Choose someone else
          </Button>
        </div>
        {can("grant.manage") && (
          <Button onClick={() => setGranting(true)}>
            <PlusIcon data-icon="inline-start" />
            Grant level
          </Button>
        )}
      </div>
      <QueryView query={grants}>
        {() =>
          rows.length === 0 ? (
            <EmptyState
              icon={KeyRoundIcon}
              title="No grants"
              description="This person holds no level grants."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Level</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Valid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((g) => (
                    <GrantRowView
                      key={g.id}
                      grant={g}
                      canRevoke={can("grant.manage") && !g.revokedOn}
                      onRevoke={() => setRevoking(g)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryView>
      {granting && (
        <GrantDialog userId={picked.id} onClose={() => setGranting(false)} />
      )}
      {revoking && (
        <RevokeDialog grant={revoking} onClose={() => setRevoking(null)} />
      )}
    </div>
  )
}

function GrantRowView({
  grant,
  canRevoke,
  onRevoke,
}: {
  grant: GrantRow
  canRevoke: boolean
  onRevoke: () => void
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {grant.levelName}
        <span className="ml-1 text-xs text-muted-foreground">
          (rank {grant.levelRank})
        </span>
      </TableCell>
      <TableCell>
        {grant.source === "course" ? (grant.courseCode ?? "Course") : "Manual"}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {fmtDay(grant.validFrom)} –{" "}
        {grant.validUntil ? fmtDay(grant.validUntil) : "Open-ended"}
      </TableCell>
      <TableCell>
        <StatusBadge status={grant.status} />
      </TableCell>
      <TableCell className="max-w-64">
        <div className="truncate" title={grant.reason}>
          {grant.reason || "—"}
        </div>
        {grant.revokeReason && (
          <div className="truncate text-xs text-muted-foreground">
            Revoked: {grant.revokeReason}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        {canRevoke && (
          <Button size="sm" variant="outline" onClick={onRevoke}>
            Revoke
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

function todayLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function GrantDialog({
  userId,
  onClose,
}: {
  userId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, set] = useForm({
    levelId: "",
    validFrom: todayLocal(),
    validUntil: "",
    reason: "",
  })
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.levels.grants.$post({
          json: {
            userId,
            levelId: v.levelId,
            validFrom: v.validFrom,
            validUntil: v.validUntil || null,
            reason: v.reason.trim(),
          },
        })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levels"] })
      toast.success("Level granted.")
      onClose()
    },
  })
  const invalidRange = !!v.validUntil && v.validUntil < v.validFrom
  return (
    <FormDialog
      title="Grant level"
      description="Open-ended grants stay until revoked. Set an end date to have the grant expire on its own."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Grant level"
      submitDisabled={
        !v.levelId || !v.reason.trim() || !v.validFrom || invalidRange
      }
    >
      <LabeledField label="Level" htmlFor="grant-level">
        <LevelSelect
          id="grant-level"
          value={v.levelId}
          onValueChange={(x) => set("levelId", x)}
        />
      </LabeledField>
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledField label="Valid from" htmlFor="grant-from">
          <DatePicker
            id="grant-from"
            value={v.validFrom}
            onChange={(x) => set("validFrom", x)}
          />
        </LabeledField>
        <LabeledField
          label="Valid until"
          htmlFor="grant-until"
          description="Leave empty for open-ended."
          error={
            invalidRange ? "Must be on or after the start date." : undefined
          }
        >
          <DatePicker
            id="grant-until"
            value={v.validUntil}
            min={v.validFrom || undefined}
            onChange={(x) => set("validUntil", x)}
            clearable
            invalid={invalidRange}
          />
        </LabeledField>
      </div>
      <TextAreaField
        id="grant-reason"
        label="Reason"
        value={v.reason}
        onChange={(x) => set("reason", x)}
        description="Required. Recorded in the audit log."
      />
    </FormDialog>
  )
}

function RevokeDialog({
  grant,
  onClose,
}: {
  grant: GrantRow
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.levels.grants[":id"].revoke.$post({
          param: { id: grant.id },
          json: { reason: reason.trim() },
        })
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["levels"] })
      toastSaved(`${grant.levelName} grant revoked.`, res.flaggedEvents)
      onClose()
    },
  })
  return (
    <FormDialog
      title="Revoke grant"
      description={`Revokes ${grant.levelName} from today. Open events that rely on it are flagged for review.`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Revoke"
      submitDisabled={!reason.trim()}
    >
      <TextAreaField
        id="revoke-reason"
        label="Reason"
        value={reason}
        onChange={setReason}
      />
    </FormDialog>
  )
}
