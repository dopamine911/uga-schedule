import { ROLES, type RoleCode } from "@studio/domain"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createElement, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { FormDialog } from "@/components/admin/shared"
import {
  SimpleSelect,
  TextField,
  type UserRecord,
  useStudios,
} from "@/components/admin/pickers"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { api, unwrap } from "@/lib/api"
import { ELEVATED_ROLES, ROLE_INFO } from "@/lib/roles"

// Create and edit user accounts (F-001). Accounts made here are linked to university SSO on first sign-in.

const AFFILIATIONS = ["student", "faculty", "staff", "other"] as const
type Affiliation = (typeof AFFILIATIONS)[number]
const AFFILIATION_OPTIONS = AFFILIATIONS.map((a) => ({
  value: a,
  label: a[0]!.toUpperCase() + a.slice(1),
}))

/** Suggested starting roles for an affiliation (mirrors BR-001-03 automatic roles). */
const DEFAULT_ROLES: Record<Affiliation, RoleCode[]> = {
  student: ["STUDENT"],
  faculty: ["SPONSOR"],
  staff: [],
  other: [],
}

interface RoleChoice {
  role: RoleCode
  studioId: string | null
}

/** Role checkboxes; Studio staff expands to one checkbox per studio (one assignment each, BR-001-05). */
function RolePicker({
  value,
  onChange,
}: {
  value: RoleChoice[]
  onChange: (v: RoleChoice[]) => void
}) {
  const studios = useStudios()
  const has = (role: RoleCode, studioId: string | null = null) =>
    value.some((r) => r.role === role && r.studioId === studioId)
  const toggle = (role: RoleCode, studioId: string | null, on: boolean) =>
    onChange(
      on
        ? [...value, { role, studioId }]
        : value.filter((r) => !(r.role === role && r.studioId === studioId))
    )

  return (
    <FieldSet>
      <FieldLegend variant="label">Roles</FieldLegend>
      <FieldDescription>
        Pick any combination. Permissions add up.
      </FieldDescription>
      <div className="flex flex-col gap-3">
        {ROLES.map((role) => {
          const info = ROLE_INFO[role]
          if (info.scoped)
            return (
              <div
                key={role}
                className="flex flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary [&_svg]:size-4">
                    {createElement(info.icon, { "aria-hidden": true })}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-bold">{info.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {info.summary}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 pl-11">
                  {(studios.data ?? []).map((s) => (
                    <Field
                      key={s.id}
                      orientation="horizontal"
                      className="w-auto"
                    >
                      <Checkbox
                        id={`role-${role}-${s.id}`}
                        checked={has(role, s.id)}
                        onCheckedChange={(on) =>
                          toggle(role, s.id, on === true)
                        }
                      />
                      <FieldLabel
                        htmlFor={`role-${role}-${s.id}`}
                        className="font-normal"
                      >
                        {s.name}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </div>
            )
          return (
            <Field
              key={role}
              orientation="horizontal"
              className="rounded-lg border p-3"
            >
              <Checkbox
                id={`role-${role}`}
                checked={has(role)}
                onCheckedChange={(on) => toggle(role, null, on === true)}
              />
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary [&_svg]:size-4">
                {createElement(info.icon, { "aria-hidden": true })}
              </span>
              <FieldContent>
                <FieldLabel htmlFor={`role-${role}`} className="font-bold">
                  {info.label}
                </FieldLabel>
                <FieldDescription>{info.summary}</FieldDescription>
              </FieldContent>
            </Field>
          )
        })}
      </div>
    </FieldSet>
  )
}

export function NewUserDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [affiliation, setAffiliation] = useState<Affiliation>("student")
  const [roles, setRoles] = useState<RoleChoice[]>(() =>
    DEFAULT_ROLES.student.map((role) => ({ role, studioId: null }))
  )
  const rolesTouched = useRef(false)
  const [ack, setAck] = useState(false)
  const elevated = roles.filter((r) => ELEVATED_ROLES.includes(r.role))

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.users.$post({
          json: {
            displayName: displayName.trim(),
            email: email.trim(),
            affiliation,
            roles,
          },
        })
      ),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: ["users"] })
      void qc.invalidateQueries({ queryKey: ["dev-users"] })
      toast.success(`${u.displayName} added.`)
      onClose()
      navigate(`/admin/users/${u.id}`)
    },
  })

  return (
    <FormDialog
      title="Add user"
      description="Creates the account now. It links to the person's university sign-in (MyID) the first time they sign in with this email."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitLabel="Add user"
      submitDisabled={
        !displayName.trim() || !email.trim() || (elevated.length > 0 && !ack)
      }
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="new-name"
          label="Full name"
          value={displayName}
          onChange={setDisplayName}
          required
        />
        <TextField
          id="new-email"
          label="University email"
          type="email"
          placeholder="name@uga.edu"
          value={email}
          onChange={setEmail}
          required
        />
      </div>
      <Field>
        <FieldLabel htmlFor="new-affiliation">Affiliation</FieldLabel>
        <SimpleSelect
          id="new-affiliation"
          value={affiliation}
          onValueChange={(x) => {
            const a = x as Affiliation
            setAffiliation(a)
            // Suggest the usual roles until the admin picks roles themselves.
            if (!rolesTouched.current)
              setRoles(
                DEFAULT_ROLES[a].map((role) => ({ role, studioId: null }))
              )
          }}
          options={AFFILIATION_OPTIONS}
        />
        <FieldDescription>
          Students usually get Student; faculty usually get Sponsor.
        </FieldDescription>
      </Field>
      <RolePicker
        value={roles}
        onChange={(r) => {
          setRoles(r)
          rolesTouched.current = true
          setAck(false)
        }}
      />
      {elevated.length > 0 && (
        <Field orientation="horizontal">
          <Checkbox
            id="new-ack"
            checked={ack}
            onCheckedChange={(on) => setAck(on === true)}
          />
          <FieldLabel htmlFor="new-ack" className="font-normal">
            I understand{" "}
            {elevated.map((r) => ROLE_INFO[r.role].label).join(" and ")} gives
            this person broad control of the system.
          </FieldLabel>
        </Field>
      )}
    </FormDialog>
  )
}

export function EditProfileDialog({
  user,
  onClose,
}: {
  user: UserRecord
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [affiliation, setAffiliation] = useState<Affiliation>(
    (AFFILIATIONS as readonly string[]).includes(user.affiliation)
      ? (user.affiliation as Affiliation)
      : "other"
  )
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.users[":id"].profile.$put({
          param: { id: user.id },
          json: {
            displayName: displayName.trim(),
            email: email.trim(),
            affiliation,
          },
        })
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] })
      toast.success("Profile updated.")
      onClose()
    },
  })
  return (
    <FormDialog
      title="Edit profile"
      description={
        user.linked
          ? "This account is linked to university sign-in; changing the email here does not change their MyID."
          : "This person hasn't signed in yet. They'll be matched by this email on first sign-in."
      }
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitDisabled={!displayName.trim() || !email.trim()}
    >
      <TextField
        id="edit-name"
        label="Full name"
        value={displayName}
        onChange={setDisplayName}
        required
      />
      <TextField
        id="edit-email"
        label="University email"
        type="email"
        value={email}
        onChange={setEmail}
        required
      />
      <Field>
        <FieldLabel htmlFor="edit-affiliation">Affiliation</FieldLabel>
        <SimpleSelect
          id="edit-affiliation"
          value={affiliation}
          onValueChange={(x) => setAffiliation(x as Affiliation)}
          options={AFFILIATION_OPTIONS}
        />
      </Field>
    </FormDialog>
  )
}
