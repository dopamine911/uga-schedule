import { ROLES } from "@studio/domain"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRoundIcon, PlusIcon, ShieldIcon, UserIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import {
  EmptyState,
  ErrorAlert,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import {
  LabeledField,
  SimpleSelect,
  SwitchField,
  type UserRecord,
  useForm,
  useStudios,
  NONE,
} from "@/components/admin/pickers"
import {
  ConfirmButton,
  FormDialog,
  RequirePerm,
  StatusBadge,
} from "@/components/admin/shared"
import { Badge } from "@/components/ui/badge"
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
import { useTz } from "@/lib/auth"
import { fmtDay, fmtInstant, humanize } from "@/lib/format"

const STUDIO_ROLE = "STUDIO_STAFF"

export function UserDetailPage() {
  return (
    <RequirePerm perm="role.assign" title="User">
      <UserDetailView />
    </RequirePerm>
  )
}

function UserDetailView() {
  const { id = "" } = useParams()
  const query = useQuery({
    queryKey: ["users", "detail", id],
    queryFn: () => unwrap(api.users[":id"].$get({ param: { id } })),
  })
  return (
    <QueryView query={query}>{(user) => <UserContent user={user} />}</QueryView>
  )
}

function UserContent({ user }: { user: UserRecord }) {
  const qc = useQueryClient()
  const tz = useTz()
  const [adding, setAdding] = useState(false)

  const toggle = useMutation({
    mutationFn: (active: boolean) =>
      unwrap(
        api.users[":id"].$patch({
          param: { id: user.id },
          json: { status: active ? "active" : "disabled" },
        })
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["users"] })
      toast.success(
        res.status === "active" ? "Account enabled." : "Account disabled."
      )
    },
    onError: (err) =>
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not change the account status."
      ),
  })

  const removeRole = useMutation({
    mutationFn: (assignmentId: string) =>
      unwrap(
        api.users[":id"].roles[":assignmentId"].$delete({
          param: { id: user.id, assignmentId },
        })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] })
      toast.success("Role removed.")
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not remove the role."
      ),
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={user.displayName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link
              to="/admin/users"
              className="underline-offset-4 hover:underline"
            >
              Users & roles
            </Link>
            <span aria-hidden>/</span>
            <span>{user.email}</span>
            <StatusBadge status={user.status} />
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>
              <IconTitle icon={UserIcon}>Profile</IconTitle>
            </CardTitle>
            <CardDescription>Account details from sign-in.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="flex flex-col gap-3">
              <Detail label="Name" value={user.displayName} />
              <Detail label="Email" value={user.email} />
              <Detail label="Affiliation" value={user.affiliation || "—"} />
              <Detail label="Joined" value={fmtInstant(user.createdAt, tz)} />
              <Detail label="Active holds" value={user.activeHoldCount} />
            </dl>
            <SwitchField
              id="user-active"
              label="Account active"
              description="Disabled accounts can't sign in. The last active Admin can't be disabled."
              checked={user.status === "active"}
              onCheckedChange={(v) => toggle.mutate(v)}
              disabled={toggle.isPending}
            />
            {toggle.error && <ErrorAlert error={toggle.error} />}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>
                <IconTitle icon={ShieldIcon}>Roles</IconTitle>
              </CardTitle>
              <CardDescription>
                Roles decide what this person can see and do.
              </CardDescription>
            </div>
            <Button onClick={() => setAdding(true)}>
              <PlusIcon data-icon="inline-start" />
              Add role
            </Button>
          </CardHeader>
          <CardContent>
            {user.roles.length === 0 ? (
              <EmptyState
                icon={ShieldIcon}
                title="No roles"
                description="This account can only sign in with no permissions."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Studio</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {user.roles.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {humanize(r.role)}
                      </TableCell>
                      <TableCell>{r.studioName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {r.source === "auto" ? "Automatic" : "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <ConfirmButton
                          label="Remove"
                          title={`Remove ${humanize(r.role)}?`}
                          description="The person loses this role's permissions immediately."
                          confirmLabel="Remove role"
                          onConfirm={() => removeRole.mutate(r.id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>
              <IconTitle icon={KeyRoundIcon}>Level grants</IconTitle>
            </CardTitle>
            <CardDescription>
              Read-only here. Grant or revoke levels from Levels & courses.
            </CardDescription>
          </div>
          <Button variant="outline" asChild>
            <Link to="/admin/levels">Manage in Levels & courses</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {user.grants.length === 0 ? (
            <EmptyState icon={KeyRoundIcon} title="No level grants" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Level</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Valid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.grants.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.levelName}</TableCell>
                    <TableCell>
                      {g.source === "course"
                        ? (g.courseCode ?? "Course")
                        : "Manual"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {fmtDay(g.validFrom)} –{" "}
                      {g.validUntil ? fmtDay(g.validUntil) : "Open-ended"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={g.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {adding && (
        <AddRoleDialog userId={user.id} onClose={() => setAdding(false)} />
      )}
    </div>
  )
}

function AddRoleDialog({
  userId,
  onClose,
}: {
  userId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const studios = useStudios()
  const [v, set] = useForm({ role: "", studioId: NONE })
  const isStudio = v.role === STUDIO_ROLE
  const studioId = isStudio && v.studioId !== NONE ? v.studioId : null
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.users[":id"].roles.$post({
          param: { id: userId },
          json: { role: v.role as (typeof ROLES)[number], studioId },
        })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] })
      toast.success("Role added.")
      onClose()
    },
  })
  return (
    <FormDialog
      title="Add role"
      description="Studio Staff roles apply to one studio. Other roles apply everywhere."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Add role"
      submitDisabled={!v.role || (isStudio && !studioId)}
    >
      <LabeledField label="Role" htmlFor="role-select">
        <SimpleSelect
          id="role-select"
          value={v.role}
          onValueChange={(x) => set("role", x)}
          options={ROLES.map((r) => ({ value: r, label: humanize(r) }))}
          placeholder="Choose a role"
        />
      </LabeledField>
      {isStudio && (
        <LabeledField label="Studio" htmlFor="role-studio">
          <SimpleSelect
            id="role-studio"
            value={v.studioId}
            onValueChange={(x) => set("studioId", x)}
            options={(studios.data ?? []).map((s) => ({
              value: s.id,
              label: s.name,
            }))}
            placeholder={
              studios.isPending ? "Loading studios…" : "Choose a studio"
            }
          />
        </LabeledField>
      )}
    </FormDialog>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
