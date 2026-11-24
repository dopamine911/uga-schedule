import { useQuery } from "@tanstack/react-query"
import { PlusIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api, unwrap } from "@/lib/api"
import { useUser } from "@/lib/auth"
import type { PersonRef } from "@/components/events/draft"

// Sponsor (BR-006-02) and participants (F-006 §2). The requester and sponsor are never listed as participants.

export function SponsorSelect({
  id,
  value,
  onValueChange,
  disabled,
}: {
  id?: string
  value: string
  onValueChange: (id: string) => void
  disabled?: boolean
}) {
  const me = useUser()
  const sponsors = useQuery({
    queryKey: ["users", "sponsors"],
    queryFn: () => unwrap(api.users.sponsors.$get()),
  })
  const options = (sponsors.data ?? []).filter((s) => s.id !== me.id)
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue
          placeholder={
            sponsors.isPending ? "Loading sponsors…" : "Choose a sponsor"
          }
        />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.displayName}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function ParticipantsPicker({
  value,
  excludeIds,
  onChange,
}: {
  value: PersonRef[]
  /** Ids that cannot be participants (the requester and the sponsor). */
  excludeIds: string[]
  onChange: (next: PersonRef[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const term = q.trim()
  const search = useQuery({
    queryKey: ["users", "search", term],
    queryFn: () => unwrap(api.users.search.$get({ query: { q: term } })),
    enabled: open && term.length >= 2,
  })
  const blocked = new Set([...excludeIds, ...value.map((p) => p.id)])
  const candidates = (search.data ?? []).filter((u) => !blocked.has(u.id))

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Participants">
          {value.map((p) => (
            <li key={p.id}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {p.displayName}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={`Remove ${p.displayName}`}
                  onClick={() => onChange(value.filter((x) => x.id !== p.id))}
                >
                  <XIcon />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-fit">
            <PlusIcon data-icon="inline-start" />
            Add participant
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search people…"
              value={q}
              onValueChange={setQ}
            />
            <CommandList>
              {term.length < 2 ? (
                <div className="p-3 text-sm text-muted-foreground">
                  Type at least 2 letters to search
                </div>
              ) : search.isPending ? (
                <div className="p-3 text-sm text-muted-foreground">
                  Searching…
                </div>
              ) : (
                <CommandEmpty>No people found.</CommandEmpty>
              )}
              <CommandGroup>
                {candidates.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={u.id}
                    onSelect={() => {
                      onChange([
                        ...value,
                        { id: u.id, displayName: u.displayName },
                      ])
                      setQ("")
                    }}
                  >
                    {u.displayName}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
