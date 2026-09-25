import type {
  AttachmentInspectionEntry,
  KeyValueInspectionEntry,
  ReplicaInspectionEntry,
  StoragePage,
  StoragePageRequest,
} from "@cypheria/storage"
import { cn } from "@cypheria/ui"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cypheria/ui/components/table"
import { useQuery } from "@tanstack/react-query"
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import {
  Binary,
  Braces,
  ChevronLeft,
  ChevronRight,
  Database,
  RefreshCw,
  Search,
} from "lucide-react"
import { type ReactNode, useDeferredValue, useState } from "react"

import { desktopClientStorage, openDesktopClientStorage } from "../storage.js"

const PAGE_SIZE = 30

type StorageKind = "key-value" | "replica" | "attachments"

const storageSections = [
  {
    description: "Small persistent UI values",
    icon: Braces,
    id: "key-value",
    label: "Key/value state",
  },
  {
    description: "Rebuildable semantic rows",
    icon: Database,
    id: "replica",
    label: "Replica database",
  },
  {
    description: "Opaque binary objects",
    icon: Binary,
    id: "attachments",
    label: "Attachment bytes",
  },
] as const

const Preview = ({
  children,
  truncated,
}: Readonly<{ children: ReactNode; truncated?: boolean }>) => (
  <div className="max-w-[680px] whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-muted-foreground line-clamp-2">
    {children}
    {truncated ? <span className="text-foreground">…</span> : null}
  </div>
)

const keyValueColumns: ColumnDef<KeyValueInspectionEntry>[] = [
  {
    accessorKey: "key",
    header: "Key",
    cell: ({ row }) => (
      <code className="break-all text-xs font-medium text-foreground">{row.original.key}</code>
    ),
  },
  {
    accessorKey: "valueLength",
    header: "Characters",
    cell: ({ row }) => <span className="tabular-nums">{row.original.valueLength}</span>,
  },
  {
    accessorKey: "valuePreview",
    header: "Value preview",
    cell: ({ row }) => (
      <Preview truncated={row.original.valueTruncated}>{row.original.valuePreview || "∅"}</Preview>
    ),
  },
]

const replicaColumns: ColumnDef<ReplicaInspectionEntry>[] = [
  {
    accessorKey: "scopeId",
    header: "Scope",
    cell: ({ row }) => <code className="text-xs">{row.original.scopeId}</code>,
  },
  {
    accessorKey: "entityType",
    header: "Entity type",
    cell: ({ row }) => <Badge variant="outline">{row.original.entityType}</Badge>,
  },
  {
    accessorKey: "entityId",
    header: "Entity ID",
    cell: ({ row }) => <code className="text-xs">{row.original.entityId}</code>,
  },
  {
    accessorKey: "payloadLength",
    header: "Characters",
    cell: ({ row }) => <span className="tabular-nums">{row.original.payloadLength}</span>,
  },
  {
    accessorKey: "payloadPreview",
    header: "Payload preview",
    cell: ({ row }) => (
      <Preview truncated={row.original.payloadTruncated}>
        {row.original.payloadPreview || "∅"}
      </Preview>
    ),
  },
]

const formatByteSize = (value: number): string => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

const formatHexPreview = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ")

const attachmentColumns: ColumnDef<AttachmentInspectionEntry>[] = [
  {
    accessorKey: "storageKey",
    header: "Storage key",
    cell: ({ row }) => (
      <code className="break-all text-xs font-medium">{row.original.storageKey}</code>
    ),
  },
  {
    accessorKey: "storageType",
    header: "Backend",
    cell: ({ row }) => <Badge variant="outline">{row.original.storageType}</Badge>,
  },
  {
    accessorKey: "byteSize",
    header: "Size",
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatByteSize(row.original.byteSize)}
      </span>
    ),
  },
  {
    id: "bytePreview",
    header: "First 32 bytes",
    cell: ({ row }) => (
      <Preview truncated={row.original.byteSize > row.original.bytePreview.byteLength}>
        {formatHexPreview(row.original.bytePreview)}
      </Preview>
    ),
  },
]

