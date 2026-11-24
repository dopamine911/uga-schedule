import { UsersIcon } from "lucide-react"
import { IconTitle } from "@/components/common"
import { ParticipantsPicker, SponsorSelect } from "@/components/events/PeoplePicker"
import type { DraftForm } from "@/components/events/draft"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"

/** Section 4: the sponsor who approves the request and the participants. */
export function PeopleCard({
  form,
  patch,
  meId,
}: {
  form: DraftForm
  patch: (p: Partial<DraftForm>) => void
  meId: string
}) {
  const sponsorId = form.sponsorId || null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <IconTitle icon={UsersIcon}>4. People</IconTitle>
        </CardTitle>
        <CardDescription>
          Your sponsor approves the request. Participants see it on their calendar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="sponsor">Sponsor</FieldLabel>
            <SponsorSelect
              id="sponsor"
              value={form.sponsorId}
              onValueChange={(sponsorId) =>
                patch({
                  sponsorId,
                  participants: form.participants.filter((p) => p.id !== sponsorId),
                })
              }
            />
          </Field>
          <Field>
            <FieldLabel>Participants</FieldLabel>
            <ParticipantsPicker
              value={form.participants}
              excludeIds={[meId, ...(sponsorId ? [sponsorId] : [])]}
              onChange={(participants) => patch({ participants })}
            />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
