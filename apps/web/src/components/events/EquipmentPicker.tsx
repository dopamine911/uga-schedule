import type { DayInput } from "@studio/domain"
import { useQuery } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { LockIcon, MinusIcon, PlusIcon, SearchIcon } from "lucide-react"
import { EquipmentClassIcon } from "@/components/EquipmentClassIcon"
import { useMemo, useState } from "react"
import { QueryView } from "@/components/common"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { api, unwrap } from "@/lib/api"

// Equipment available on the chosen days, grouped by class, with the requester's level applied (F-002 §4, F-003 §4).

type EquipmentType = InferResponseType<
  typeof api.equipment.types.$get,
  200
>[number]
const fetchTypes = () => unwrap(api.equipment.types.$get({ query: {} }))

interface Row {
  type: EquipmentType
  available: number
  eligible: boolean
  minLevelName: string
  /** Effective per-event limit: availability capped by maxPerEvent. */
  max: number
}

interface ClassGroup {
  id: string
  name: string
  minLevelName: string
  minLevelRank: number
  eligible: boolean
  rows: Row[]
}

export function EquipmentPicker({
  days,
  excludeEventId,
  lines,
  onQtyChange,
}: {
  days: DayInput[]
  excludeEventId?: string
  lines: Record<string, number>
  onQtyChange: (equipmentTypeId: string, qty: number) => void
}) {
  const types = useQuery({
    queryKey: ["equipment", "types"],
    queryFn: fetchTypes,
  })
  const availability = useQuery({
    queryKey: ["equipment", "availability", days, excludeEventId ?? null],
    queryFn: () =>
      unwrap(
        api.equipment.availability.$post({
          json: { days, excludeEventId: excludeEventId ?? null },
        })
      ),
    enabled: days.length > 0,
  })
  const [search, setSearch] = useState("")
  const [onlyBookable, setOnlyBookable] = useState(true)
  const [open, setOpen] = useState<string[] | null>(null)

  const groups = useMemo<ClassGroup[]>(() => {
    if (!types.data || !availability.data) return []
    const avail = new Map(availability.data.map((a) => [a.equipmentTypeId, a]))
    const byClass = new Map<string, ClassGroup>()
    for (const type of types.data) {
      const a = avail.get(type.id)
      if (!a) continue
      const row: Row = {
        type,
        available: Math.max(0, a.available),
        eligible: a.eligible,
        minLevelName: a.minLevelName,
        max: Math.max(
          0,
          Math.min(a.available, type.maxPerEvent ?? Number.POSITIVE_INFINITY)
        ),
      }
      const g = byClass.get(type.class.id) ?? {
        id: type.class.id,
        name: type.class.name,
        minLevelName: type.minLevel.name,
        minLevelRank: type.minLevel.rank,
        eligible: a.eligible,
        rows: [],
      }
      g.rows.push(row)
      byClass.set(type.class.id, g)
    }
    return [...byClass.values()]
      .map((g) => ({
        ...g,
        rows: g.rows.sort((x, y) => x.type.name.localeCompare(y.type.name)),
      }))
      .sort(
        (x, y) =>
          Number(y.eligible) - Number(x.eligible) ||
          x.minLevelRank - y.minLevelRank ||
          x.name.localeCompare(y.name)
      )
  }, [types.data, availability.data])

  if (days.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Choose the dates and times to see equipment availability.
      </p>
    )

  const q = search.trim().toLowerCase()
  const matches = (r: Row) =>
    !q ||
    `${r.type.name} ${r.type.manufacturer} ${r.type.model} ${r.type.class.name}`
      .toLowerCase()
      .includes(q)
  const visible = groups
    .filter(
      (g) =>
        !onlyBookable ||
        g.eligible ||
        g.rows.some((r) => (lines[r.type.id] ?? 0) > 0)
    )
    .map((g) => ({ ...g, rows: g.rows.filter(matches) }))
    .filter((g) => g.rows.length > 0)
  const hiddenLocked = groups.filter((g) => !g.eligible).length
  const selectedIn = (g: ClassGroup) =>
    g.rows.filter((r) => (lines[r.type.id] ?? 0) > 0).length
  // Searching opens every matching class; otherwise the user's own choice, defaulting to classes with selections.
  const defaultOpen = groups.filter((g) => selectedIn(g) > 0).map((g) => g.id)
  const openValue = q
    ? visible.map((g) => g.id)
    : (open ??
      (defaultOpen.length ? defaultOpen : groups.slice(0, 1).map((g) => g.id)))

  return (
    <QueryView query={availability} rows={4}>
      {() => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search equipment"
                placeholder="Search equipment, brand or model"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            <Field orientation="horizontal" className="w-auto">
              <Switch
                id="only-bookable"
                checked={onlyBookable}
                onCheckedChange={setOnlyBookable}
              />
              <FieldLabel htmlFor="only-bookable" className="font-normal">
                Only equipment I can book
                {hiddenLocked > 0 && onlyBookable
                  ? ` (${hiddenLocked} locked classes hidden)`
                  : ""}
              </FieldLabel>
            </Field>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No equipment matches “{search}”.
            </p>
          ) : (
            <Accordion
              type="multiple"
              value={openValue}
              onValueChange={setOpen}
              className="rounded-lg border"
            >
              {visible.map((g) => {
                const count = selectedIn(g)
                return (
                  <AccordionItem key={g.id} value={g.id} className="px-4">
                    <AccordionTrigger>
                      <span className="flex flex-1 flex-wrap items-center gap-2">
                        <EquipmentClassIcon name={g.name} />
                        <span className="font-bold">{g.name}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {g.rows.length} items
                        </span>
                        {count > 0 && <Badge>{count} selected</Badge>}
                        {!g.eligible && (
                          <Badge variant="outline">
                            <LockIcon data-icon="inline-start" />
                            Requires {g.minLevelName}
                          </Badge>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ItemGroup>
                        {g.rows.map((r) => (
                          <EquipmentRow
                            key={r.type.id}
                            row={r}
                            qty={lines[r.type.id] ?? 0}
                            onChange={(n) => onQtyChange(r.type.id, n)}
                          />
                        ))}
                      </ItemGroup>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}
        </div>
      )}
    </QueryView>
  )
}

function EquipmentRow({
  row,
  qty,
  onChange,
}: {
  row: Row
  qty: number
  onChange: (qty: number) => void
}) {
  const { type, available, eligible, minLevelName, max } = row
  const disabled = !eligible || (available === 0 && qty === 0)
  const clamp = (n: number) => Math.max(0, Math.min(n, Math.max(max, qty)))
  return (
    <Item
      size="sm"
      variant={qty > 0 ? "muted" : "default"}
      data-disabled={disabled || undefined}
    >
      <ItemContent>
        <ItemTitle>{type.name}</ItemTitle>
        <ItemDescription className="line-clamp-1">
          {[type.manufacturer, type.model].filter(Boolean).join(" ")}
          {type.description ? ` · ${type.description}` : ""}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {!eligible ? (
          <Badge variant="outline">Requires {minLevelName}</Badge>
        ) : available === 0 ? (
          <Badge variant="destructive">None free</Badge>
        ) : (
          <Badge variant="secondary">
            {available} free
            {type.maxPerEvent ? ` · max ${type.maxPerEvent}` : ""}
          </Badge>
        )}
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={`Quantity of ${type.name}`}
        >
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Fewer ${type.name}`}
            disabled={disabled || qty === 0}
            onClick={() => onChange(clamp(qty - 1))}
          >
            <MinusIcon />
          </Button>
          <Input
            aria-label={`Quantity of ${type.name}`}
            inputMode="numeric"
            className="h-8 w-12 text-center tabular-nums"
            disabled={disabled}
            value={qty}
            onChange={(e) => {
              const n = Math.trunc(Number(e.target.value))
              onChange(Number.isFinite(n) ? clamp(n) : 0)
            }}
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`More ${type.name}`}
            disabled={disabled || qty >= max}
            onClick={() => onChange(clamp(qty + 1))}
          >
            <PlusIcon />
          </Button>
        </div>
      </ItemActions>
    </Item>
  )
}
