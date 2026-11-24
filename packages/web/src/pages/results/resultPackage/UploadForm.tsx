import { UploadIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ErrorAlert } from "@/components/common"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { postItem } from "./model"
import { usePackageMutation } from "./usePackageRefresh"

export function UploadForm({ eventId }: { eventId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const upload = usePackageMutation(eventId, {
    mutationFn: async () => {
      const form = new FormData()
      form.append("file", file!)
      form.append("title", title.trim())
      return postItem(eventId, form)
    },
    onDone: () => {
      setFile(null)
      setTitle("")
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
