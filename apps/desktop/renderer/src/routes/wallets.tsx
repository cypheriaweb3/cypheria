import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@cypheria/ui/components/dialog"
import { Field, FieldGroup, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cypheria/ui/components/tabs"
import {
  DragDropContext,
  Draggable,
  type DraggableProvided,
  type DragStart,
  Droppable,
  type DroppableProvided,
  type DropResult,
} from "@hello-pangea/dnd"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Globe2,
  GripVertical,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
  WalletCards,
} from "lucide-react"
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/wallets")({ component: WalletsRoute })

type WalletAction =
  | { kind: "delete"; walletId: string }
  | { kind: "lock"; walletId: string }
  | { kind: "unlock"; walletId: string }
  | {
      kind: "active"
      walletId: string
      walletAccountId: string
      chainAccountId: string
      mode: "read-only" | "human-approval" | "conditional-auto-signing"
    }

type WalletView = Awaited<ReturnType<NonNullable<typeof window.cypheria>["wallet"]["list"]>>[number]
type WalletMode = Extract<WalletAction, { kind: "active" }>["mode"]

const walletKindLabels: Record<WalletView["wallet"]["kind"], string> = {
  hd: "Recovery phrase",
  "private-key": "Private key",
  "private-key-group": "Key group",
  watch: "Watch only",
  "watch-group": "Watch group",
}

const moveItem = <T,>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

