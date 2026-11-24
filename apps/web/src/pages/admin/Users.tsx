import { useQuery } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import { Link } from "react-router"
import { UsersIcon } from "lucide-react"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { RequirePerm, StatusBadge } from "@/components/admin/shared"
import { TextField } from "@/components/admin/pickers"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, unwrap } from "@/lib/api"
import { humanize } from "@/lib/format"

export function UsersPage() {
  return (
    <RequirePerm perm="role.assign" title="Users & roles">
      <UsersContent />
    </RequirePerm>
  )
}

function UsersContent() {
  const [q, setQ] = useState("")
  const deferred = useDeferredValue(q.trim())
  const users = useQuery({
    queryKey: ["users", "list", deferred],
    queryFn: () =>
      unwrap(api.users.$get({ query: deferred ? { q: deferred } : {} })),
  })
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users & roles"
        description="Everyone with an account, their roles, and whether they can sign in."
      />
      <div className="max-w-md">
        <TextField
          id="user-search"
          label="Search"
          placeholder="Name or email"
          value={q}
          onChange={setQ}
        />
      </div>
      <QueryView query={users}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No users found"
              description={
                deferred ? "Try a different name or email." : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        <Link
                          to={`/admin/users/${u.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {u.displayName}
                        </Link>
                        {u.affiliation && (
                          <div className="text-xs text-muted-foreground">
                            {u.affiliation}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.email}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.roles.length === 0 && (
                            <span className="text-sm text-muted-foreground">
                              None
                            </span>
                          )}
                          {u.roles.map((r) => (
                            <Badge key={r.id} variant="secondary">
                              {humanize(r.role)}
                              {r.studioName ? `: ${r.studioName}` : ""}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={u.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryView>
    </div>
  )
}
