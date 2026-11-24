import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { EquipmentClassIcon } from "@/components/EquipmentClassIcon"
import { toast } from "sonner"
import { EmptyState, PageHeader, QueryView } from "@/components/common"
import { EquipmentTypeDialog } from "@/components/admin/EquipmentTypeDialog"
import { FormDialog, RequirePerm, StatusBadge } from "@/components/admin/shared"
import { toastSaved } from "@/components/admin/formHelpers"
import {
  type EquipmentClass,
  LabeledField,
  LevelSelect,
  NONE,
  SimpleSelect,
  SwitchField,
  TextAreaField,
  TextField,
  useClasses,
  useForm,
} from "@/components/admin/pickers"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, unwrap } from "@/lib/api"
import { useCan } from "@/lib/auth"
import { humanize } from "@/lib/format"

export function InventoryPage() {
  return (
    <RequirePerm perm="inventory.manage" title="Inventory">
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Inventory"
          description="Equipment types, the classes that gate them by level, and their stock."
        />
        <Tabs defaultValue="types">
          <TabsList>
            <TabsTrigger value="types">Types</TabsTrigger>
            <TabsTrigger value="classes">Classes</TabsTrigger>
          </TabsList>
          <TabsContent value="types" className="pt-4">
            <TypesTab />
          </TabsContent>
          <TabsContent value="classes" className="pt-4">
            <ClassesTab />
          </TabsContent>
        </Tabs>
      </div>
    </RequirePerm>
  )
}

function TypesTab() {
  const can = useCan()
  const [classFilter, setClassFilter] = useState(NONE)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState("")
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  const classes = useClasses()
  const types = useQuery({
    queryKey: ["equipment", "types", { showInactive }],
    queryFn: () =>
      unwrap(
        api.equipment.types.$get({
          query: showInactive ? { includeInactive: "1" } : {},
        })
      ),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <InputGroup className="w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search equipment types"
              placeholder="Search name, brand, model"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
          <div className="flex w-56 flex-col gap-2">
            <LabeledField label="Class" htmlFor="filter-class">
              <SimpleSelect
                id="filter-class"
                value={classFilter}
                onValueChange={setClassFilter}
                options={(classes.data ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                allLabel="All classes"
                placeholder="All classes"
              />
            </LabeledField>
          </div>
          <SwitchField
            id="show-inactive"
            label="Show inactive"
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
          <SwitchField
            id="attention-only"
            label="Needs attention (damaged, in repair, lost)"
            checked={attentionOnly}
            onCheckedChange={setAttentionOnly}
          />
        </div>
        {can("inventory.manage") && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            New type
          </Button>
        )}
      </div>

      <QueryView query={types}>
        {(rows) => {
          const q = search.trim().toLowerCase()
          const shown = rows.filter(
            (t) =>
              (classFilter === NONE || t.classId === classFilter) &&
              (!q ||
                `${t.name} ${t.manufacturer} ${t.model}`
                  .toLowerCase()
                  .includes(q)) &&
              (!attentionOnly ||
                t.counts.damaged + t.counts.in_repair + t.counts.lost > 0)
          )
          if (shown.length === 0)
            return (
              <EmptyState
                title="No equipment types"
                description={
                  rows.length === 0
                    ? "Create a type to start tracking equipment."
                    : "Nothing matches these filters."
                }
              />
            )
          return (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Min level</TableHead>
                    <TableHead>Tracking</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">In use</TableHead>
                    <TableHead className="text-right">Damaged</TableHead>
                    <TableHead className="text-right">In repair</TableHead>
                    <TableHead className="text-right">Lost</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <Link
                          to={`/admin/inventory/${t.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {t.name}
                        </Link>
                        {(t.manufacturer || t.model) && (
                          <div className="text-xs text-muted-foreground">
                            {[t.manufacturer, t.model]
                              .filter(Boolean)
                              .join(" ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <EquipmentClassIcon name={t.class.name} size="sm" />
                          {t.class.name}
                        </span>
                      </TableCell>
                      <TableCell>{t.minLevel.name}</TableCell>
                      <TableCell>{humanize(t.tracking)}</TableCell>
                      <TableCell>
                        <StatusBadge status={t.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.counts.available}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.counts.in_use}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.counts.damaged}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.counts.in_repair}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.counts.lost}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.counts.total}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }}
      </QueryView>

      {creating && <EquipmentTypeDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function ClassesTab() {
  const can = useCan()
  const [editing, setEditing] = useState<EquipmentClass | "new" | null>(null)
  const classes = useClasses()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        {can("inventory.manage") && (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon data-icon="inline-start" />
            New class
          </Button>
        )}
      </div>
      <QueryView query={classes}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              title="No equipment classes"
              description="Classes group types and set the minimum level needed to book them."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Min level</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.minLevel.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.description}
                      </TableCell>
                      <TableCell className="text-right">
                        {can("inventory.manage") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${c.name}`}
                            onClick={() => setEditing(c)}
                          >
                            <PencilIcon data-icon="inline-start" />
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryView>
      {editing !== null && (
        <ClassDialog
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ClassDialog({
  initial,
  onClose,
}: {
  initial?: EquipmentClass
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, set] = useForm({
    name: initial?.name ?? "",
    minLevelId: initial?.minLevel.id ?? "",
    description: initial?.description ?? "",
  })
  const save = useMutation({
    mutationFn: () => {
      const json = {
        name: v.name.trim(),
        minLevelId: v.minLevelId,
        description: v.description.trim(),
      }
      return initial
        ? unwrap(
            api.equipment.classes[":id"].$patch({
              param: { id: initial.id },
              json,
            })
          )
        : unwrap(api.equipment.classes.$post({ json }))
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["equipment"] })
      if (initial)
        toastSaved(
          "Equipment class saved.",
          "flaggedEvents" in res ? res.flaggedEvents : undefined
        )
      else toast.success("Equipment class created.")
      onClose()
    },
  })
  return (
    <FormDialog
      title={initial ? "Edit equipment class" : "New equipment class"}
      description="The minimum level applies to every type in the class. Changing it re-checks open events."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      error={save.error}
      submitDisabled={!v.name.trim() || !v.minLevelId}
    >
      <TextField
        id="class-name"
        label="Name"
        value={v.name}
        onChange={(x) => set("name", x)}
        required
      />
      <LabeledField label="Minimum level" htmlFor="class-level">
        <LevelSelect
          id="class-level"
          value={v.minLevelId}
          onValueChange={(x) => set("minLevelId", x)}
        />
      </LabeledField>
      <TextAreaField
        id="class-description"
        label="Description"
        value={v.description}
        onChange={(x) => set("description", x)}
      />
    </FormDialog>
  )
}
