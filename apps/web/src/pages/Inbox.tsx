import {
  BellIcon,
  BellOffIcon,
  CalendarDaysIcon,
  CheckCheckIcon,
  FileTextIcon,
  GraduationCapIcon,
  HandIcon,
  type LucideIcon,
  ListTodoIcon,
  PackageIcon,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router"
import { toast } from "sonner"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtInstant } from "@/lib/format"

// F-010 in-app inbox (BR-010-01): every notification is a row, newest first.

export function InboxPage() {
  const tz = useTz()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap(api.notifications.$get()),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] })

  const readOne = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.notifications[":id"].read.$post({ param: { id } })),
    onSuccess: refresh,
  })
  const readAll = useMutation({
    mutationFn: () => unwrap(api.notifications["read-all"].$post()),
    onSuccess: async () => {
      await refresh()
      toast.success("All notifications marked as read")
    },
    onError: (err) =>
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not mark notifications as read."
      ),
  })

  const unreadCount = query.data?.filter((n) => n.readAt === null).length ?? 0

  return (
    <>
      <PageHeader
        title="Inbox"
        description={
          unreadCount ? `${unreadCount} unread` : "You're up to date."
        }
        actions={
          <Button
            variant="outline"
            disabled={unreadCount === 0 || readAll.isPending}
            onClick={() => readAll.mutate()}
          >
            <CheckCheckIcon data-icon="inline-start" />
            Mark all read
          </Button>
        }
      />
      <QueryView query={query} rows={4}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              icon={BellOffIcon}
              title="No notifications"
              description="Updates about your requests appear here."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((n) => {
                const unread = n.readAt === null
                return (
                  <li key={n.id}>
                    <Card
                      size="sm"
                      className={unread ? "border-primary/50" : undefined}
                    >
                      <CardHeader>
                        <CardTitle className="flex flex-wrap items-center gap-2">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                            <NotificationIcon
                              code={n.code}
                              className="size-4"
                            />
                          </span>
                          {n.subject}
                          {unread && <Badge>New</Badge>}
                        </CardTitle>
                        <CardDescription>
                          {fmtInstant(n.createdAt, tz)}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {n.eventId && (
                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                              onClick={() => unread && readOne.mutate(n.id)}
                            >
                              <Link to={`/events/${n.eventId}`}>
                                Open request
                              </Link>
                            </Button>
                          )}
                          {unread && !n.eventId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => readOne.mutate(n.id)}
                            >
                              Mark read
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )
        }
      </QueryView>
    </>
  )
}

// Icon by notification code prefix.
const CODE_ICONS: [RegExp, LucideIcon][] = [
  [/^EVENT_/, CalendarDaysIcon],
  [/^HOLD_/, HandIcon],
  [/^(RETURN|CHECKOUT)_/, PackageIcon],
  [/^RESULTS_/, FileTextIcon],
  [/^(TASK|STAGE)_/, ListTodoIcon],
  [/^GRANT_/, GraduationCapIcon],
]

function NotificationIcon({
  code,
  className,
}: {
  code: string
  className: string
}) {
  const Icon = CODE_ICONS.find(([re]) => re.test(code))?.[1] ?? BellIcon
  return <Icon aria-hidden="true" className={className} />
}
