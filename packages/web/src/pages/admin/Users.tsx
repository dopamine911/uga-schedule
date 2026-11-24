import {
  PERMISSIONS,
  ROLES,
  type RoleCode,
  rolePermissions,
} from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import {
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  SearchIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"
import { createElement, useDeferredValue, useState } from "react"
import { Link } from "react-router"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { RequirePerm, StatusBadge } from "@/components/admin/shared"
import { NewUserDialog } from "@/components/admin/UserDialogs"
import { RoleBadge } from "@/components/admin/RoleBadge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, unwrap } from "@/lib/api"
import { initials } from "@/lib/format"
import { PERMISSION_LABELS, ROLE_INFO, SCOPE_LABELS } from "@/lib/roles"

type UserRow = InferResponseType<typeof api.users.$get, 200>[number]

export function UsersPage() {
  return (
    <RequirePerm perm="role.assign" title="Users & roles">
      <UsersContent />
    </RequirePerm>
  )
}

function UsersContent() {
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState("people")
  const [roleFilter, setRoleFilter] = useState<RoleCode | "">("")
  // The full directory (no server filter) feeds both the role counts and client-side search.
  const all = useQuery({
    queryKey: ["users", "list", ""],
    queryFn: () => unwrap(api.users.$get({ query: {} })),
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users & roles"
        description="Add people, decide what they can do, and disable accounts that should no longer sign in."
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlusIcon data-icon="inline-start" />
            Add user
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="people" className="pt-4">
          <QueryView query={all}>
            {(rows) => (
              <PeopleTab
                rows={rows}
                roleFilter={roleFilter}
                setRoleFilter={setRoleFilter}
              />
            )}
          </QueryView>
        </TabsContent>
        <TabsContent value="roles" className="pt-4">
          <QueryView query={all}>
            {(rows) => (
              <RolesTab
                rows={rows}
                onShowMembers={(r) => {
                  setRoleFilter(r)
                  setTab("people")
                }}
              />
            )}
          </QueryView>
        </TabsContent>
      </Tabs>
      {creating && <NewUserDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function PeopleTab({
  rows,
  roleFilter,
  setRoleFilter,
}: {
  rows: UserRow[]
  roleFilter: RoleCode | ""
  setRoleFilter: (r: RoleCode | "") => void
}) {
  const [q, setQ] = useState("")
  const query = useDeferredValue(q.trim().toLowerCase())
  const shown = rows.filter(
    (u) =>
      (!roleFilter || u.roles.some((r) => r.role === roleFilter)) &&
      (!query || `${u.displayName} ${u.email}`.toLowerCase().includes(query))
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search users"
            placeholder="Search name or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </InputGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Filter by role"
          value={roleFilter || "all"}
          onValueChange={(v) =>
            setRoleFilter(v && v !== "all" ? (v as RoleCode) : "")
          }
          className="flex-wrap"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          {ROLES.map((r) => (
            <ToggleGroupItem key={r} value={r}>
              {ROLE_INFO[r].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No users found"
          description="Try a different search or role."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Sign-in</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link
                      to={`/admin/users/${u.id}`}
                      className="group flex items-center gap-3"
                    >
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-secondary text-xs font-bold text-secondary-foreground">
                          {initials(u.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex flex-col">
                        <span className="font-bold underline-offset-4 group-hover:underline">
                          {u.displayName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {u.email} · {u.affiliation}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 && (
                        <span className="text-sm text-muted-foreground">
                          No roles
                        </span>
                      )}
                      {u.roles.map((r) => (
                        <RoleBadge
                          key={r.id}
                          role={r.role}
                          studioName={r.studioName}
                        />
                      ))}
                      {u.deniedCount > 0 && (
                        <Badge variant="destructive">
                          <BanIcon data-icon="inline-start" />
                          {u.deniedCount} permission
                          {u.deniedCount === 1 ? "" : "s"} removed
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.linked ? (
                      <Badge variant="success">
                        <CircleCheckIcon data-icon="inline-start" />
                        Linked
                      </Badge>
                    ) : (
                      <Badge variant="info">
                        <CircleDashedIcon data-icon="inline-start" />
                        Invited
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {shown.length} of {rows.length} people. “Invited” accounts were added
        here and link to university sign-in on first login.
      </p>
    </div>
  )
}

/** One card per role: what it is for, who holds it, and exactly what it allows (F-001 §3). */
function RolesTab({
  rows,
  onShowMembers,
}: {
  rows: UserRow[]
  onShowMembers: (r: RoleCode) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Permissions per role are fixed by policy (spec F-001). To change what
        someone can do, add or remove roles on their profile. Studio staff is
        assigned per studio.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {ROLES.map((role) => {
          const info = ROLE_INFO[role]
          const members = rows.filter(
            (u) => u.status === "active" && u.roles.some((r) => r.role === role)
          )
          const perms = rolePermissions(role)
          const allowed = PERMISSIONS.filter((p) => perms[p])
          return (
            <Card
              key={role}
              className={
                role === "ADMIN" ? "border-t-4 border-t-primary" : undefined
              }
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-md bg-accent text-primary [&_svg]:size-5">
                    {createElement(info.icon, { "aria-hidden": true })}
                  </span>
                  <span className="flex-1">{info.label}</span>
                  <Badge variant="secondary">
                    {members.length}{" "}
                    {members.length === 1 ? "person" : "people"}
                  </Badge>
                </CardTitle>
                <CardDescription>{info.summary}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-1.5">
                  {allowed.map((p) => (
                    <Badge key={p} variant="outline" className="font-normal">
                      {PERMISSION_LABELS[p]}
                      {perms[p] !== "all" && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {SCOPE_LABELS[perms[p]!]}
                        </span>
                      )}
                    </Badge>
                  ))}
                </div>
              </CardContent>
              <CardFooter className="flex items-center justify-between gap-3">
                <div className="flex items-center [&>*:not(:first-child)]:-ml-2">
                  {members.slice(0, 6).map((m) => (
                    <Avatar key={m.id} className="size-8 ring-2 ring-card">
                      <AvatarFallback className="bg-secondary text-[0.625rem] font-bold text-secondary-foreground">
                        {initials(m.displayName)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {members.length > 6 && (
                    <span className="pl-3 text-xs text-muted-foreground">
                      +{members.length - 6}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onShowMembers(role)}
                >
                  <UsersIcon data-icon="inline-start" />
                  Show people
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
