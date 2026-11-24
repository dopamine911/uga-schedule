import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarDaysIcon,
  CalendarSyncIcon,
  CopyIcon,
  RefreshCwIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  ErrorAlert,
  IconTitle,
  PageHeader,
  QueryView,
} from "@/components/common"
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
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
import { api, unwrap } from "@/lib/api"

// F-009 §1: sync is push-only (D-08). Shows the ICS feed for Apple and other subscribing clients.

const FEED_KEY = ["calendar", "feed"]

export function CalendarSettingsPage() {
  const qc = useQueryClient()
  const feed = useQuery({
    queryKey: FEED_KEY,
    queryFn: () => unwrap(api.calendar.feed.$get()),
  })
  const regenerate = useMutation({
    mutationFn: () => unwrap(api.calendar.feed.regenerate.$post()),
    onSuccess: (data) => {
      qc.setQueryData(FEED_KEY, data)
      toast.success("New feed link created")
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not create a new link."
      ),
  })

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied to clipboard")
    } catch {
      toast.error("Could not copy. Select the link and copy it manually.")
    }
  }

  return (
    <>
      <PageHeader
        title="Calendar sync"
        description="Put your studio bookings into the calendar you already use."
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={CalendarSyncIcon}>
              How updates reach your calendar
            </IconTitle>
          </CardTitle>
          <CardDescription>
            Changes are pushed from here. Edits you make inside your calendar
            are not read back.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Calendar</TableHead>
                <TableHead>How it connects</TableHead>
                <TableHead>Typical delay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Outlook / Microsoft 365</TableCell>
                <TableCell>Direct connect (coming later)</TableCell>
                <TableCell>Seconds, once connected</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Google Calendar</TableCell>
                <TableCell>Direct connect (coming later)</TableCell>
                <TableCell>Seconds, once connected</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Apple Calendar and other apps</TableCell>
                <TableCell>Subscribe to the feed below</TableCell>
                <TableCell>
                  Set by your app: Apple from about 5 minutes; Google
                  subscriptions up to about 24 hours
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground">
            The feed covers events from 30 days ago to 180 days ahead. Your
            calendar app decides how often it refreshes, so a change may take a
            while to show.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <IconTitle icon={CalendarDaysIcon}>Your calendar feed</IconTitle>
          </CardTitle>
          <CardDescription>
            Anyone with this link can read your studio bookings, so keep it
            private.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryView query={feed} rows={1}>
            {(data) => (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="feed-url">Feed link</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="feed-url"
                      readOnly
                      value={data.url}
                      className="font-mono text-xs"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label="Copy feed link"
                        onClick={() => copy(data.url)}
                      >
                        <CopyIcon />
                        Copy
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    In Apple Calendar: File → New Calendar Subscription, then
                    paste the link. Or{" "}
                    <a
                      href={data.url.replace(/^https?:\/\//, "webcal://")}
                      className="underline underline-offset-4"
                    >
                      open it as a webcal link
                    </a>
                    .
                  </FieldDescription>
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" disabled={regenerate.isPending}>
                        <RefreshCwIcon data-icon="inline-start" />
                        Regenerate link
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Create a new feed link?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          The current link stops working straight away. You will
                          need to subscribe again in every calendar app that
                          uses it.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep current link</AlertDialogCancel>
                        <AlertDialogAction onClick={() => regenerate.mutate()}>
                          Regenerate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                {regenerate.error && <ErrorAlert error={regenerate.error} />}
              </FieldGroup>
            )}
          </QueryView>
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>
          Google and Outlook direct connect is coming later
        </AlertTitle>
        <AlertDescription>
          Until then, subscribe to the feed from those calendars as well.
        </AlertDescription>
      </Alert>
    </>
  )
}