function WalletsRoute() {
  const queryClient = useQueryClient()
  const wallets = useQuery({
    queryFn: () => window.cypheria?.wallet.list() ?? [],
    queryKey: ["wallet", "list"],
  })
  const active = useQuery({
    queryFn: () => window.cypheria?.wallet.getActive(),
    queryKey: ["wallet", "active"],
  })
  const [unlocked, setUnlocked] = useState(() => new Set<string>())
  const [orderedWallets, setOrderedWallets] = useState<WalletView[]>([])
  const [expandedWalletIds, setExpandedWalletIds] = useState(() => new Set<string>())
  const [selectedAccountId, setSelectedAccountId] = useState<string>()
  const [selectedWalletId, setSelectedWalletId] = useState<string>()
  useEffect(() => {
    if (!wallets.data) return
    setOrderedWallets(wallets.data)
    setSelectedWalletId((current) => {
      const selected = wallets.data.find(({ wallet }) => wallet.id === current) ?? wallets.data[0]
      setSelectedAccountId((accountId) =>
        selected?.accounts.some(({ account }) => account.id === accountId)
          ? accountId
          : selected?.accounts[0]?.account.id
      )
      return selected?.wallet.id
    })
  }, [wallets.data])

  const reorder = useMutation({
    mutationFn: async (walletIds: string[]) => {
      if (!window.cypheria)
        throw new Error("Wallet management is only available in the desktop app.")
      return window.cypheria.wallet.reorder(walletIds)
    },
    onError: () => setOrderedWallets(wallets.data ?? []),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["wallet", "list"] }),
  })
  const reorderAccounts = useMutation({
    mutationFn: async ({ accountIds, walletId }: { accountIds: string[]; walletId: string }) => {
      if (!window.cypheria)
        throw new Error("Wallet management is only available in the desktop app.")
      return window.cypheria.wallet.reorderAccounts(walletId, accountIds)
    },
    onError: () => setOrderedWallets(wallets.data ?? []),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["wallet", "list"] }),
  })
  const deriveAccount = useMutation({
    mutationFn: async (walletId: string) => {
      if (!window.cypheria)
        throw new Error("Wallet management is only available in the desktop app.")
      return window.cypheria.wallet.deriveHdAccount({ walletId })
    },
    onSuccess: async (view) => {
      setExpandedWalletIds((current) => new Set(current).add(view.wallet.id))
      setSelectedAccountId(view.accounts.at(-1)?.account.id)
      await queryClient.invalidateQueries({ queryKey: ["wallet", "list"] })
    },
  })
  const action = useMutation({
    mutationFn: async (input: WalletAction) => {
      if (!window.cypheria)
        throw new Error("Wallet management is only available in the desktop app.")
      if (input.kind === "delete") return window.cypheria.wallet.delete(input.walletId)
      if (input.kind === "lock") return window.cypheria.wallet.lock(input.walletId)
      if (input.kind === "unlock") return window.cypheria.wallet.unlock(input.walletId)
      const { kind: _, ...context } = input
      return window.cypheria.wallet.setActive(context)
    },
    onSuccess: async (_, input) => {
      if (input.kind === "unlock" || input.kind === "lock")
        setUnlocked((current) => {
          const next = new Set(current)
          if (input.kind === "unlock") next.add(input.walletId)
          else next.delete(input.walletId)
          return next
        })
      await queryClient.invalidateQueries({ queryKey: ["wallet"] })
    },
  })

  const selectedWallet = orderedWallets.find(({ wallet }) => wallet.id === selectedWalletId)

  return (
    <WorkbenchFrame>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <WalletCards className="size-5" />
            Wallets & accounts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize wallets, choose the active account, and control how each wallet can sign.
          </p>
        </div>
        <AddWalletDialog
          onCreated={() => void queryClient.invalidateQueries({ queryKey: ["wallet"] })}
        />
      </header>
      <Alert>
        <ShieldCheck className="size-4" />
        <AlertTitle>Policy-controlled signing</AlertTitle>
        <AlertDescription>
          The active mode scopes requests. Conditional auto-signing still requires an explicit
          matching policy.
        </AlertDescription>
      </Alert>
      {wallets.isLoading ? (
        <Card aria-label="Loading wallets" className="h-72 animate-pulse bg-muted/30" />
      ) : orderedWallets.length ? (
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(280px,0.78fr)_minmax(420px,1.35fr)]">
          <WalletList
            activeAccountId={active.data?.walletAccount?.account.id}
            activeWalletId={active.data?.wallet?.wallet.id}
            accountActionPending={deriveAccount.isPending || reorderAccounts.isPending}
            expandedWalletIds={expandedWalletIds}
            selectedAccountId={selectedAccountId}
            selectedWalletId={selectedWalletId}
            wallets={orderedWallets}
            onAddAccount={(walletId) => deriveAccount.mutate(walletId)}
            onReorderAccounts={(walletId, source, destination) => {
              const view = orderedWallets.find(({ wallet }) => wallet.id === walletId)
              if (!view) return
              const accounts = moveItem(view.accounts, source, destination)
              setOrderedWallets((current) =>
                current.map((item) => (item.wallet.id === walletId ? { ...item, accounts } : item))
              )
              reorderAccounts.mutate({
                accountIds: accounts.map(({ account }) => account.id),
                walletId,
              })
            }}
            onReorder={(source, destination) => {
              const next = moveItem(orderedWallets, source, destination)
              setOrderedWallets(next)
              reorder.mutate(next.map(({ wallet }) => wallet.id))
            }}
            onSelectAccount={(walletId, accountId) => {
              setSelectedWalletId(walletId)
              setSelectedAccountId(accountId)
            }}
            onSelect={(walletId) => {
              setSelectedWalletId(walletId)
              setSelectedAccountId(
                orderedWallets.find(({ wallet }) => wallet.id === walletId)?.accounts[0]?.account.id
              )
            }}
            onToggle={(walletId) =>
              setExpandedWalletIds((current) => {
                const next = new Set(current)
                if (next.has(walletId)) next.delete(walletId)
                else next.add(walletId)
                return next
              })
            }
          />
          {selectedWallet ? (
            <WalletDetails
              active={active.data}
              actionPending={action.isPending}
              unlocked={unlocked.has(selectedWallet.wallet.id)}
              view={selectedWallet}
              selectedAccountId={selectedAccountId}
              onAction={action.mutate}
              onRenamed={() => void queryClient.invalidateQueries({ queryKey: ["wallet"] })}
            />
          ) : null}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No wallets yet</CardTitle>
            <CardDescription>
              Add a watch-only address or create/import a local encrypted wallet.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {wallets.error ? <p className="text-sm text-destructive">{wallets.error.message}</p> : null}
      {action.error ? <p className="text-sm text-destructive">{action.error.message}</p> : null}
      {reorder.error ? <p className="text-sm text-destructive">{reorder.error.message}</p> : null}
      {reorderAccounts.error ? (
        <p className="text-sm text-destructive">{reorderAccounts.error.message}</p>
      ) : null}
      {deriveAccount.error ? (
        <p className="text-sm text-destructive">{deriveAccount.error.message}</p>
      ) : null}
      <DappLauncher />
    </WorkbenchFrame>
  )
}

