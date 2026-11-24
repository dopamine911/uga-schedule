import { useQueries, useQuery } from "@tanstack/react-query"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { useNavAllowed } from "@/components/common"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { api, unwrap } from "@/lib/api"
import { useCan, useHasRole } from "@/lib/auth"

// Top-bar search over data the app already serves: the event lists the user may see, and (for users who can
// manage people) the existing people search. No new API: each event scope reuses the list query the
// dashboard and the requests page already cache.

const MINIMUM_QUERY_LENGTH = 2
const EVENT_RESULT_LIMIT = 6

type EventScope = "mine" | "sponsoring" | "studio" | "all"

/** The event-list scopes this user may load, matching the API's own scope checks. */
function useSearchScopes(): EventScope[] {
  const can = useCan()
  const hasRole = useHasRole()
  const navAllowed = useNavAllowed()
  const scopes: EventScope[] = ["mine"]
  if (hasRole("SPONSOR")) scopes.push("sponsoring")
  if (can("event.staff_decide")) scopes.push("studio")
  // Admins and other unscoped viewers can see every event; the requests page shows "All" for them.
  if (navAllowed("/admin/users")) scopes.push("all")
  return scopes
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const navAllowed = useNavAllowed()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const term = query.trim()
  const searching = term.length >= MINIMUM_QUERY_LENGTH

  const scopes = useSearchScopes()
  const eventLists = useQueries({
    queries: scopes.map((scope) => ({
      queryKey: ["events", "list", scope, "all"],
      queryFn: () => unwrap(api.events.$get({ query: { scope } })),
      enabled: open && searching,
    })),
  })
  const canOpenPeople = navAllowed("/admin/users")
  const people = useQuery({
    queryKey: ["users", "search", term],
    queryFn: () => unwrap(api.users.search.$get({ query: { q: term } })),
    enabled: open && searching && canOpenPeople,
  })

  const needle = term.toLowerCase()
  const seen = new Set<string>()
  const eventMatches = eventLists
    .flatMap((list) => list.data ?? [])
    .filter((event) => {
      if (seen.has(event.id)) return false
      seen.add(event.id)
      const haystack =
        `${event.title} ${event.requester.displayName} ${event.studio.name}`.toLowerCase()
      return haystack.includes(needle)
    })
    .slice(0, EVENT_RESULT_LIMIT)
  const loading =
    eventLists.some((list) => list.isPending) ||
    (canOpenPeople && people.isPending)

  const go = (path: string) => {
    setOpen(false)
    setQuery("")
    void navigate(path)
  }

  return (
    <Popover open={open && searching} onOpenChange={setOpen}>
      {/* cmdk names its input through its own hidden label (aria-labelledby), which overrides aria-label,
          so the accessible name must be passed here. */}
      <Command
        label="Search requests and people"
        shouldFilter={false}
        className="w-full max-w-md overflow-visible bg-transparent"
      >
        <PopoverAnchor asChild>
          <div className="relative w-full">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            {/* The bare cmdk input: the shared CommandInput draws its own icon and a fixed 32px box. */}
            <CommandPrimitive.Input
              placeholder="Search"
              value={query}
              onValueChange={(value) => {
                setQuery(value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              className="h-10 w-full rounded-full border bg-card pr-4 pl-9 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-72 p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <CommandList>
            {loading ? (
              <div className="p-3 text-sm text-muted-foreground">
                Searching…
              </div>
            ) : (
              <CommandEmpty>No matches for “{term}”.</CommandEmpty>
            )}
            {eventMatches.length > 0 && (
              <CommandGroup heading="Requests">
                {eventMatches.map((event) => (
                  <CommandItem
                    key={event.id}
                    value={`event-${event.id}`}
                    onSelect={() => go(`/events/${event.id}`)}
                    className="flex flex-col items-start gap-0"
                  >
                    <span className="font-medium">{event.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {event.requester.displayName} · {event.studio.name}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {canOpenPeople && (people.data ?? []).length > 0 && (
              <CommandGroup heading="People">
                {(people.data ?? []).map((person) => (
                  <CommandItem
                    key={person.id}
                    value={`person-${person.id}`}
                    onSelect={() => go(`/admin/users/${person.id}`)}
                  >
                    {person.displayName}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </PopoverContent>
      </Command>
    </Popover>
  )
}
