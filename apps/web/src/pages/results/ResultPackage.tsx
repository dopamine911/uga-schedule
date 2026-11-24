import type { InferResponseType } from "hono/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ClipboardCheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  InfoIcon,
  LinkIcon,
  UploadIcon,
} from "lucide-react"
import { useState } from "react"
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
  type DialogField,
  TextActionDialog,
  useInvalidateEvent,
} from "@/components/events/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ApiError, api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"

// F-008 results package. Uploads and links are only accepted while collecting (BR-008-02);
// publishing needs check-in complete and may need an override reason (BR-008-06/07).

/** Check-in report written when the package is created (lifecycle.buildCheckinReport). */
interface CheckinReportView {
  generatedAt: string
  items: {
    recordId: string
    typeName: string
    assetTag: string | null
    qty: number
    outAt: string
    outBy: string
    conditionOut: string
    dueAt: string
    inAt: string | null
    inBy: string | null
    conditionIn: string | null
    qtyOk: number
    qtyDamaged: number
    qtyMissing: number
    qtyLost: number
    late: boolean
    notes: string | null
  }[]
  holds: { reason: string; status: string; placedAt: string }[]
}

function isCheckinReport(x: unknown): x is CheckinReportView {
  return !!x && typeof x === "object" && "items" in x && Array.isArray(x.items)
}

async function postItem(
  eventId: string,
  body: FormData | { kind: "link"; title: string; url: string }
) {
  const init: RequestInit =
    body instanceof FormData
      ? { method: "POST", body, credentials: "same-origin" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin",
        }
  return unwrap<{ id: string }>(
    fetch(`/api/results/events/${eventId}/items`, init)
  )
}

function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}

export function ResultPackagePage() {
  const { eventId } = useParams()
  const query = useQuery({
    queryKey: ["results", eventId],
    queryFn: () =>
      unwrap(
        api.results.events[":eventId"].$get({ param: { eventId: eventId! } })
      ),
    enabled: !!eventId,
  })
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <>
        <PageHeader title="Results" />
        <EmptyState
          icon={FileTextIcon}
          title="Results not found"
          description="There is no results package here, or you can't see it."
        >
          <Button variant="outline" asChild>
            <Link to="/results">Back to results</Link>
          </Button>
        </EmptyState>
      </>
    )
  }
  return (
    <QueryView query={query} rows={4}>
      {(pkg) => <PackageView eventId={eventId!} pkg={pkg} />}
    </QueryView>
  )
}

type PackageData = InferResponseType<
  (typeof api.results.events)[":eventId"]["$get"]
>

