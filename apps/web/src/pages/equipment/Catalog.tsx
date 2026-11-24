import { useQuery } from "@tanstack/react-query"
import {
  CalendarPlusIcon,
  LockIcon,
  LockOpenIcon,
  SearchIcon,
} from "lucide-react"
import { EquipmentClassIcon } from "@/components/EquipmentClassIcon"
import { useState } from "react"
import { Link } from "react-router"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from "@/components/ui/item"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, unwrap } from "@/lib/api"
import { useCan, useHasRole } from "@/lib/auth"
import { humanize } from "@/lib/format"

// Browse the equipment catalog by class (F-003 BR-003-11: catalog view, no asset tags). Students see which
// classes their level unlocks (F-002); staff see everything as bookable.

export function CatalogPage() {
  const can = useCan()
  const hasRole = useHasRole()
  const isStudent = hasRole("STUDENT")
  const types = useQuery({
    queryKey: ["equipment", "types"],
    queryFn: () => unwrap(api.equipment.types.$get({ query: {} })),
  })
  const access = useQuery({
    queryKey: ["levels", "me"],
    queryFn: () => unwrap(api.levels.me.$get()),
    enabled: isStudent,
  })
  const [search, setSearch] = useState("")
  const [classId, setClassId] = useState("all")

  const myRank = isStudent
    ? (access.data?.effectiveLevelToday?.rank ?? 0)
    : Number.POSITIVE_INFINITY

  return (
    <>
      <PageHeader
        title="Equipment catalog"
        description={
          isStudent
            ? `What the studio lends and what your level unlocks${access.data?.effectiveLevelToday ? ` (you have ${access.data.effectiveLevelToday.name})` : ""}. Availability shown is for right now; the request form checks your dates.`
            : "Everything the studio lends. Availability shown is for right now."
        }
        actions={
          can("event.create") && (
            <Button asChild>
              <Link to="/events/new">
                <CalendarPlusIcon data-icon="inline-start" />
                Request studio time
              </Link>
            </Button>
          )
        }
      />
      <QueryView query={types} rows={6}>
        {(all) => {
          const classes = [
            ...new Map(
              all.map((t) => [t.class.id, { ...t.class, minLevel: t.minLevel }])
            ).values(),
          ].sort(
            (a, b) =>
              a.minLevel.rank - b.minLevel.rank || a.name.localeCompare(b.name)
          )
          const q = search.trim().toLowerCase()
          const shown = all.filter(
            (t) =>
              (classId === "all" || t.class.id === classId) &&
              (!q ||
                `${t.name} ${t.manufacturer} ${t.model} ${t.description}`
                  .toLowerCase()
                  .includes(q))
          )
          return (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <InputGroup className="max-w-md">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Search the catalog"
                    placeholder="Search by name, brand or model"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </InputGroup>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={classId}
                  onValueChange={(v) => setClassId(v || "all")}
                  className="flex-wrap"
                  aria-label="Filter by class"
                >
                  <ToggleGroupItem value="all">All</ToggleGroupItem>
                  {classes.map((c) => (
                    <ToggleGroupItem key={c.id} value={c.id}>
                      {c.minLevel.rank > myRank && <LockIcon />}
                      {c.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {shown.length === 0 ? (
                <EmptyState
                  title="Nothing matches"
                  description="Try another search or class."
                />
              ) : (
                classes
                  .filter((c) => shown.some((t) => t.class.id === c.id))
                  .map((c) => {
                    const locked = c.minLevel.rank > myRank
                    return (
                      <section
                        key={c.id}
                        className="flex flex-col gap-3"
                        aria-labelledby={`class-${c.id}`}
                      >
                        <div className="flex flex-wrap items-center gap-3 border-b pb-2">
                          <EquipmentClassIcon name={c.name} />
                          <h2
                            id={`class-${c.id}`}
                            className="text-xl font-medium tracking-wide uppercase"
                          >
                            {c.name}
                          </h2>
                          <Badge variant={locked ? "outline" : "success"}>
                            {locked ? (
                              <LockIcon data-icon="inline-start" />
                            ) : (
                              <LockOpenIcon data-icon="inline-start" />
                            )}
                            {c.minLevel.name}
                          </Badge>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {shown
                            .filter((t) => t.class.id === c.id)
                            .map((t) => (
                              <Item
                                key={t.id}
                                variant="outline"
                                className="items-start bg-card transition-colors hover:border-primary/40"
                              >
                                <ItemContent>
                                  <ItemTitle>{t.name}</ItemTitle>
                                  <ItemDescription>
                                    {[t.manufacturer, t.model]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </ItemDescription>
                                  {t.description && (
                                    <p className="text-sm text-muted-foreground">
                                      {t.description}
                                    </p>
                                  )}
                                </ItemContent>
                                <ItemFooter className="flex-wrap gap-2">
                                  <Badge
                                    variant={
                                      t.counts.available > 0
                                        ? "secondary"
                                        : "destructive"
                                    }
                                  >
                                    {t.counts.available} of {t.counts.total} on
                                    the shelf
                                  </Badge>
                                  {t.maxPerEvent && (
                                    <Badge variant="outline">
                                      Max {t.maxPerEvent} per event
                                    </Badge>
                                  )}
                                  {can("inventory.manage") && (
                                    <Badge variant="outline">
                                      {humanize(t.tracking)}
                                    </Badge>
                                  )}
                                  {can("inventory.manage") && (
                                    <Button asChild variant="link" size="sm">
                                      <Link to={`/admin/inventory/${t.id}`}>
                                        Manage
                                      </Link>
                                    </Button>
                                  )}
                                </ItemFooter>
                              </Item>
                            ))}
                        </div>
                      </section>
                    )
                  })
              )}
            </div>
          )
        }}
      </QueryView>
    </>
  )
}
