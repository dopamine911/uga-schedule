import { LinkIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ErrorAlert } from "@/components/common"
import { Button } from "@/components/ui/button"
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
import { isHttps, postItem } from "./model"
import { usePackageMutation } from "./usePackageRefresh"

export function AddLinkDialog({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("https://")
  const add = usePackageMutation(eventId, {
    mutationFn: () =>
      postItem(eventId, { kind: "link", title: title.trim(), url: url.trim() }),
    onDone: () => {
      setOpen(false)
      setTitle("")
      setUrl("https://")
      toast.success("Link added")
    },
  })
  const valid = title.trim() !== "" && isHttps(url.trim())
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
            <LinkUrlField url={url} onChange={setUrl} />
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

function LinkUrlField({
  url,
  onChange,
}: {
  url: string
  onChange: (url: string) => void
}) {
  const invalid = url !== "" && !isHttps(url.trim())
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor="link-url">URL</FieldLabel>
      <Input
        id="link-url"
        type="url"
        value={url}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldDescription>
        {invalid
          ? "Use an https:// address."
          : "For example, a video or photo album."}
      </FieldDescription>
    </Field>
  )
}
