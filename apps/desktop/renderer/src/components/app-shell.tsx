/// <reference types="vite/client" />

import type { AgentCatalogEntry, AgentId, AgentView } from "@cypheria/protocol"
import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@cypheria/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Input } from "@cypheria/ui/components/input"
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@cypheria/ui/components/sidebar"
import { TooltipProvider } from "@cypheria/ui/components/tooltip"
import { msg } from "@lingui/core/macro"
import { I18nProvider, useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Provider as JotaiProvider } from "jotai"
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  LoaderCircle,
  MoreHorizontal,
  Palette,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react"
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useAppearanceController } from "../appearance.js"
import { ensureCypheriaClient } from "../cypheria-client.js"
import { activateLanguage, getBootstrapLanguage, i18n } from "../i18n.js"
import { web3Api } from "../web3-api.js"
import { NewChatLink } from "./chat-navigation"
import { ChatSearch } from "./chat-search"
import { ChatSidebar } from "./chat-sidebar"
import {
  DESKTOP_SIDEBAR_DEFAULT_WIDTH,
  DesktopCollapsedToolbar,
  DesktopSidebar as Sidebar,
  DesktopSidebarProvider as SidebarProvider,
  DesktopSidebarTrigger as SidebarTrigger,
} from "./desktop-sidebar"
import { HarnessIcon } from "./harness-icon"
import { createInMemorySearch, resolveAvailableHarnessId } from "./harness-selection"
import { buildSettingsNavigationRows } from "./settings-navigation-model"

const navigationItems = [
  {
    href: "/",
    icon: <SquarePen className="size-4" strokeWidth={1.9} />,
    kind: "new-chat",
    label: msg({ id: "navigation.newChat", message: "New chat" }),
  },
  {
    href: "/",
    icon: <Search className="size-4" strokeWidth={1.9} />,
    kind: "search",
    label: msg({ id: "navigation.search", message: "Search" }),
  },
] as const

const settingsItems = [
  {
    group: "personal",
    href: "/settings/general",
    icon: <Settings className="size-4" strokeWidth={1.9} />,
    label: msg({ id: "settings.general", message: "General" }),
  },
  {
    group: "personal",
    href: "/settings/appearance",
    icon: <Palette className="size-4" strokeWidth={1.9} />,
    label: msg({ id: "settings.appearance", message: "Appearance" }),
  },
  {
    group: "personal",
    href: "/settings/git",
    icon: <GitBranch className="size-4" strokeWidth={1.9} />,
    label: msg({ id: "settings.git", message: "Git" }),
  },
  {
    group: "integrations",
    href: "/settings/plugins",
    icon: <Boxes className="size-4" strokeWidth={1.9} />,
    label: msg({ id: "settings.plugins", message: "Plugins" }),
  },
  {
    group: "archived",
    href: "/settings/archived",
    icon: <Archive className="size-4" strokeWidth={1.9} />,
    label: msg({ id: "settings.archived", message: "Archived chats" }),
  },
] as const

const settingsGroups = [
  {
    id: "personal",
    label: msg({ id: "settings.group.personal", message: "Personal" }),
  },
  {
    id: "integrations",
    label: msg({ id: "settings.group.integrations", message: "Integrations" }),
  },
  {
    id: "archived",
    label: msg({ id: "settings.group.archived", message: "Archived" }),
  },
] as const

type HarnessNavigationAgent = Pick<AgentView, "enabled" | "icon" | "id" | "installed" | "name">

const nativeHarnessNavigationAgents: HarnessNavigationAgent[] = [
  { enabled: false, icon: null, id: "codex", installed: false, name: "Codex" },
  { enabled: false, icon: null, id: "claude", installed: false, name: "Claude" },
  { enabled: false, icon: null, id: "pi", installed: false, name: "Pi" },
  { enabled: false, icon: null, id: "opencode", installed: false, name: "OpenCode" },
]

const desktopSidebarContentClassName = "min-h-0 overflow-hidden px-1.5 pb-3 pt-0.5"
export default function AppRoot() {
  return (
    <RootLayout>
      <Outlet />
    </RootLayout>
  )
}

function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <RootDocument>
      <I18nProvider i18n={i18n}>
        <QueryProvider>
          <AppShell>{children}</AppShell>
        </QueryProvider>
      </I18nProvider>
    </RootDocument>
  )
}

function QueryProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 10_000,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceController />
      <LanguageController />
      {children}
    </QueryClientProvider>
  )
}

