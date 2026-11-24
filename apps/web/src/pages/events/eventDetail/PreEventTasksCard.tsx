import type { StageStatus } from "@studio/domain"
import { useMutation } from "@tanstack/react-query"
import { ListTodoIcon } from "lucide-react"
import { toast } from "sonner"
import { IconTitle } from "@/components/common"
import {
  type EventDetail,
  TextActionDialog,
  useInvalidateEvent,
} from "@/components/events/shared"
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
import { fmtInstant, fmtRelative, humanize } from "@/lib/format"

export function PreEventTasksCard({ ev }: { ev: EventDetail }) {
  const tz = useTz()
  const invalidate = useInvalidateEvent()
  const completable = new Set(ev.can.completeTask)
  const overridable = new Set(ev.can.overrideTask)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={ListTodoIcon}>Pre-event tasks</IconTitle>
        </CardTitle>
        <CardDescription>
          Reminders and tasks that run before the event. Blocking tasks must be
          done before checkout.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ev.stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tasks for this event type.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ev.stages.map((s) => (
                <StageRow
                  key={s.id}
                  stage={s}
                  tz={tz}
                  canComplete={completable.has(s.id)}
                  canOverride={overridable.has(s.id)}
                  onChanged={() => invalidate(ev.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

type Stage = EventDetail["stages"][number]

function StageRow({
  stage,
  tz,
  canComplete,
  canOverride,
  onChanged,
}: {
  stage: Stage
  tz: string
  canComplete: boolean
  canOverride: boolean
  onChanged: () => Promise<unknown>
}) {
  const complete = useMutation({
    mutationFn: () =>
      unwrap(api.stages[":id"].complete.$post({ param: { id: stage.id } })),
    onSuccess: async () => {
      await onChanged()
      toast.success("Task completed")
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not complete the task."
      ),
  })
  const open = stage.status === "open" || stage.status === "overdue"
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{stage.name}</span>
          {stage.assigneeRole && (
            <span className="text-xs text-muted-foreground">
              For {humanize(stage.assigneeRole)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{humanize(stage.kind)}</Badge>
        {stage.blocksCheckout && (
          <Badge variant="destructive" className="ml-1">
            Blocks checkout
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {fmtInstant(stage.dueAt, tz)}
        <span className="block text-xs text-muted-foreground">
          {fmtRelative(stage.dueAt)}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={STAGE_TONE[stage.status]}>
          {humanize(stage.status)}
        </Badge>
        {stage.overrideReason && (
          <span className="block text-xs text-muted-foreground">
            Override: {stage.overrideReason}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          {canComplete && (
            <Button
              size="sm"
              variant="outline"
              disabled={complete.isPending}
              onClick={() => complete.mutate()}
            >
              Complete
            </Button>
          )}
          {canOverride && open && (
            <TextActionDialog
              trigger={
                <Button size="sm" variant="destructive">
                  Override
                </Button>
              }
              title="Override blocking task"
              description={`Checkout will be allowed without “${stage.name}” being done. Your reason is recorded.`}
              fields={[{ name: "reason", label: "Reason", required: true }]}
              confirmLabel="Override"
              destructive
              onSubmit={async (v) => {
                await unwrap(
                  api.stages[":id"].override.$post({
                    param: { id: stage.id },
                    json: { reason: v.reason ?? "" },
                  })
                )
                await onChanged()
                toast.success("Task overridden")
              }}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Stage status colour: blue planned, amber needs doing, teal done, red late, neutral skipped/cancelled. */
const STAGE_TONE: Record<
  StageStatus,
  "info" | "warning" | "success" | "destructive" | "neutral"
> = {
  scheduled: "info",
  open: "warning",
  sent: "success",
  done: "success",
  overridden: "neutral",
  overdue: "destructive",
  skipped: "neutral",
  cancelled: "neutral",
}
