/// <reference types="vite/client" />

import {
  Badge,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarNav,
  SidebarNavItem,
} from "@cypheria/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { Provider as JotaiProvider } from "jotai"
import {
  Bot,
  BriefcaseBusiness,
  Compass,
  Landmark,
  LockKeyhole,
  Settings,
  ShieldCheck,
  WalletCards,
} from "lucide-react"
import { type ReactNode, useState } from "react"

const navigationItems = [
  {
    icon: <BriefcaseBusiness size={16} strokeWidth={1.9} />,
    label: "Workspaces",
  },
  {
    icon: <Compass size={16} strokeWidth={1.9} />,
    label: "Browser",
  },
  {
    icon: <WalletCards size={16} strokeWidth={1.9} />,
    label: "Wallets",
  },
  {
    icon: <Bot size={16} strokeWidth={1.9} />,
    label: "Automations",
  },
  {
    icon: <ShieldCheck size={16} strokeWidth={1.9} />,
    label: "Security",
  },
  {
    icon: <Settings size={16} strokeWidth={1.9} />,
    label: "Settings",
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
    <div className="app-shell">
      <Sidebar className="app-sidebar">
        <div className="app-brand">
          <div className="app-brand-mark">
            <Landmark aria-hidden="true" size={18} strokeWidth={2} />
          </div>
          <div>
            <div className="app-brand-name">Cypheria</div>
            <div className="app-brand-caption">Local Web3 agent desktop</div>
          </div>
        </div>

        <SidebarContent>
          <SidebarNav aria-label="Primary">
            {navigationItems.map((item) => (
              <SidebarNavItem
                active={item.label === "Workspaces"}
                href="/"
                icon={item.icon}
                key={item.label}
              >
                {item.label}
              </SidebarNavItem>
            ))}
          </SidebarNav>
        </SidebarContent>

        <SidebarFooter className="app-sidebar-footer">
          <LockKeyhole aria-hidden="true" size={14} strokeWidth={2} />
          <span>Human approval</span>
          <Badge tone="success">Local</Badge>
        </SidebarFooter>
      </Sidebar>

      <main className="main-panel">{children}</main>
    </div>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
