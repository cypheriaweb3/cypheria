/// <reference types="vite/client" />

import type { AgentCatalogEntry, AgentId, AgentView } from "@cypheria/protocol"
import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
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
  CircleUserRound,
  Palette,
  Plus,
  Search,
  Settings,
  SquarePen,
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
import { resolveThemeMode, useAppearanceController, useTheme } from "../appearance.js"
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

type HarnessNavigationAgent = Pick<AgentView, "icon" | "id" | "name">

const nativeHarnessNavigationAgents: HarnessNavigationAgent[] = [
  { icon: null, id: "codex", name: "Codex" },
  { icon: null, id: "claude", name: "Claude" },
  { icon: null, id: "pi", name: "Pi" },
  { icon: null, id: "opencode", name: "OpenCode" },
]
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
        data-platform={platform}
        fixedWidth={isSettings ? 232 : undefined}
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
            pathname={pathname}
            platform={platform}
            triggerClassName={chromeIconButtonClassName}
          />
        ) : (
          <Sidebar className="border-r border-sidebar-border" collapsible="icon">
            <SidebarHeader className={windowControlRowClassName}>
              <SidebarTrigger aria-label="Collapse sidebar" className={chromeIconButtonClassName} />
              <Button
                aria-label="Go back"
                className={chromeIconButtonClassName}
                disabled
                size="icon"
                variant="ghost"
              >
                <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
              </Button>
              <Button
                aria-label="Go forward"
                className={chromeIconButtonClassName}
                disabled
                size="icon"
                variant="ghost"
              >
                <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
              </Button>
              {isWindows ? <WindowsMenuBar /> : null}
            </SidebarHeader>

            <SidebarContent className="min-h-0 overflow-hidden px-3 pb-3 pt-0.5">
              <SidebarGroup className="shrink-0 px-2 py-0">
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

            <SidebarFooter className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_34px] items-center gap-2 px-3 pb-3 pt-2.5">
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
              <ThemeModeButton />
            </SidebarFooter>
          </Sidebar>
        )}

        <SidebarInset className="main-panel min-h-0 min-w-0 bg-background">
          <DesktopCollapsedToolbar>
            <SidebarTrigger aria-label="Toggle sidebar" className={chromeIconButtonClassName} />
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
          </DesktopCollapsedToolbar>
          <div className="hidden min-h-12 items-center justify-between border-b border-border bg-sidebar px-2.5 text-sm font-semibold text-sidebar-foreground max-[767px]:flex [&_button]:[-webkit-app-region:no-drag]">
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

function SettingsNavigation({
  pathname,
  platform,
  triggerClassName,
}: Readonly<{
  pathname: string
  platform: "darwin" | "win32" | "unknown"
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
      <SidebarHeader
        className={cn(
          "flex min-h-[44px] flex-row items-center gap-2.5 px-3 py-2 pl-[88px] [-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]",
          platform === "win32" && "px-3 pb-2 pt-3 pl-3.5"
        )}
      >
        <SidebarTrigger aria-label="Collapse settings sidebar" className={triggerClassName} />
        <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
          <Trans id="settings.title">Settings</Trans>
        </span>
      </SidebarHeader>

      <SidebarContent className="min-h-0 overflow-hidden px-3 pb-3 pt-0.5">
        <div className="relative mb-3 px-2 group-data-[collapsible=icon]:hidden">
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
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) return null
              return (
                <div
                  className="absolute left-0 top-0 w-full px-2"
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
                          disabled={!agents.data?.availableAgents.length}
                          onClick={(event) => {
                            event.stopPropagation()
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
                          className="pl-7"
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
                              <span>{row.agent.name}</span>
                            </Link>
                          }
                          tooltip={row.agent.name}
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

      <SidebarFooter className="flex min-h-[58px] items-end px-3 pb-3 pt-2.5">
        <ThemeModeButton />
      </SidebarFooter>
      <HarnessAddDialog
        agents={agents.data?.availableAgents ?? []}
        onOpenChange={setInstallDialogOpen}
        open={installDialogOpen}
      />
    </Sidebar>
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
  const add = useMutation({
    mutationFn: async (agentId: AgentId) => {
      const client = await ensureCypheriaClient()
      return client.agents.add(agentId)
    },
    onSuccess: async (_, agentId) => {
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
      onOpenChange(false)
      await navigate({
        params: { agentId, sectionId: "authentication" },
        to: "/settings/agent-harnesses/$agentId/$sectionId",
      })
    },
  })

  useEffect(() => {
    if (!open) return
    setSelectedId(undefined)
  }, [open])

  const selected = available.find((agent) => agent.id === selectedId)
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (add.isPending) return
        if (!nextOpen) {
          add.reset()
          setSelectedId(undefined)
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
          <Select
            disabled={add.isPending}
            value={selectedId ?? null}
            onValueChange={(value) => {
              const agentId = value as AgentId
              setSelectedId(agentId)
              add.mutate(agentId)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a harness">
                {add.isPending ? `Adding ${selected?.name ?? "harness"}…` : selected?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false} className="max-h-80">
              {available.map((agent) => (
                <SelectItem className="items-start py-2" key={agent.id} value={agent.id}>
                  <HarnessIcon
                    agentId={agent.id}
                    className="mt-0.5 size-4"
                    icon={agent.icon}
                    name={agent.name}
                  />
                  <span className="!grid min-w-0 flex-1 gap-0.5 whitespace-normal">
                    <span className="font-medium leading-5">{agent.name}</span>
                    <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                      {agent.description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

function ThemeModeButton() {
  const queryClient = useQueryClient()
  const { theme, updateTheme } = useTheme()
  const nextMode = resolveThemeMode(theme.theme) === "dark" ? "light" : "dark"

  const handleThemeModeChange = async () => {
    const settings = await updateTheme({ ...theme, theme: nextMode })
    if (settings) {
      queryClient.setQueryData(["settings", "appearance"], settings)
    }
  }

  return (
    <Button
      aria-label={`Switch to ${nextMode} theme`}
      className="relative flex size-4 items-center justify-center justify-self-center rounded p-0 after:absolute after:-inset-1 hover:bg-sidebar-accent"
      onClick={() => void handleThemeModeChange()}
      size="icon"
      suppressHydrationWarning
      type="button"
      variant="ghost"
    >
      <CircleUserRound aria-hidden="true" className="size-4" strokeWidth={1.9} />
    </Button>
  )
}

function NavigationLink({
  item,
  ...props
}: Readonly<{ item: (typeof navigationItems)[number] }> & Omit<ComponentProps<"a">, "href">) {
  if (item.kind === "new-chat") return <NewChatLink {...props} />
  return <Link {...props} to={item.href} search={{}} />
}