function WalletList({
  activeAccountId,
  activeWalletId,
  accountActionPending,
  expandedWalletIds,
  selectedAccountId,
  selectedWalletId,
  wallets,
  onAddAccount,
  onReorderAccounts,
  onReorder,
  onSelect,
  onSelectAccount,
  onToggle,
}: Readonly<{
  activeAccountId?: string
  activeWalletId?: string
  accountActionPending: boolean
  expandedWalletIds: Set<string>
  selectedAccountId?: string
  selectedWalletId?: string
  wallets: WalletView[]
  onAddAccount: (walletId: string) => void
  onReorderAccounts: (walletId: string, source: number, destination: number) => void
  onReorder: (source: number, destination: number) => void
  onSelect: (walletId: string) => void
  onSelectAccount: (walletId: string, accountId: string) => void
  onToggle: (walletId: string) => void
}>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: wallets.length,
    estimateSize: () => 76,
    getItemKey: (index) => wallets[index]?.wallet.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 6,
  })
  const [dragIndex, setDragIndex] = useState<number>()

  const handleDragEnd = ({ destination, source }: DropResult) => {
    setDragIndex(undefined)
    if (!destination || destination.index === source.index) return
    onReorder(source.index, destination.index)
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Your wallets</h2>
          <p className="text-xs text-muted-foreground">{wallets.length} total · drag to reorder</p>
        </div>
      </div>
      <div ref={scrollRef} className="h-[min(56vh,560px)] min-h-72 overflow-y-auto p-2">
        <DragDropContext
          onDragEnd={handleDragEnd}
          onDragStart={({ source }: DragStart) => setDragIndex(source.index)}
        >
          <Droppable
            droppableId="wallet-list"
            mode="virtual"
            renderClone={(provided, _snapshot, rubric) => {
              const view = wallets[rubric.source.index] as WalletView
              return (
                <WalletListItem
                  active={view.wallet.id === activeWalletId}
                  activeAccountId={activeAccountId}
                  accountActionPending={accountActionPending}
                  dragging
                  expanded={false}
                  provided={provided}
                  selectedAccountId={selectedAccountId}
                  selected={view.wallet.id === selectedWalletId}
                  view={view}
                  onAddAccount={onAddAccount}
                  onReorderAccounts={onReorderAccounts}
                  onSelect={onSelect}
                  onSelectAccount={onSelectAccount}
                  onToggle={onToggle}
                />
              )
            }}
          >
            {(provided: DroppableProvided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualizer.getVirtualItems().map((virtualItem) => {
                    const view = wallets[virtualItem.index]
                    if (!view) return null
                    return (
                      <Draggable
                        draggableId={view.wallet.id}
                        index={virtualItem.index}
                        key={view.wallet.id}
                      >
                        {(draggableProvided) => (
                          <div
                            className="absolute top-0 left-0 w-full pb-1"
                            data-index={virtualItem.index}
                            ref={virtualizer.measureElement}
                            style={{ transform: `translateY(${virtualItem.start}px)` }}
                          >
                            <WalletListItem
                              active={view.wallet.id === activeWalletId}
                              activeAccountId={activeAccountId}
                              accountActionPending={accountActionPending}
                              dragging={dragIndex === virtualItem.index}
                              expanded={expandedWalletIds.has(view.wallet.id)}
                              provided={draggableProvided}
                              selectedAccountId={selectedAccountId}
                              selected={view.wallet.id === selectedWalletId}
                              view={view}
                              onAddAccount={onAddAccount}
                              onReorderAccounts={onReorderAccounts}
                              onSelect={onSelect}
                              onSelectAccount={onSelectAccount}
                              onToggle={onToggle}
                            />
                          </div>
                        )}
                      </Draggable>
                    )
                  })}
                </div>
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </section>
  )
}

