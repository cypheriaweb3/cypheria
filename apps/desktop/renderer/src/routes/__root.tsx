/// <reference types="vite/client" />

import { CypheriaThemeProvider, cn, useCypheriaTheme } from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { Provider as JotaiProvider } from "jotai"
import {
  Archive,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Folder,
  Search,
  Settings,
  SlidersHorizontal,
  SquarePen,
  Workflow,
} from "lucide-react"
import { type CSSProperties, type ReactNode, useState } from "react"

const navigationItems = [
  {
    icon: <SquarePen size={16} strokeWidth={1.9} />,
    label: "New chat",
  },
  {
    icon: <Search size={16} strokeWidth={1.9} />,
    label: "Search",
  },
  {
    icon: <BriefcaseBusiness size={16} strokeWidth={1.9} />,
    label: "Portfolio",
  },
  {
    icon: <SlidersHorizontal size={16} strokeWidth={1.9} />,
    label: "Plugins & Skills",
  },
  {
    icon: <Workflow size={16} strokeWidth={1.9} />,
    label: "Automations",
  },
]

const workspaces = [
  {
    active: true,
    name: "cypheria",
  },
]

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "Cypheria",
      },
    ],
  }),
  notFoundComponent: RootNotFoundComponent,
})

function RootComponent() {
  return (
    <RootLayout>
      <Outlet />
    </RootLayout>
  )
}

function RootNotFoundComponent() {
  return (
    <RootLayout>
      <NotFoundRoute />
    </RootLayout>
  )
}

function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <RootDocument>
      <JotaiProvider>
        <QueryProvider>
          <AppShell>
            <Outlet />
          </AppShell>
        </QueryProvider>
      </JotaiProvider>
    </RootDocument>
  )
}

function NotFoundRoute() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-10 text-foreground max-[860px]:min-h-[calc(100vh-48px)]">
      <section className="grid w-full max-w-[520px] gap-5 text-center">
        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            404
          </span>
          <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            This Cypheria view does not exist yet.
          </p>
        </div>
        <div className="flex justify-center">
          <Button render={<a href="/" />}>Back to workspace</Button>
        </div>
      </section>
    </main>
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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function AppShell({ children }: Readonly<{ children: ReactNode }>) {
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
        style={{ "--sidebar-width": "344px" } as CSSProperties}
      >
        <Sidebar className="border-r border-sidebar-border" collapsible="offcanvas">
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

          <SidebarContent className="grid min-h-0 content-start gap-[26px] overflow-auto px-[18px] pb-3 pt-0.5">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationItems.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton render={<a href="/" />} tooltip={item.label}>
                        {item.icon}
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {workspaces.map((workspace) => (
                    <SidebarMenuItem key={workspace.name}>
                      <SidebarMenuButton
                        isActive={workspace.active}
                        render={<a href="/" />}
                        tooltip={workspace.name}
                      >
                        <Folder aria-hidden="true" size={15} strokeWidth={1.9} />
                        <span>{workspace.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Chats</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="px-2 text-[13px] font-medium text-muted-foreground">
                  No chats yet
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_34px] items-center gap-2 px-[18px] pb-3 pt-2.5">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<a href="/settings/appearance" />}
                  tooltip="Settings"
                >
                  <Settings aria-hidden="true" size={16} strokeWidth={1.9} />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <ThemeModeButton />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="main-panel min-h-0 min-w-0 bg-background">
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
          <div className="hidden min-h-12 items-center justify-between border-b border-border bg-sidebar px-2.5 text-sm font-semibold text-sidebar-foreground max-[860px]:flex [&_button]:[-webkit-app-region:no-drag]">
            <SidebarTrigger aria-label="Open sidebar" />
            <span>Cypheria</span>
            <Button aria-label="Archived chats" size="icon" variant="ghost">
              <Archive aria-hidden="true" size={16} strokeWidth={1.9} />
            </Button>
          </div>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
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
      <body>
        <CypheriaThemeProvider>{children}</CypheriaThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

function ThemeModeButton() {
  const { setMode, themeState } = useCypheriaTheme()
  const nextMode = themeState.currentMode === "dark" ? "light" : "dark"

  return (
    <Button
      aria-label={`Switch to ${nextMode} theme`}
      className="flex size-8 items-center justify-center rounded-md p-0 hover:bg-sidebar-accent"
      onClick={() => setMode(nextMode)}
      size="icon"
      suppressHydrationWarning
      type="button"
      variant="ghost"
    >
      <CircleUserRound aria-hidden="true" size={17} strokeWidth={1.9} />
    </Button>
  )
}