function PackageView({ eventId, pkg }: { eventId: string; pkg: PackageData }) {
  const tz = useTz()
  const qc = useQueryClient()
  const invalidateEvent = useInvalidateEvent()
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["results"] }),
      invalidateEvent(eventId),
    ])
  }
  const raw: unknown = pkg.checkinReport
  const report = isCheckinReport(raw) ? raw : null
  const noResults = pkg.requiresResults && pkg.items.length === 0
  const signoffPending = pkg.sponsorSignoff === "pending"
  const overrideReasons = [
    noResults ? "no results uploaded" : null,
    signoffPending ? "sponsor sign-off pending" : null,
  ].filter((x): x is string => x !== null)

  const remove = useMutation({
    mutationFn: (itemId: string) =>
      unwrap(api.results.items[":id"].$delete({ param: { id: itemId } })),
    onSuccess: async () => {
      await refresh()
      toast.success("Item removed")
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not remove the item."
      ),
  })

  const publishFields: DialogField[] = [
    {
      name: "overrideReason",
      label: "Reason for publishing now",
      required: overrideReasons.length > 0,
      description: overrideReasons.length
        ? `Publishing with: ${overrideReasons.join(", ")}.`
        : undefined,
    },
  ]

  return (
    <>
      <PageHeader
        title={pkg.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                pkg.status === "expired"
                  ? "destructive"
                  : pkg.status === "published"
                    ? "secondary"
                    : "outline"
              }
            >
              {humanize(pkg.status)}
            </Badge>
            {pkg.publishedAt && (
              <span>Published {fmtInstant(pkg.publishedAt, tz)}</span>
            )}
            {pkg.daysLeft !== null && pkg.status !== "expired" && (
              <span>· {pkg.daysLeft} days left to download</span>
            )}
          </span>
        }
        actions={
          <>
            {pkg.can.signoff && (
              <TextActionDialog
                trigger={<Button variant="outline">Sign off</Button>}
                title="Sponsor sign-off"
                description="Confirm the results reflect the event. You can leave a comment."
                fields={[
                  { name: "comment", label: "Comment", required: false },
                ]}
                confirmLabel="Sign off"
                onSubmit={async (v) => {
                  await unwrap(
                    api.results.events[":eventId"].signoff.$post({
                      param: { eventId },
                      json: { comment: v.comment ?? "" },
                    })
                  )
                  await refresh()
                  toast.success("Signed off")
                }}
              />
            )}
            {pkg.can.publish && (
              <TextActionDialog
                trigger={<Button>Publish</Button>}
                title="Publish results"
                description="Publishing makes the package available to participants, the sponsor and staff."
                fields={publishFields}
                confirmLabel="Publish"
                onSubmit={async (v) => {
                  await unwrap(
                    api.results.events[":eventId"].publish.$post({
                      param: { eventId },
                      json: { overrideReason: v.overrideReason || undefined },
                    })
                  )
                  await refresh()
                  toast.success("Results published")
                }}
              />
            )}
          </>
        }
      />

      {pkg.can.signoff && (
        <Alert>
          <AlertTitle>Sponsor sign-off needed</AlertTitle>
          <AlertDescription>
            Please review the results and sign off.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <IconTitle icon={InfoIcon}>Status</IconTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">
                {pkg.status === "collecting"
                  ? "Collecting results"
                  : pkg.status === "published"
                    ? "Published"
                    : "Expired"}
              </span>
            </div>
            {pkg.resultsDueAt && (
              <p>Results due {fmtInstant(pkg.resultsDueAt, tz)}</p>
            )}
            {pkg.sponsorSignoff !== "not_required" && (
              <div className="flex flex-col gap-1">
                <span className="font-medium">Sponsor sign-off</span>
                {pkg.sponsorSignoff === "accepted" ? (
                  <span>
                    Signed off
                    {pkg.signedOffAt
                      ? ` ${fmtInstant(pkg.signedOffAt, tz)}`
                      : ""}
                    {pkg.sponsorComment ? ` — “${pkg.sponsorComment}”` : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Waiting for the sponsor
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {pkg.can.publish && overrideReasons.length > 0 && (
          <Alert>
            <AlertTitle>Publishing needs a reason</AlertTitle>
            <AlertDescription>
              {overrideReasons.map((r) => humanize(r)).join(", ")}. Give a
              reason when you publish.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={FileTextIcon}>Items</IconTitle>
          </CardTitle>
          <CardDescription>Files and links in this package.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {pkg.can.upload && (
            <div className="flex justify-end">
              <AddLinkDialog eventId={eventId} onAdded={refresh} />
            </div>
          )}
          {pkg.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files or links yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pkg.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {item.kind === "link"
                          ? "Link"
                          : humanize(item.mimeType ?? "file")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.kind === "file" ? fmtSize(item.sizeBytes) : "—"}
                    </TableCell>
                    <TableCell>{fmtInstant(item.uploadedAt, tz)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        {item.kind === "file" ? (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={`/api/results/items/${item.id}/download`}
                              download
                            >
                              <DownloadIcon data-icon="inline-start" />
                              Download
                            </a>
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={item.url ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLinkIcon data-icon="inline-start" />
                              Open link
                            </a>
                          </Button>
                        )}
                        {pkg.can.upload && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                Remove
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Remove “{item.title}”?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  The file or link is removed from this package.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Keep it</AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  onClick={() => remove.mutate(item.id)}
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {pkg.can.upload && (
            <UploadForm eventId={eventId} onUploaded={refresh} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={ClipboardCheckIcon}>Check-in report</IconTitle>
          </CardTitle>
          <CardDescription>
            What went out, what came back, and any holds.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!report ? (
            <p className="text-sm text-muted-foreground">
              The check-in report is not available yet.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Asset tag</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Returned</TableHead>
                    <TableHead>Condition in</TableHead>
                    <TableHead>OK / damaged / missing / lost</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.items.map((r) => (
                    <TableRow key={r.recordId}>
                      <TableCell>{r.typeName}</TableCell>
                      <TableCell>{r.assetTag ?? "—"}</TableCell>
                      <TableCell>{r.qty}</TableCell>
                      <TableCell>
                        {fmtInstant(r.outAt, tz)}
                        <span className="block text-xs text-muted-foreground">
                          by {r.outBy}
                        </span>
                      </TableCell>
                      <TableCell>{fmtInstant(r.dueAt, tz)}</TableCell>
                      <TableCell>
                        {r.inAt ? fmtInstant(r.inAt, tz) : "—"}
                        {r.inBy && (
                          <span className="block text-xs text-muted-foreground">
                            by {r.inBy}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {humanize(r.conditionOut)} →{" "}
                        {r.conditionIn ? humanize(r.conditionIn) : "—"}
                      </TableCell>
                      <TableCell>
                        {r.qtyOk} / {r.qtyDamaged} / {r.qtyMissing} /{" "}
                        {r.qtyLost}
                        {r.late && (
                          <Badge variant="destructive" className="ml-1">
                            Late
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{r.notes ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {report.holds.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hold</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Placed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.holds.map((h, i) => (
                      <TableRow key={i}>
                        <TableCell>{humanize(h.reason)}</TableCell>
                        <TableCell>{humanize(h.status)}</TableCell>
                        <TableCell>{fmtInstant(h.placedAt, tz)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground">
                Generated {fmtInstant(report.generatedAt, tz)}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function UploadForm({
  eventId,
  onUploaded,
}: {
  eventId: string
  onUploaded: () => Promise<unknown>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData()
      form.append("file", file!)
      form.append("title", title.trim())
      return postItem(eventId, form)
    },
    onSuccess: async () => {
      setFile(null)
      setTitle("")
      await onUploaded()
      toast.success("File uploaded")
    },
  })
  return (
    <form
      className="flex flex-col gap-4 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (file && title.trim()) upload.mutate()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="result-file">File</FieldLabel>
          <Input
            id="result-file"
            type="file"
            accept="video/*,audio/*,image/*,application/pdf,application/zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <FieldDescription>Video, audio, images, PDF or ZIP.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="result-title">Title</FieldLabel>
          <Input
            id="result-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      </FieldGroup>
      {upload.error && <ErrorAlert error={upload.error} />}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!file || !title.trim() || upload.isPending}
        >
          {upload.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon data-icon="inline-start" />
          )}
          Upload file
        </Button>
      </div>
    </form>
  )
}

function AddLinkDialog({
  eventId,
  onAdded,
}: {
  eventId: string
  onAdded: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("https://")
  const add = useMutation({
    mutationFn: () =>
      postItem(eventId, { kind: "link", title: title.trim(), url: url.trim() }),
    onSuccess: async () => {
      setOpen(false)
      setTitle("")
      setUrl("https://")
      await onAdded()
      toast.success("Link added")
    },
  })
  const urlOk = isHttps(url.trim())
  const valid = title.trim() !== "" && urlOk
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <LinkIcon data-icon="inline-start" />
          Add link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) add.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a link</DialogTitle>
            <DialogDescription>
              Links must start with https://.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="link-title">Title</FieldLabel>
              <Input
                id="link-title"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field data-invalid={(url !== "" && !urlOk) || undefined}>
              <FieldLabel htmlFor="link-url">URL</FieldLabel>
              <Input
                id="link-url"
                type="url"
                value={url}
                aria-invalid={(url !== "" && !urlOk) || undefined}
                onChange={(e) => setUrl(e.target.value)}
              />
              <FieldDescription>
                {url !== "" && !urlOk
                  ? "Use an https:// address."
                  : "For example, a video or photo album."}
              </FieldDescription>
            </Field>
          </FieldGroup>
          {add.error && <ErrorAlert error={add.error} />}
          <DialogFooter>
            <Button type="submit" disabled={!valid || add.isPending}>
              {add.isPending && <Spinner data-icon="inline-start" />}
              Add link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
