import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { SlidersHorizontalIcon } from "lucide-react"
import {
  EmptyState,
  ErrorAlert,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
import { TextField } from "@/components/admin/pickers"
import { RequirePerm } from "@/components/admin/shared"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { api, unwrap } from "@/lib/api"
import { useCan } from "@/lib/auth"
import { humanize } from "@/lib/format"

// BR-006-05 and related rules: admin-configurable numbers. Units show how each value is read.

type Unit = "hours" | "days" | "minutes" | "count"

const POLICY_META: Record<
  string,
  { label: string; unit: Unit; description: string }
> = {
  LEAD_TIME_HOURS: {
    label: "Lead time",
    unit: "hours",
    description:
      "The first day must start at least this long after a request is submitted.",
  },
  ADVANCE_DAYS: {
    label: "Advance booking window",
    unit: "days",
    description:
      "The first day can start at most this many days after a request is submitted.",
  },
  WEEKLY_HOURS: {
    label: "Weekly hours per student",
    unit: "hours",
    description:
      "Total booked studio hours per student per ISO week. A soft rule: staff can override it.",
  },
  OPEN_CAP: {
    label: "Open events per student",
    unit: "count",
    description:
      "Events a student may have in Submitted, Sponsor approved or Confirmed at once. A soft rule.",
  },
  SPONSOR_SLA_HOURS: {
    label: "Sponsor decision time",
    unit: "hours",
    description: "How long a sponsor has to decide before the request expires.",
  },
  STAFF_SLA_HOURS: {
    label: "Staff decision time",
    unit: "hours",
    description:
      "How long studio staff have to decide before the request expires.",
  },
  DECISION_CUTOFF_HOURS: {
    label: "Decision cutoff",
    unit: "hours",
    description:
      "An event must be confirmed this long before its first day, or it expires.",
  },
  NO_SHOW_GRACE_MINUTES: {
    label: "No-show grace",
    unit: "minutes",
    description:
      "After the first day's start, a confirmed event that hasn't started counts as a no-show.",
  },
  GRANT_EXPIRY_WARN_DAYS: {
    label: "Grant expiry warning",
    unit: "days",
    description: "Show a grant as expiring this many days before its end date.",
  },
  LOST_AFTER_DAYS: {
    label: "Mark units lost after",
    unit: "days",
    description:
      "Days a checked-out unit may stay out before it is marked lost.",
  },
  LATE_HOLD_CLEAR_DAYS: {
    label: "Clear late holds after",
    unit: "days",
    description: "Days after which an unresolved late hold is cleared.",
  },
  RESULTS_RETENTION_DAYS: {
    label: "Results retention",
    unit: "days",
    description: "How long uploaded results are kept.",
  },
  SIGNOFF_PUBLISH_AFTER_DAYS: {
    label: "Sign-off publish delay",
    unit: "days",
    description:
      "Days after the event before sponsor sign-off results are published.",
  },
}

const UNIT_LABEL: Record<Unit, string> = {
  hours: "hours",
  days: "days",
  minutes: "minutes",
  count: "events",
}

export function PoliciesPage() {
  return (
    <RequirePerm perm="policy.manage" title="Policies">
      <PoliciesContent />
    </RequirePerm>
  )
}

function PoliciesContent() {
  const policies = useQuery({
    queryKey: ["policies"],
    queryFn: () => unwrap(api.policies.$get()),
  })
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Policies"
        description="Global numbers the booking rules use."
      />
      <QueryView query={policies}>
        {(data) => <PolicyForm key={JSON.stringify(data)} values={data} />}
      </QueryView>
    </div>
  )
}

function PolicyForm({ values }: { values: Record<string, number> }) {
  const qc = useQueryClient()
  const can = useCan()
  const keys = [
    ...Object.keys(POLICY_META).filter((k) => k in values),
    ...Object.keys(values).filter((k) => !(k in POLICY_META)),
  ]
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    toStrings(values)
  )

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, number> = {}
      for (const k of keys) body[k] = Number(draft[k])
      return unwrap(api.policies.$put({ json: body }))
    },
    onSuccess: (next) => {
      qc.setQueryData(["policies"], next)
      toast.success("Policies saved.")
    },
  })

  const invalid = keys.some((k) => !isWhole(draft[k] ?? ""))
  const dirty = keys.some((k) => draft[k] !== String(values[k]))

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>
          <IconTitle icon={SlidersHorizontalIcon}>Booking rules</IconTitle>
        </CardTitle>
        <CardDescription>Whole numbers, zero or more.</CardDescription>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <EmptyState icon={SlidersHorizontalIcon} title="No policies" />
        ) : (
          <form
            id="policies-form"
            className="flex flex-col gap-6"
            onSubmit={(e) => {
              e.preventDefault()
              if (!invalid && can("policy.manage")) save.mutate()
            }}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              {keys.map((k) => {
                const meta = POLICY_META[k]
                const unit = meta ? UNIT_LABEL[meta.unit] : ""
                const error = isWhole(draft[k] ?? "")
                  ? undefined
                  : "Enter a whole number, zero or more."
                return (
                  <TextField
                    key={k}
                    id={`policy-${k}`}
                    label={
                      meta
                        ? `${meta.label}${unit ? ` (${unit})` : ""}`
                        : humanize(k)
                    }
                    type="number"
                    value={draft[k] ?? ""}
                    onChange={(x) => setDraft((d) => ({ ...d, [k]: x }))}
                    description={meta?.description ?? k}
                    disabled={!can("policy.manage")}
                    error={error}
                  />
                )
              })}
            </div>
            {save.error && <ErrorAlert error={save.error} />}
          </form>
        )}
      </CardContent>
      {can("policy.manage") && keys.length > 0 && (
        <CardFooter className="justify-end">
          <Button
            type="submit"
            form="policies-form"
            disabled={!dirty || invalid || save.isPending}
          >
            {save.isPending && <Spinner data-icon="inline-start" />}
            Save policies
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function toStrings(values: Record<string, number>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, String(v)])
  )
}

function isWhole(s: string): boolean {
  return /^\d+$/.test(s.trim())
}
