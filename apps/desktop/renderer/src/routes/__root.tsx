/// <reference types="vite/client" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router"
import { Provider as JotaiProvider } from "jotai"
import { type ReactNode, useState } from "react"

const navigationItems = ["Workspaces", "Browser", "Wallets", "Automations", "Security", "Settings"]

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
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-name">Cypheria</div>
            <div className="brand-caption">Local Web3 agent desktop</div>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {navigationItems.map((item) => (
            <Link className="nav-item" key={item} to="/">
              {item}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-dot" />
          <span>Runtime ready</span>
        </div>
      </aside>

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
