/// <reference types="vite/client" />

import { Button } from "@cypheria/ui/components/button"
import { CypheriaThemeProvider, useCypheriaTheme } from "@cypheria/ui"
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
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Workflow,
} from "lucide-react"
import { type ReactNode, useState } from "react"

const navigationItems = [
  {
    icon: <Plus size={16} strokeWidth={1.9} />,
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
})

function RootComponent() {
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
  return (
    <TooltipProvider>
      <SidebarProvider
        className="app-shell"
        style={{ "--sidebar-width": "344px" } as React.CSSProperties}
      >
        <Sidebar className="app-sidebar" collapsible="offcanvas">
          <SidebarHeader className="window-control-row">
            <SidebarTrigger aria-label="Collapse sidebar" />
            <Button aria-label="Go back" size="icon" variant="ghost">
              <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.8} />
            </Button>
            <Button aria-label="Go forward" size="icon" variant="ghost">
              <ChevronRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </Button>
          </SidebarHeader>

          <SidebarContent className="app-sidebar-content">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationItems.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton asChild tooltip={item.label}>
                        <a href="/">
                          {item.icon}
                          <span>{item.label}</span>
                        </a>
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
                        asChild
                        isActive={workspace.active}
                        tooltip={workspace.name}
                      >
                        <a href="/">
                          <Folder aria-hidden="true" size={15} strokeWidth={1.9} />
                          <span>{workspace.name}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Chats</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="sidebar-empty-state">No chats yet</div>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="app-sidebar-footer">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Settings">
                  <a href="/settings/appearance">
                    <Settings aria-hidden="true" size={16} strokeWidth={1.9} />
                    <span>Settings</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <ThemeModeButton />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="main-panel">
          <div className="mobile-shell-bar">
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
    <button
      aria-label={`Switch to ${nextMode} theme`}
      className="account-button"
      onClick={() => setMode(nextMode)}
      suppressHydrationWarning
      type="button"
    >
      <CircleUserRound aria-hidden="true" size={17} strokeWidth={1.9} />
    </button>
  )
}