function WalletListItem({
  active,
  activeAccountId,
  accountActionPending,
  dragging,
  expanded,
  provided,
  selectedAccountId,
  selected,
  view,
  onAddAccount,
  onReorderAccounts,
  onSelect,
  onSelectAccount,
  onToggle,
}: Readonly<{
  active: boolean
  activeAccountId?: string
  accountActionPending: boolean
  dragging: boolean
  expanded: boolean
  provided: DraggableProvided
  selectedAccountId?: string
  selected: boolean
  view: WalletView
  onAddAccount: (walletId: string) => void
  onReorderAccounts: (walletId: string, source: number, destination: number) => void
  onSelect: (walletId: string) => void
  onSelectAccount: (walletId: string, accountId: string) => void
  onToggle: (walletId: string) => void
}>) {
  const address = view.accounts[0]?.chainAccounts[0]?.address
  const isGroup =
    view.wallet.kind === "hd" ||
    view.wallet.kind === "private-key-group" ||
    view.wallet.kind === "watch-group"
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      className={`group overflow-hidden rounded-lg border transition-colors ${
        selected ? "border-primary/35 bg-primary/8" : "border-transparent hover:bg-muted/70"
      } ${dragging ? "shadow-lg ring-1 ring-primary/20" : ""}`}
    >
      <div className="flex h-[72px] items-center gap-2 px-2">
        <button
          aria-label={`Reorder ${view.wallet.name}`}
          className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-background hover:text-foreground active:cursor-grabbing group-hover:opacity-100"
          type="button"
          {...provided.dragHandleProps}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          type="button"
          onClick={() => onSelect(view.wallet.id)}
        >
          <WalletAvatar name={view.wallet.name} watchOnly={view.wallet.provider === "read-only"} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{view.wallet.name}</span>
              {active ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {isGroup
                ? `${view.accounts.length} ${view.accounts.length === 1 ? "account" : "accounts"}`
                : (address ?? "No account")}
            </span>
          </span>
        </button>
        {isGroup ? (
          <button
            aria-label={`${expanded ? "Collapse" : "Expand"} ${view.wallet.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
            type="button"
            onClick={() => onToggle(view.wallet.id)}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : null}
      </div>
      {expanded && isGroup ? (
        <WalletAccountList
          accounts={view.accounts}
          activeAccountId={activeAccountId}
          actionPending={accountActionPending}
          selectedAccountId={selectedAccountId}
          walletId={view.wallet.id}
          walletKind={view.wallet.kind}
          onAddAccount={onAddAccount}
          onReorder={onReorderAccounts}
          onSelect={onSelectAccount}
        />
      ) : null}
    </div>
  )
}

type WalletAccountView = WalletView["accounts"][number]

function WalletAccountList({
  accounts,
  activeAccountId,
  actionPending,
  selectedAccountId,
  walletId,
  walletKind,
  onAddAccount,
  onReorder,
  onSelect,
}: Readonly<{
  accounts: WalletAccountView[]
  activeAccountId?: string
  actionPending: boolean
  selectedAccountId?: string
  walletId: string
  walletKind: WalletView["wallet"]["kind"]
  onAddAccount: (walletId: string) => void
  onReorder: (walletId: string, source: number, destination: number) => void
  onSelect: (walletId: string, accountId: string) => void
}>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: accounts.length,
    estimateSize: () => 60,
    getItemKey: (index) => accounts[index]?.account.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 5,
  })
  const [dragIndex, setDragIndex] = useState<number>()
  const listHeight = Math.min(Math.max(accounts.length * 60, 60), 300)

  return (
    <div className="border-t bg-muted/25 px-2 pt-2 pb-2">
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-[11px] font-medium text-muted-foreground">Accounts</span>
        {walletKind === "hd" ? (
          <Button
            className="h-7 gap-1 px-2 text-xs"
            disabled={actionPending}
            size="sm"
            variant="ghost"
            onClick={() => onAddAccount(walletId)}
          >
            <Plus className="size-3.5" />
            Add account
          </Button>
        ) : null}
      </div>
      <div
        className="overflow-y-auto rounded-md border bg-background/70"
        ref={scrollRef}
        style={{ height: listHeight }}
      >
        <DragDropContext
          onDragEnd={({ destination, source }: DropResult) => {
            setDragIndex(undefined)
            if (!destination || destination.index === source.index) return
            onReorder(walletId, source.index, destination.index)
          }}
          onDragStart={({ source }: DragStart) => setDragIndex(source.index)}
        >
          <Droppable
            droppableId={`wallet-accounts-${walletId}`}
            mode="virtual"
            renderClone={(provided, _snapshot, rubric) => {
              const account = accounts[rubric.source.index] as WalletAccountView
              return (
                <WalletAccountListItem
                  account={account}
                  active={account.account.id === activeAccountId}
                  dragging
                  provided={provided}
                  selected={account.account.id === selectedAccountId}
                  walletId={walletId}
                  onSelect={onSelect}
                />
              )
            }}
          >
            {(provided: DroppableProvided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualizer.getVirtualItems().map((virtualItem) => {
                    const account = accounts[virtualItem.index]
                    if (!account) return null
                    return (
                      <Draggable
                        draggableId={account.account.id}
                        index={virtualItem.index}
                        key={account.account.id}
                      >
                        {(draggableProvided) => (
                          <div
                            className="absolute top-0 left-0 w-full"
                            data-index={virtualItem.index}
                            ref={virtualizer.measureElement}
                            style={{ transform: `translateY(${virtualItem.start}px)` }}
                          >
                            <WalletAccountListItem
                              account={account}
                              active={account.account.id === activeAccountId}
                              dragging={dragIndex === virtualItem.index}
                              provided={draggableProvided}
                              selected={account.account.id === selectedAccountId}
                              walletId={walletId}
                              onSelect={onSelect}
                            />
                          </div>
                        )}
                      </Draggable>
                    )
                  })}
                </div>
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </div>
  )
}

function WalletAccountListItem({
  account,
  active,
  dragging,
  provided,
  selected,
  walletId,
  onSelect,
}: Readonly<{
  account: WalletAccountView
  active: boolean
  dragging: boolean
  provided: DraggableProvided
  selected: boolean
  walletId: string
  onSelect: (walletId: string, accountId: string) => void
}>) {
  const chainAccount = account.chainAccounts[0]
  return (
    <div
      className={`flex h-[60px] items-center gap-1 border-b px-1 last:border-b-0 ${
        selected ? "bg-primary/8" : "hover:bg-muted/60"
      } ${dragging ? "shadow-md ring-1 ring-primary/20" : ""}`}
      ref={provided.innerRef}
      {...provided.draggableProps}
    >
      <button
        aria-label={`Reorder ${account.account.name}`}
        className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 active:cursor-grabbing"
        type="button"
        {...provided.dragHandleProps}
      >
        <GripVertical className="size-3.5" />
      </button>
      <button
        className="min-w-0 flex-1 px-1 text-left"
        type="button"
        onClick={() => onSelect(walletId, account.account.id)}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <span className="truncate">{account.account.name}</span>
          {active ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
        </span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">
          {chainAccount?.derivationPath ?? chainAccount?.address ?? "No chain account"}
        </span>
      </button>
    </div>
  )
}

function WalletAvatar({ name, watchOnly }: Readonly<{ name: string; watchOnly: boolean }>) {
  const palette = [
    "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ]
  const color = palette[(name.codePointAt(0) ?? 0) % palette.length]
  return (
    <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${color}`}>
      {watchOnly ? <Eye className="size-4" /> : <WalletCards className="size-4" />}
    </span>
  )
}

function WalletDetails({
  active,
  actionPending,
  selectedAccountId,
  unlocked,
  view,
  onAction,
  onRenamed,
}: Readonly<{
  active:
    | Awaited<ReturnType<NonNullable<typeof window.cypheria>["wallet"]["getActive"]>>
    | undefined
  actionPending: boolean
  selectedAccountId?: string
  unlocked: boolean
  view: WalletView
  onAction: (action: WalletAction) => void
  onRenamed: () => void
}>) {
  const isActive = active?.wallet?.wallet.id === view.wallet.id
  const displayedAccounts = selectedAccountId
    ? view.accounts.filter(({ account }) => account.id === selectedAccountId)
    : view.accounts.slice(0, 1)
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate">{view.wallet.name}</CardTitle>
              {isActive ? <Badge>Active</Badge> : null}
              <Badge variant="outline">{walletKindLabels[view.wallet.kind]}</Badge>
            </div>
            <CardDescription className="mt-1">
              {view.accounts.length} {view.accounts.length === 1 ? "account" : "accounts"} ·{" "}
              {view.wallet.status}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <RenameWalletDialog view={view} onRenamed={onRenamed} />
            {view.wallet.provider === "local-vault" ? (
              <Button
                aria-label={unlocked ? `Lock ${view.wallet.name}` : `Unlock ${view.wallet.name}`}
                disabled={actionPending}
                size="icon-sm"
                variant="ghost"
                onClick={() =>
                  onAction({ kind: unlocked ? "lock" : "unlock", walletId: view.wallet.id })
                }
              >
                {unlocked ? <LockKeyhole /> : <UnlockKeyhole />}
              </Button>
            ) : null}
            <Button
              aria-label={`Delete ${view.wallet.name}`}
              disabled={actionPending}
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                if (globalThis.confirm(`Delete ${view.wallet.name}? This cannot be undone.`))
                  onAction({ kind: "delete", walletId: view.wallet.id })
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        {displayedAccounts.map(({ account, chainAccounts }) => (
          <div className="overflow-hidden rounded-lg border" key={account.id}>
            <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">{account.name}</span>
              <span className="text-xs text-muted-foreground">Account {account.index + 1}</span>
            </div>
            <div className="divide-y">
              {chainAccounts.map((chainAccount) => {
                const accountIsActive = active?.chainAccount?.id === chainAccount.id
                const defaultMode =
                  view.wallet.provider === "read-only" ? "read-only" : "human-approval"
                return (
                  <div className="grid gap-3 p-3" key={chainAccount.id}>
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-medium">
                          Ethereum · Chain {chainAccount.chainId}
                          {accountIsActive ? (
                            <Badge variant="secondary">
                              <Check />
                              In use
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {chainAccount.address}
                          </span>
                          <CopyAddressButton address={chainAccount.address} />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Activation mode</span>
                      <Select
                        value={accountIsActive ? active.mode : defaultMode}
                        onValueChange={(mode) =>
                          onAction({
                            chainAccountId: chainAccount.id,
                            kind: "active",
                            mode: mode as WalletMode,
                            walletAccountId: account.id,
                            walletId: view.wallet.id,
                          })
                        }
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read-only">Read only</SelectItem>
                          {view.wallet.provider !== "read-only" ? (
                            <>
                              <SelectItem value="human-approval">Ask every time</SelectItem>
                              <SelectItem value="conditional-auto-signing">Use policy</SelectItem>
                            </>
                          ) : null}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Secret material stays in Electron main and the encrypted vault. This page only receives
          public wallet and account data.
        </p>
      </CardContent>
    </Card>
  )
}

function CopyAddressButton({ address }: Readonly<{ address: string }>) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      aria-label="Copy address"
      className="size-6"
      size="icon-sm"
      type="button"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true)
          globalThis.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  )
}

function RenameWalletDialog({
  view,
  onRenamed,
}: Readonly<{ view: WalletView; onRenamed: () => void }>) {
  const [open, setOpen] = useState(false)
  const rename = useMutation({
    mutationFn: async (name: string) => {
      if (!window.cypheria)
        throw new Error("Wallet management is only available in the desktop app.")
      return window.cypheria.wallet.rename(view.wallet.id, name)
    },
    onSuccess: () => {
      setOpen(false)
      onRenamed()
    },
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button aria-label={`Rename ${view.wallet.name}`} size="icon-sm" variant="ghost">
            <Pencil />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename wallet</DialogTitle>
          <DialogDescription>
            Choose a name that makes this wallet easy to recognize.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            rename.mutate(String(new FormData(event.currentTarget).get("name") ?? ""))
          }}
        >
          <Field>
            <FieldLabel>Wallet name</FieldLabel>
            <Input autoFocus defaultValue={view.wallet.name} maxLength={128} name="name" required />
          </Field>
          <Button disabled={rename.isPending} type="submit">
            {rename.isPending ? "Saving…" : "Save name"}
          </Button>
          {rename.error ? <p className="text-sm text-destructive">{rename.error.message}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddWalletDialog({ onCreated }: Readonly<{ onCreated: () => void }>) {
  const [open, setOpen] = useState(false)
  const create = useMutation({
    mutationFn: async ({ kind, values }: { kind: string; values: FormData }) => {
      if (!window.cypheria)
        throw new Error("Wallet management is only available in the desktop app.")
      const name = String(values.get("name") ?? "")
      if (kind === "generate") return window.cypheria.wallet.generateHd({ name })
      if (kind === "watch")
        return window.cypheria.wallet.addWatch({
          address: String(values.get("address") ?? "") as `0x${string}`,
          name,
        })
      if (kind === "mnemonic")
        return window.cypheria.wallet.importHd({
          mnemonic: String(values.get("mnemonic") ?? ""),
          name,
          ...(values.get("passphrase") ? { passphrase: String(values.get("passphrase")) } : {}),
        })
      return window.cypheria.wallet.importPrivateKey({
        name,
        privateKey: String(values.get("privateKey") ?? "") as `0x${string}`,
      })
    },
    onSuccess: () => {
      setOpen(false)
      onCreated()
    },
  })
  const submit = (kind: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    create.mutate({ kind, values: new FormData(form) })
    form.reset()
  }
  const form = (kind: string, fields: ReactNode) => (
    <form className="grid gap-4 pt-4" onSubmit={submit(kind)}>
      <FieldGroup>
        <Field>
          <FieldLabel>Wallet name</FieldLabel>
          <Input name="name" required />
        </Field>
        {fields}
      </FieldGroup>
      <Button disabled={create.isPending} type="submit">
        {create.isPending ? "Saving…" : "Continue"}
      </Button>
    </form>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            Add wallet
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add wallet</DialogTitle>
          <DialogDescription>
            Local secrets cross typed IPC once and are encrypted immediately by the OS-backed vault.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="watch">
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="watch">
              <Eye className="size-4" />
              Watch
            </TabsTrigger>
            <TabsTrigger value="generate">
              <WalletCards className="size-4" />
              Create
            </TabsTrigger>
            <TabsTrigger value="mnemonic">
              <KeyRound className="size-4" />
              Phrase
            </TabsTrigger>
            <TabsTrigger value="key">
              <KeyRound className="size-4" />
              Key
            </TabsTrigger>
          </TabsList>
          <TabsContent value="watch">
            {form(
              "watch",
              <Field>
                <FieldLabel>Address</FieldLabel>
                <Input name="address" placeholder="0x…" required />
              </Field>
            )}
          </TabsContent>
          <TabsContent value="generate">
            {form(
              "generate",
              <p className="text-sm text-muted-foreground">
                Creates a new HD wallet directly inside the encrypted local vault.
              </p>
            )}
          </TabsContent>
          <TabsContent value="mnemonic">
            {form(
              "mnemonic",
              <>
                <Field>
                  <FieldLabel>Recovery phrase</FieldLabel>
                  <Input name="mnemonic" autoComplete="off" required />
                </Field>
                <Field>
                  <FieldLabel>Optional passphrase</FieldLabel>
                  <Input name="passphrase" type="password" autoComplete="off" />
                </Field>
              </>
            )}
          </TabsContent>
          <TabsContent value="key">
            {form(
              "key",
              <Field>
                <FieldLabel>Private key</FieldLabel>
                <Input
                  name="privateKey"
                  type="password"
                  autoComplete="off"
                  placeholder="0x…"
                  required
                />
              </Field>
            )}
          </TabsContent>
        </Tabs>
        {create.error ? <p className="text-sm text-destructive">{create.error.message}</p> : null}
      </DialogContent>
    </Dialog>
  )
}

function DappLauncher() {
  const [url, setUrl] = useState("")
  const open = useMutation({
    mutationFn: async () => {
      if (!window.cypheria)
        throw new Error("The dApp browser is only available in the desktop app.")
      return window.cypheria.browser.openDapp(new URL(url).toString())
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe2 className="size-4" />
          Isolated dApp session
        </CardTitle>
        <CardDescription>
          Each origin receives a separate session and explicit wallet permissions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            open.mutate()
          }}
        >
          <Input
            placeholder="https://app.example"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <Button type="submit">Open</Button>
        </form>
        {open.error ? <p className="mt-3 text-sm text-destructive">{open.error.message}</p> : null}
      </CardContent>
    </Card>
  )
}
