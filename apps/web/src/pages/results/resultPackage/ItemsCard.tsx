import { DownloadIcon, ExternalLinkIcon, FileTextIcon } from "lucide-react"
import { toast } from "sonner"
import { IconTitle } from "@/components/common"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, unwrap } from "@/lib/api"
import { useTz } from "@/lib/auth"
import { fmtInstant, humanize } from "@/lib/format"
import { AddLinkDialog } from "./AddLinkDialog"
import { fmtSize, type PackageData } from "./model"
import { UploadForm } from "./UploadForm"
import { usePackageMutation } from "./usePackageRefresh"

type PackageItem = PackageData["items"][number]

export function ItemsCard({
  eventId,
  pkg,
  expired,
}: {
  eventId: string
  pkg: PackageData
  expired: boolean
}) {
  const tz = useTz()
  const remove = usePackageMutation<string>(eventId, {
    mutationFn: (itemId) =>
      unwrap(api.results.items[":id"].$delete({ param: { id: itemId } })),
    onDone: () => toast.success("Item removed"),
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not remove the item."
      ),
  })
  return (
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
            <AddLinkDialog eventId={eventId} />
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
                <ItemRow
                  key={item.id}
                  item={item}
                  tz={tz}
                  expired={expired}
                  canRemove={pkg.can.upload}
                  onRemove={(itemId) => remove.mutate(itemId)}
                />
              ))}
            </TableBody>
          </Table>
        )}
        {pkg.can.upload && <UploadForm eventId={eventId} />}
      </CardContent>
    </Card>
  )
}

function ItemRow({
  item,
  tz,
  expired,
  canRemove,
  onRemove,
}: {
  item: PackageItem
  tz: string
  expired: boolean
  canRemove: boolean
  onRemove: (itemId: string) => void
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{item.title}</TableCell>
      <TableCell>
        <Badge variant="outline">
          {item.kind === "link" ? "Link" : humanize(item.mimeType ?? "file")}
        </Badge>
      </TableCell>
      <TableCell>{item.kind === "file" ? fmtSize(item.sizeBytes) : "—"}</TableCell>
      <TableCell>{fmtInstant(item.uploadedAt, tz)}</TableCell>
      <TableCell>
        {expired ? (
          <span className="text-sm text-muted-foreground">Expired</span>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <ItemOpenAction item={item} />
            {canRemove && <RemoveItemDialog item={item} onRemove={onRemove} />}
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

function ItemOpenAction({ item }: { item: PackageItem }) {
  if (item.kind === "file") {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href={`/api/results/items/${item.id}/download`} download>
          <DownloadIcon data-icon="inline-start" />
          Download
        </a>
      </Button>
    )
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={item.url ?? "#"} target="_blank" rel="noopener noreferrer">
        <ExternalLinkIcon data-icon="inline-start" />
        Open link
      </a>
    </Button>
  )
}

function RemoveItemDialog({
  item,
  onRemove,
}: {
  item: PackageItem
  onRemove: (itemId: string) => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove “{item.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The file or link is removed from this package.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => onRemove(item.id)}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
