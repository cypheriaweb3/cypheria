/// <reference types="vite/client" />

import { cn } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import {
  Sidebar,
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
  SidebarProvider,
  SidebarTrigger,
} from "@cypheria/ui/components/sidebar"
import { TooltipProvider } from "@cypheria/ui/components/tooltip"
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { HeadContent, Outlet, Scripts, useLocation } from "@tanstack/react-router"
import { Provider as JotaiProvider } from "jotai"
import {
  Archive,
  BellDot,
  Bot,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  FolderGit2,
  LogIn,
  Palette,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  WalletCards,
  Workflow,
} from "lucide-react"
import { type CSSProperties, type ReactNode, useState } from "react"
import { resolveThemeMode, useAppearanceController, useTheme } from "../appearance.js"

const navigationItems = [
  {
    href: "/",
    icon: <SquarePen size={16} strokeWidth={1.9} />,
    label: "New task",
  },
  {
    href: "/?search=1",
    icon: <Search size={16} strokeWidth={1.9} />,
    label: "Search",
  },
  {
    href: "/approvals",
    icon: <BellDot size={16} strokeWidth={1.9} />,
    label: "Pending",
  },
] as const

const workbenchItems = [
  {
    href: "/wallets",
    icon: <WalletCards size={16} strokeWidth={1.9} />,
    label: "Wallets & assets",
  },
  {
    href: "/automations",
    icon: <Workflow size={16} strokeWidth={1.9} />,
    label: "Automations",
  },
  {
    href: "/policies",
    icon: <ShieldCheck size={16} strokeWidth={1.9} />,
    label: "Signing policies",
  },
  {
    href: "/audit",
    icon: <ScrollText size={16} strokeWidth={1.9} />,
    label: "Audit log",
  },
  {
    href: "/plugins",
    icon: <Boxes size={16} strokeWidth={1.9} />,
    label: "Plugins & skills",
  },
] as const

const settingsItems = [
  {
    href: "/settings/account",
    icon: <LogIn size={16} strokeWidth={1.9} />,
    label: "Account",
  },
  {
    href: "/settings/appearance",
    icon: <Palette size={16} strokeWidth={1.9} />,
    label: "Appearance",
  },
  {
    href: "/settings/models",
    icon: <Bot size={16} strokeWidth={1.9} />,
    label: "Models",
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
      <QueryProvider>
        <AppShell>{children}</AppShell>
      </QueryProvider>
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
      {children}
    </QueryClientProvider>
  )
}

function AppearanceController() {
  useAppearanceController()
  return null
}