export default function DebugStorage() {
  const [storageKind, setStorageKind] = useState<StorageKind>("key-value")

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground max-[860px]:h-[calc(100vh-48px)]">
      <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-border px-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Storage debug</h1>
            <Badge className="text-[10px]" variant="secondary">
              Development only
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Read-only inspection of Desktop-local persistence.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[232px] shrink-0 border-r border-border bg-muted/15 p-3">
          <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Stores
          </p>
          <nav aria-label="Storage debug sections" className="grid gap-1">
            {storageSections.map((section) => {
              const Icon = section.icon
              const active = storageKind === section.id
              return (
                <button
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    active
                      ? "bg-accent text-accent-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                  key={section.id}
                  onClick={() => setStorageKind(section.id)}
                  type="button"
                >
                  <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{section.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-3.5 opacity-75">
                      {section.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 overflow-hidden p-5">
          {storageKind === "key-value" ? <KeyValueBrowser /> : null}
          {storageKind === "replica" ? <ReplicaBrowser /> : null}
          {storageKind === "attachments" ? <AttachmentBrowser /> : null}
        </section>
      </div>
    </main>
  )
}

function KeyValueBrowser() {
  return (
    <StorageBrowser
      columns={keyValueColumns}
      description="Searches key names. Values are capped at a 240-character preview."
      getRowId={(row) => row.key}
      queryKey="key-value"
      searchPlaceholder="Search key names"
      title="Key/value state"
      load={(request) => desktopClientStorage.keyValue.listPage(request)}
    />
  )
}

function ReplicaBrowser() {
  return (
    <StorageBrowser
      columns={replicaColumns}
      description="Searches row keys and payload text. Payloads are capped at a 240-character preview."
      getRowId={(row) => `${row.scopeId}:${row.entityType}:${row.entityId}`}
      queryKey="replica"
      searchPlaceholder="Search scope, entity, ID, or payload"
      title="Replica database"
      load={async (request) => {
        const storage = await openDesktopClientStorage()
        return storage.replica.listPage(request)
      }}
    />
  )
}

function AttachmentBrowser() {
  return (
    <StorageBrowser
      columns={attachmentColumns}
      description="Searches opaque storage keys. Only file metadata and the first 32 bytes are read."
      getRowId={(row) => row.storageKey}
      queryKey="attachments"
      searchPlaceholder="Search storage keys"
      title="Attachment bytes"
      load={(request) => desktopClientStorage.attachments.listPage(request)}
    />
  )
}

function StorageBrowser<Item>({
  columns,
  description,
  getRowId,
  load,
  queryKey,
  searchPlaceholder,
  title,
}: Readonly<{
  columns: ColumnDef<Item>[]
  description: string
  getRowId: (item: Item) => string
  load: (request: StoragePageRequest) => Promise<StoragePage<Item>>
  queryKey: string
  searchPlaceholder: string
  title: string
}>) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query.trim())
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const cursor = cursors.at(-1) ?? null
  const page = useQuery({
    queryFn: () => load({ cursor, limit: PAGE_SIZE, query: deferredQuery || undefined }),
    queryKey: ["debug", "storage", queryKey, deferredQuery, cursor],
  })
  const rows = page.data?.items ?? []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-[300px] max-w-[42vw]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={searchPlaceholder}
              className="h-8 rounded-lg pl-8 text-xs"
              onChange={(event) => {
                setQuery(event.target.value)
                setCursors([null])
              }}
              placeholder={searchPlaceholder}
              type="search"
              value={query}
            />
          </div>
          <Button
            aria-label={`Refresh ${title}`}
            disabled={page.isFetching}
            onClick={() => void page.refetch()}
            size="icon-sm"
            variant="outline"
          >
            <RefreshCw className={cn("size-3.5", page.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {page.isPending ? (
          <div className="grid gap-2 p-4">
            {["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"].map(
              (key) => (
                <Skeleton className="h-9 w-full rounded-md" key={key} />
              )
            )}
          </div>
        ) : page.error ? (
          <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
            {page.error.message}
          </div>
        ) : (
          <DataTable columns={columns} data={rows} getRowId={getRowId} />
        )}
      </div>

      <footer className="flex h-12 shrink-0 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground">
        <span>
          Page {cursors.length} · {rows.length} row{rows.length === 1 ? "" : "s"}
          {page.data?.nextCursor ? " · more available" : ""}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            disabled={cursors.length === 1 || page.isFetching}
            onClick={() => setCursors((current) => current.slice(0, -1))}
            size="sm"
            variant="outline"
          >
            <ChevronLeft className="size-3.5" />
            Previous
          </Button>
          <Button
            disabled={!page.data?.nextCursor || page.isFetching}
            onClick={() => {
              const nextCursor = page.data?.nextCursor
              if (nextCursor) setCursors((current) => [...current, nextCursor])
            }}
            size="sm"
            variant="outline"
          >
            Next
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </footer>
    </div>
  )
}

function DataTable<Item>({
  columns,
  data,
  getRowId,
}: Readonly<{
  columns: ColumnDef<Item>[]
  data: readonly Item[]
  getRowId: (item: Item) => string
}>) {
  const table = useReactTable({
    columns,
    data: [...data],
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  })

  return (
    <Table className="table-fixed text-xs">
      <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead className="h-9 text-[11px] text-muted-foreground" key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell className="h-10 max-w-[680px] overflow-hidden px-2 py-1.5" key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell className="h-40 text-center text-muted-foreground" colSpan={columns.length}>
              No matching records
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