function LanguageController() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const cypheria = window.cypheria
    activateLanguage(getBootstrapLanguage())
    if (!cypheria) return

    return cypheria.settings.onLanguageChanged((settings) => {
      activateLanguage(settings)
      queryClient.setQueryData(["settings", "language"], settings)
    })
  }, [queryClient])

  return null
}

function AppearanceController() {
  useAppearanceController()
  return null
}

function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { i18n: activeI18n } = useLingui()
  const location = useLocation()
  const { pathname } = location
  const activeThreadId =
    pathname === "/" && typeof location.search.thread === "string"
      ? location.search.thread
      : undefined
  const isSettings = pathname.startsWith("/settings")
  const approvalsQuery = useQuery({
    queryFn: () => web3Api.approval.list("pending") ?? [],
    queryKey: ["approval", "pending"],
    refetchInterval: 5_000,
  })
  const platform = getDesktopPlatform()
  const isWindows = platform === "win32"
  const windowControlRowClassName = cn(
    "flex min-h-[44px] flex-row items-center gap-2.5 px-3 py-2 pl-[88px] [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
    isWindows && "gap-[18px] px-3 pb-2 pt-3 pl-3.5"
  )
  const chromeIconButtonClassName =
    "desktop-chrome-button text-muted-foreground disabled:opacity-35"

  return (
    <TooltipProvider>
      <SidebarProvider
        className="h-screen w-screen overflow-hidden bg-background"
        data-settings={isSettings ? "true" : undefined}
        data-platform={platform}
        style={
          {
            "--sidebar-width": `${DESKTOP_SIDEBAR_DEFAULT_WIDTH}px`,
            "--sidebar-width-icon": "52px",
          } as CSSProperties
        }
        suppressHydrationWarning
      >
        {isSettings ? (
          <SettingsNavigation
            headerClassName={windowControlRowClassName}
            isWindows={isWindows}
            pathname={pathname}
            triggerClassName={chromeIconButtonClassName}
          />
        ) : (
          <Sidebar className="border-r border-sidebar-border" collapsible="icon">
            <DesktopSidebarHeader
              className={windowControlRowClassName}
              isWindows={isWindows}
              triggerClassName={chromeIconButtonClassName}
            />

            <SidebarContent className={desktopSidebarContentClassName}>
              <SidebarGroup className="shrink-0 px-1 py-0">
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navigationItems.map((item) => {
                      const label = activeI18n._(item.label)
                      return (
                        <SidebarMenuItem key={item.kind}>
                          {item.kind === "search" ? (
                            <ChatSearch />
                          ) : (
                            <SidebarMenuButton
                              render={
                                <NavigationLink item={item}>
                                  {item.icon}
                                  <span>{label}</span>
                                </NavigationLink>
                              }
                              tooltip={label}
                            />
                          )}
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <ChatSidebar
                activeThreadId={activeThreadId}
                pendingCount={approvalsQuery.data?.length ?? 0}
              />
            </SidebarContent>

            <SidebarFooter className="min-h-[58px] px-1.5 pb-3 pt-2.5">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={
                      <Link to="/settings/general">
                        <Settings aria-hidden="true" className="size-4" strokeWidth={1.9} />
                        <span>
                          <Trans id="settings.title">Settings</Trans>
                        </span>
                      </Link>
                    }
                    tooltip={activeI18n._(msg({ id: "settings.title", message: "Settings" }))}
                  />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </Sidebar>
        )}

        <SidebarInset className="main-panel min-h-0 min-w-0 bg-background">
          <DesktopCollapsedToolbar>
            <SidebarTrigger aria-label="Toggle sidebar" className={chromeIconButtonClassName} />
            {!isSettings ? (
              <>
                <Button
                  aria-label="New chat"
                  className={cn(chromeIconButtonClassName, "collapsed-secondary")}
                  nativeButton={false}
                  render={<NewChatLink />}
                  size="icon"
                  variant="ghost"
                >
                  <SquarePen aria-hidden="true" size={16} strokeWidth={1.8} />
                </Button>
                <span
                  aria-hidden="true"
                  className="collapsed-secondary desktop-chrome-separator bg-border"
                />
              </>
            ) : null}
          </DesktopCollapsedToolbar>
          <div
            className={cn(
              "hidden min-h-12 items-center justify-between bg-sidebar px-2.5 text-sm font-semibold text-sidebar-foreground max-[767px]:flex [&_button]:[-webkit-app-region:no-drag]",
              !isSettings && "border-b border-border"
            )}
          >
            <SidebarTrigger aria-label="Open sidebar" />
            <span>{isSettings ? <Trans id="settings.title">Settings</Trans> : "Cypheria"}</span>
            {isSettings ? (
              <span aria-hidden="true" className="size-8" />
            ) : (
              <Button aria-label="Archived chats" size="icon" variant="ghost">
                <Archive aria-hidden="true" size={16} strokeWidth={1.9} />
              </Button>
            )}
          </div>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

function DesktopSidebarHeader({
  className,
  isWindows,
  triggerClassName,
}: Readonly<{ className: string; isWindows: boolean; triggerClassName: string }>) {
  return (
    <SidebarHeader className={className}>
      <SidebarTrigger aria-label="Collapse sidebar" className={triggerClassName} />
      <Button
        aria-label="Go back"
        className={triggerClassName}
        disabled
        size="icon"
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
      </Button>
      <Button
        aria-label="Go forward"
        className={triggerClassName}
        disabled
        size="icon"
        variant="ghost"
      >
        <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
      </Button>
      {isWindows ? <WindowsMenuBar /> : null}
    </SidebarHeader>
  )
}

function SettingsNavigation({
  headerClassName,
  isWindows,
  pathname,
  triggerClassName,
}: Readonly<{
  headerClassName: string
  isWindows: boolean
  pathname: string
  triggerClassName: string
}>) {
  const { i18n: activeI18n } = useLingui()
  const [searchQuery, setSearchQuery] = useState("")
  const [harnessesExpanded, setHarnessesExpanded] = useState(true)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const agents = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).agents.list(),
    queryKey: ["cypheria", "agents"],
  })
  const backToWorkspace = activeI18n._(
    msg({ id: "settings.backToWorkspace", message: "Back to workspace" })
  )
  const rows = useMemo(() => {
    const harnessLabel = activeI18n._(
      msg({ id: "settings.agentHarnesses", message: "Agent harnesses" })
    )
    return buildSettingsNavigationRows<HarnessNavigationAgent, ReactNode>({
      agents: agents.data?.agents ?? nativeHarnessNavigationAgents,
      emptyLabel: activeI18n._(msg({ id: "settings.search.empty", message: "No results found" })),
      groups: settingsGroups.map((group) => ({
        id: group.id,
        items: settingsItems
          .filter((item) => item.group === group.id)
          .map((item) => ({
            href: item.href,
            icon: item.icon,
            label: activeI18n._(item.label),
          })),
        label: activeI18n._(group.label),
      })),
      harnessGroupId: "integrations",
      harnessLabel,
      harnessesExpanded,
      locale: activeI18n.locale,
      query: searchQuery,
    })
  }, [activeI18n, agents.data?.agents, harnessesExpanded, searchQuery])
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) =>
      rows[index]?.kind === "group" ? 28 : rows[index]?.kind === "empty" ? 48 : 36,
    getItemKey: (index) => rows[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  })

  const navigationLayoutKey = `${harnessesExpanded}:${rows.length}`
  useEffect(() => {
    if (!navigationLayoutKey) return
    virtualizer.measure()
  }, [navigationLayoutKey, virtualizer])

  useEffect(() => {
    if (pathname.startsWith("/settings/agent-harnesses/")) setHarnessesExpanded(true)
  }, [pathname])

  useEffect(() => {
    const activeIndex = rows.findIndex((row) =>
      row.kind === "agent"
        ? pathname.startsWith(`/settings/agent-harnesses/${row.agent.id}/`)
        : row.kind === "item" && pathname === row.href
    )
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: "auto" })
  }, [pathname, rows, virtualizer])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [])

  return (
    <Sidebar className="border-r border-sidebar-border" collapsible="icon">
      <DesktopSidebarHeader
        className={headerClassName}
        isWindows={isWindows}
        triggerClassName={triggerClassName}
      />

      <SidebarContent className="min-h-0 overflow-hidden pb-3 pt-0.5">
        <div className="relative mx-1.5 mb-3 px-1 group-data-[collapsible=icon]:hidden">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={activeI18n._(
              msg({ id: "settings.search.label", message: "Search settings" })
            )}
            className="h-8 rounded-lg bg-sidebar-accent/60 pl-8 text-sm shadow-none"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={activeI18n._(
              msg({ id: "settings.search.placeholder", message: "Search settings…" })
            )}
            ref={searchRef}
            type="search"
            value={searchQuery}
          />
        </div>

        <div className="cypheria-scrollbar min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
          <div className="relative mx-1.5" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) return null
              return (
                <div
                  className="absolute left-0 top-0 w-full px-1"
                  data-index={virtualRow.index}
                  data-settings-navigation-row={row.kind}
                  key={row.id}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.kind === "back" ? (
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          render={
                            <Link to="/">
                              <ChevronLeft
                                aria-hidden="true"
                                className="size-4"
                                strokeWidth={1.9}
                              />
                              <span>{backToWorkspace}</span>
                            </Link>
                          }
                          tooltip={backToWorkspace}
                        />
                      </SidebarMenuItem>
                    </SidebarMenu>
                  ) : null}
                  {row.kind === "group" ? (
                    <SidebarGroupLabel className="px-2">{row.label}</SidebarGroupLabel>
                  ) : null}
                  {row.kind === "item" ? (
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          isActive={pathname === row.href}
                          render={
                            <Link to={row.href as (typeof settingsItems)[number]["href"]}>
                              {row.icon}
                              <span>{row.label}</span>
                            </Link>
                          }
                          tooltip={row.label}
                        />
                      </SidebarMenuItem>
                    </SidebarMenu>
                  ) : null}
                  {row.kind === "harness" ? (
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          className="pr-8"
                          onClick={() => setHarnessesExpanded((value) => !value)}
                          tooltip={row.label}
                        >
                          {harnessesExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                          <span>{row.label}</span>
                        </SidebarMenuButton>
                        <SidebarMenuAction
                          aria-label="Add agent harness"
                          disabled={
                            agents.isLoading || (agents.data?.availableAgents.length ?? 0) === 0
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            if ((agents.data?.availableAgents.length ?? 0) === 0) return
                            setInstallDialogOpen(true)
                          }}
                        >
                          <Plus aria-hidden="true" />
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  ) : null}
                  {row.kind === "agent" ? (
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          className="pl-7 pr-9"
                          isActive={pathname.startsWith(
                            `/settings/agent-harnesses/${row.agent.id}/`
                          )}
                          render={
                            <Link
                              params={{ agentId: row.agent.id, sectionId: "authentication" }}
                              to="/settings/agent-harnesses/$agentId/$sectionId"
                            >
                              <span className="flex size-5 items-center justify-center">
                                <HarnessIcon
                                  agentId={row.agent.id}
                                  className="size-4"
                                  icon={row.agent.icon}
                                  name={row.agent.name}
                                />
                              </span>
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate">{row.agent.name}</span>
                                <HarnessStatusDot agent={row.agent} />
                              </span>
                            </Link>
                          }
                          tooltip={row.agent.name}
                        />
                        <HarnessNavigationMenu
                          active={pathname.startsWith(`/settings/agent-harnesses/${row.agent.id}/`)}
                          agent={row.agent}
                        />
                      </SidebarMenuItem>
                    </SidebarMenu>
                  ) : null}
                  {row.kind === "empty" ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
                      {row.label}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </SidebarContent>

      <HarnessAddDialog
        agents={agents.data?.availableAgents ?? []}
        onOpenChange={setInstallDialogOpen}
        open={installDialogOpen}
      />
    </Sidebar>
  )
}