function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { pathname } = useLocation()
  const isSettings = pathname.startsWith("/settings")
  const isSearchOpen = new URLSearchParams(globalThis.location?.search ?? "").get("search") === "1"
  const [searchTerm, setSearchTerm] = useState("")
  const threadsQuery = useQuery({
    queryFn: () =>
      window.cypheria?.codex.listThreads({
        ...(searchTerm.trim() ? { searchTerm: searchTerm.trim() } : {}),
      }) ?? [],
    queryKey: ["codex", "threads", searchTerm.trim()],
    refetchInterval: 15_000,
  })
  const approvalsQuery = useQuery({
    queryFn: () => window.cypheria?.approval.list("pending") ?? [],
    queryKey: ["approval", "pending"],
    refetchInterval: 5_000,
  })
  const threads = threadsQuery.data ?? []
  const projectGroups = new Map<string, typeof threads>()
  for (const thread of threads) {
    if (!thread.projectId) continue
    projectGroups.set(thread.projectId, [...(projectGroups.get(thread.projectId) ?? []), thread])
  }
  const recentThreads = threads.filter((thread) => !thread.projectId).slice(0, 8)
  const platform = getDesktopPlatform()
  const isWindows = platform === "win32"
  const windowControlRowClassName = cn(
    "flex min-h-14 flex-row items-center gap-2.5 px-3 py-2 pl-[88px] [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
    isWindows && "gap-[18px] px-3 pb-2 pt-3 pl-3.5"
  )
  const chromeIconButtonClassName = "size-[30px] text-muted-foreground disabled:opacity-35"

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
                <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.8} />
              </Button>
              <Button
                aria-label="Go forward"
                className={chromeIconButtonClassName}
                disabled
                size="icon"
                variant="ghost"
              >
                <ChevronRight aria-hidden="true" size={17} strokeWidth={1.8} />
              </Button>
              {isWindows ? <WindowsMenuBar /> : null}
            </SidebarHeader>

            <SidebarContent className="grid min-h-0 content-start gap-4 overflow-auto px-3 pb-3 pt-0.5">
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navigationItems.map((item) => (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          render={
                            <a href={item.href}>
                              {item.icon}
                              <span>{item.label}</span>
                              {item.href === "/approvals" && approvalsQuery.data?.length ? (
                                <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                                  {approvalsQuery.data.length}
                                </span>
                              ) : null}
                            </a>
                          }
                          tooltip={item.label}
                        />
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              {isSearchOpen ? (
                <SidebarGroup>
                  <SidebarGroupLabel>Search tasks</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <Input
                      aria-label="Search tasks"
                      autoFocus
                      placeholder="Title or content"
                      type="search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.currentTarget.value)}
                    />
                  </SidebarGroupContent>
                </SidebarGroup>
              ) : null}

              <SidebarGroup>
                <SidebarGroupLabel>Workbench</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {workbenchItems.map((item) => (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          render={
                            <a href={item.href}>
                              {item.icon}
                              <span>{item.label}</span>
                            </a>
                          }
                          tooltip={item.label}
                        />
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarGroup>
                <SidebarGroupLabel>Projects</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {[...projectGroups.entries()].map(([projectId, projectThreads]) => (
                      <SidebarMenuItem key={projectId}>
                        <SidebarMenuButton tooltip={projectId}>
                          <FolderGit2 aria-hidden="true" size={15} strokeWidth={1.9} />
                          <span className="truncate">{projectId}</span>
                        </SidebarMenuButton>
                        <div className="ml-7 grid border-l border-sidebar-border pl-2">
                          {projectThreads.slice(0, 5).map((thread) => (
                            <a
                              className="truncate rounded-md px-2 py-1.5 text-xs text-sidebar-foreground no-underline hover:bg-sidebar-accent"
                              href={`/?thread=${encodeURIComponent(thread.id)}`}
                              key={thread.id}
                            >
                              {thread.title}
                            </a>
                          ))}
                        </div>
                      </SidebarMenuItem>
                    ))}
                    {projectGroups.size === 0 ? (
                      <div className="px-2 text-xs text-muted-foreground">No projects yet</div>
                    ) : null}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarGroup>
                <SidebarGroupLabel>Recent tasks</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {recentThreads.map((thread) => (
                      <SidebarMenuItem key={thread.id}>
                        <SidebarMenuButton
                          render={
                            <a href={`/?thread=${encodeURIComponent(thread.id)}`}>
                              <span
                                className={cn(
                                  "size-1.5 shrink-0 rounded-full bg-muted-foreground/45",
                                  thread.status === "active" && "animate-pulse bg-primary",
                                  thread.status === "systemError" && "bg-destructive"
                                )}
                              />
                              <span className="truncate">{thread.title}</span>
                            </a>
                          }
                          tooltip={thread.title}
                        />
                      </SidebarMenuItem>
                    ))}
                    {recentThreads.length === 0 ? (
                      <div className="px-2 text-xs text-muted-foreground">No tasks yet</div>
                    ) : null}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_34px] items-center gap-2 px-3 pb-3 pt-2.5">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={
                      <a href="/settings/models">
                        <Settings aria-hidden="true" size={16} strokeWidth={1.9} />
                        <span>Settings</span>
                      </a>
                    }
                    tooltip="Settings"
                  />
                </SidebarMenuItem>
              </SidebarMenu>
              <ThemeModeButton />
            </SidebarFooter>
          </Sidebar>
        )}

        <SidebarInset className="main-panel min-h-0 min-w-0 bg-background">
          {!isSettings ? (
            <div
              className={cn(
                "fixed left-0 top-0 z-20 hidden min-h-14 flex-row items-center gap-2.5 px-4 py-2 pl-[88px] [-webkit-app-region:drag] [[data-slot=sidebar][data-state=collapsed]~.main-panel_&]:flex [&_button]:[-webkit-app-region:no-drag]",
                isWindows && "right-[138px] gap-[18px] pl-3.5"
              )}
            >
              <SidebarTrigger aria-label="Open sidebar" className={chromeIconButtonClassName} />
              <Button
                aria-label="Go back"
                className={chromeIconButtonClassName}
                disabled
                size="icon"
                variant="ghost"
              >
                <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.8} />
              </Button>
              <Button
                aria-label="Go forward"
                className={chromeIconButtonClassName}
                disabled
                size="icon"
                variant="ghost"
              >
                <ChevronRight aria-hidden="true" size={17} strokeWidth={1.8} />
              </Button>
              <Button
                aria-label="New chat"
                className={chromeIconButtonClassName}
                size="icon"
                variant="ghost"
              >
                <SquarePen aria-hidden="true" size={16} strokeWidth={1.8} />
              </Button>
              {isWindows ? <WindowsMenuBar /> : null}
            </div>
          ) : null}
          <div className="hidden min-h-12 items-center justify-between border-b border-border bg-sidebar px-2.5 text-sm font-semibold text-sidebar-foreground max-[860px]:flex [&_button]:[-webkit-app-region:no-drag]">
            <SidebarTrigger aria-label="Open sidebar" />
            <span>{isSettings ? "Settings" : "Cypheria"}</span>
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
  return (
    <Sidebar className="border-r border-sidebar-border" collapsible="icon">
      <SidebarHeader
        className={cn(
          "flex min-h-14 flex-row items-center gap-2.5 px-3 py-2 pl-[88px] [-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]",
          platform === "win32" && "px-3 pb-2 pt-3 pl-3.5"
        )}
      >
        <SidebarTrigger aria-label="Collapse settings sidebar" className={triggerClassName} />
        <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
          Settings
        </span>
      </SidebarHeader>

      <SidebarContent className="grid min-h-0 content-start gap-4 overflow-auto px-3 pb-3 pt-0.5">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={
                    <a href="/">
                      <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.9} />
                      <span>Back to workspace</span>
                    </a>
                  }
                  tooltip="Back to workspace"
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname === item.href}
                    render={
                      <a href={item.href}>
                        {item.icon}
                        <span>{item.label}</span>
                      </a>
                    }
                    tooltip={item.label}
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex min-h-[58px] items-end px-3 pb-3 pt-2.5">
        <ThemeModeButton />
      </SidebarFooter>
    </Sidebar>
  )
}

function WindowsMenuBar() {
  return (
    <nav aria-label="Application menu" className="ml-0 inline-flex h-[30px] items-center gap-1">
      {["File", "Edit", "View", "Window", "Help"].map((item) => (
        <button
          className="h-[30px] rounded-[5px] border-0 bg-transparent px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          key={item}
          type="button"
        >
          {item}
        </button>
      ))}
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
    <html lang="en" suppressHydrationWarning>
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
      className="flex size-8 items-center justify-center rounded-md p-0 hover:bg-sidebar-accent"
      onClick={() => void handleThemeModeChange()}
      size="icon"
      suppressHydrationWarning
      type="button"
      variant="ghost"
    >
      <CircleUserRound aria-hidden="true" size={17} strokeWidth={1.9} />
    </Button>
  )
}
