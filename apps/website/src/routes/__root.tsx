import { createRootRoute, HeadContent, Outlet, Scripts, useLocation } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { NotFound } from "@/components/not-found"
import { WebsiteProviders } from "@/components/providers"
import { themeBootstrapScript } from "@/components/theme-toggle"
import { localeFromPathname } from "@/lib/i18n"
import { siteDescription } from "@/lib/metadata"
import appCss from "@/styles/app.css?url"

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    links: [
      { href: appCss, rel: "stylesheet" },
      { href: "/favicon.svg", rel: "icon", type: "image/svg+xml" },
      { href: "/site.webmanifest", rel: "manifest" },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { content: "#121117", name: "theme-color" },
      { content: siteDescription, name: "description" },
      { title: "Cypheria" },
    ],
  }),
  notFoundComponent: NotFound,
})

function RootComponent() {
  const locale = localeFromPathname(useLocation().pathname)
  return (
    <RootDocument locale={locale}>
      <WebsiteProviders>
        <Outlet />
      </WebsiteProviders>
    </RootDocument>
  )
}

function RootDocument({ children, locale }: { children: ReactNode; locale: string }) {
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant inline bootstrap prevents a theme flash before hydration */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