function HarnessStatusDot({ agent }: { agent: HarnessNavigationAgent }) {
  const state = !agent.installed ? "Not installed" : agent.enabled ? "Enabled" : "Disabled"
  return (
    <span
      aria-label={state}
      className={cn(
        "size-1 shrink-0 rounded-full",
        !agent.installed && "bg-muted-foreground/45",
        agent.installed && !agent.enabled && "bg-amber-500",
        agent.installed && agent.enabled && "bg-emerald-500"
      )}
      role="status"
      title={state}
    />
  )
}

function HarnessNavigationMenu({
  active,
  agent,
}: Readonly<{ active: boolean; agent: HarnessNavigationAgent }>) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: async () => (await ensureCypheriaClient()).agents.remove(agent.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
      if (active) await navigate({ to: "/settings/general" })
    },
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            aria-label={`More options for ${agent.name}`}
            disabled={remove.isPending}
            showOnHover
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56 rounded-xl p-1.5" side="right">
        <DropdownMenuItem
          className="py-1.5 text-destructive focus:text-destructive"
          disabled={agent.installed || remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 aria-hidden="true" />
          Remove
        </DropdownMenuItem>
        {remove.error ? (
          <p className="px-2 py-1 text-xs text-destructive">{remove.error.message}</p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HarnessAddDialog({
  agents,
  onOpenChange,
  open,
}: Readonly<{
  agents: AgentCatalogEntry[]
  onOpenChange: (open: boolean) => void
  open: boolean
}>) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const available = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents]
  )
  const [selectedId, setSelectedId] = useState<AgentId>()
  const [searchQuery, setSearchQuery] = useState("")
  const search = useMemo(
    () =>
      createInMemorySearch(
        available,
        (agent) => `${agent.name} ${agent.id} ${agent.version} ${agent.description}`
      ),
    [available]
  )
  const visibleAgents = useMemo(() => search.search(searchQuery), [search, searchQuery])
  const add = useMutation({
    mutationFn: async (agentId: AgentId) => {
      const client = await ensureCypheriaClient()
      return client.agents.add(agentId)
    },
    onSuccess: async (_, agentId) => {
      setSelectedId(undefined)
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
      await navigate({
        params: { agentId, sectionId: "authentication" },
        to: "/settings/agent-harnesses/$agentId/$sectionId",
      })
    },
  })

  useEffect(() => {
    if (!open) return
    setSelectedId(undefined)
    setSearchQuery("")
  }, [open])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (add.isPending) return
        if (!nextOpen) {
          add.reset()
          setSelectedId(undefined)
          setSearchQuery("")
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add agent harness</DialogTitle>
          <DialogDescription>
            Choose a harness to add. You can install it from its settings page.
          </DialogDescription>
        </DialogHeader>
        {available.length ? (
          <Command className="rounded-lg border" shouldFilter={false}>
            <CommandInput
              disabled={add.isPending}
              placeholder="Search harnesses…"
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList className="cypheria-scrollbar max-h-80 p-1 pt-2">
              <CommandEmpty>No matching harnesses.</CommandEmpty>
              {visibleAgents.map((agent) => (
                <CommandItem
                  className="py-2"
                  disabled={add.isPending}
                  key={agent.id}
                  value={agent.id}
                  onSelect={(value) => {
                    const agentId = resolveAvailableHarnessId(value, available)
                    if (!agentId) {
                      setSelectedId(undefined)
                      return
                    }
                    setSelectedId(agentId)
                    add.mutate(agentId)
                  }}
                >
                  <span className="flex size-8 shrink-0 self-center items-center justify-center rounded-md border border-border bg-background">
                    <HarnessIcon
                      agentId={agent.id}
                      className="size-4"
                      icon={agent.icon}
                      name={agent.name}
                    />
                  </span>
                  <span className="!grid min-w-0 flex-1 gap-0.5 whitespace-normal">
                    <span className="flex min-w-0 items-baseline gap-2 leading-5">
                      <span className="truncate font-medium">{agent.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        v{agent.version}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                      {agent.description}
                    </span>
                  </span>
                  {add.isPending && selectedId === agent.id ? (
                    <LoaderCircle className="ml-auto size-4 animate-spin" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        ) : (
          <p className="text-sm text-muted-foreground">All available harnesses have been added.</p>
        )}
        {add.error ? <p className="text-sm text-destructive">{add.error.message}</p> : null}
      </DialogContent>
    </Dialog>
  )
}

function WindowsMenuBar() {
  const { i18n: activeI18n } = useLingui()
  const menuItems = [
    msg({ id: "menu.file", message: "File" }),
    msg({ id: "menu.edit", message: "Edit" }),
    msg({ id: "menu.view", message: "View" }),
    msg({ id: "menu.window", message: "Window" }),
    msg({ id: "menu.help", message: "Help" }),
  ]
  return (
    <nav aria-label="Application menu" className="ml-0 inline-flex h-[30px] items-center gap-1">
      {menuItems.map((item) => {
        const label = activeI18n._(item)
        return (
          <button
            className="h-[30px] rounded-[5px] border-0 bg-transparent px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            key={item.id}
            type="button"
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}

function getDesktopPlatform(): "darwin" | "win32" | "unknown" {
  if (typeof window === "undefined") {
    return "unknown"
  }

  const platform = window.cypheria?.app.platform
  return platform === "darwin" || platform === "win32" ? platform : "unknown"
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html dir="ltr" lang={i18n.locale || "en"} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans text-sm">
        <JotaiProvider>{children}</JotaiProvider>
        <Scripts />
      </body>
    </html>
  )
}

function NavigationLink({
  item,
  ...props
}: Readonly<{ item: (typeof navigationItems)[number] }> & Omit<ComponentProps<"a">, "href">) {
  if (item.kind === "new-chat") return <NewChatLink {...props} />
  return <Link {...props} to={item.href} search={{}} />
}
