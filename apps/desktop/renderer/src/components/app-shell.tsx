/// <reference types="vite/client" />

import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
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
  SidebarMenuButton,
  SidebarMenuItem,
} from "@cypheria/ui/components/sidebar"
import { TooltipProvider } from "@cypheria/ui/components/tooltip"
import { msg } from "@lingui/core/macro"
import { I18nProvider, useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { HeadContent, Link, Outlet, Scripts, useLocation } from "@tanstack/react-router"
import { Provider as JotaiProvider } from "jotai"
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  Cable,
  ChevronLeft,
  CircleUserRound,
  Palette,
  Search,
  Settings,
  SlidersHorizontal,
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
import { activateLanguage, getBootstrapLanguage, i18n } from "../i18n.js"
import { NewChatLink } from "./chat-navigation"
import { ChatSearch } from "./chat-search"
import { ChatSidebar } from "./chat-sidebar"
import {
  DesktopCollapsedToolbar,
  DesktopSidebar as Sidebar,
  DesktopSidebarProvider as SidebarProvider,
  DesktopSidebarTrigger as SidebarTrigger,
} from "./desktop-sidebar"

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
    group: "coding",
    href: "/settings/configuration",
    icon: <SlidersHorizontal className="size-4" strokeWidth={1.9} />,
    label: msg({ id: "settings.configuration", message: "Configuration" }),
  },
  {
    group: "coding",
    href: "/settings/models",
    icon: <Bot className="size-4" strokeWidth={1.9} />,
    label: msg({ id: "settings.models", message: "Models" }),
  },
  {
    group: "integrations",
    href: "/settings/connections",
    icon: <Cable className="size-4" strokeWidth={1.9} />,
    label: msg({ id: "settings.connections", message: "Connections" }),
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
    id: "coding",
    label: msg({ id: "settings.group.coding", message: "Coding" }),
  },
  {
    id: "archived",
    label: msg({ id: "settings.group.archived", message: "Archived" }),
  },
] as const

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
  const { pathname } = useLocation()
  const isSettings = pathname.startsWith("/settings")
  const approvalsQuery = useQuery({
    queryFn: () => window.cypheria?.approval.list("pending") ?? [],
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
        style={{ "--sidebar-width": "288px", "--sidebar-width-icon": "52px" } as CSSProperties}
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
              <ChatSidebar pendingCount={approvalsQuery.data?.length ?? 0} />
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
  const searchRef = useRef<HTMLInputElement>(null)
  const backToWorkspace = activeI18n._(
    msg({ id: "settings.backToWorkspace", message: "Back to workspace" })
  )
  const visibleGroups = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase(activeI18n.locale)
    return settingsGroups
      .map((group) => ({
        ...group,
        items: settingsItems.filter(
          (item) =>
            item.group === group.id &&
            (!needle ||
              activeI18n._(item.label).toLocaleLowerCase(activeI18n.locale).includes(needle))
        ),
      }))
      .filter(({ items }) => items.length > 0)
  }, [activeI18n, searchQuery])

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

      <SidebarContent className="grid min-h-0 content-start gap-3 overflow-auto px-3 pb-3 pt-0.5">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={
                    <Link to="/">
                      <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={1.9} />
                      <span>{backToWorkspace}</span>
                    </Link>
                  }
                  tooltip={backToWorkspace}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="relative px-2 group-data-[collapsible=icon]:hidden">
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

        {visibleGroups.length > 0 ? (
          visibleGroups.map((group) => (
            <SidebarGroup className="py-0" key={group.id}>
              <SidebarGroupLabel>{activeI18n._(group.label)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const label = activeI18n._(item.label)
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={pathname === item.href}
                          render={
                            <Link to={item.href}>
                              {item.icon}
                              <span>{label}</span>
                            </Link>
                          }
                          tooltip={label}
                        />
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        ) : (
          <p className="px-4 py-2 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
            <Trans id="settings.search.empty">No results found</Trans>
          </p>
        )}
      </SidebarContent>

      <SidebarFooter className="flex min-h-[58px] items-end px-3 pb-3 pt-2.5">
        <ThemeModeButton />
      </SidebarFooter>
    </Sidebar>
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
