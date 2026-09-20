/// <reference types="vite/client" />

import appIcon from "@cypheria/ui/assets/brand/cypheria-app-icon.svg?url"
import appStyles from "@cypheria/ui/styles.css?url"
import { createRootRoute, lazyRouteComponent } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: lazyRouteComponent(() => import("../components/app-shell")),
  head: () => ({
    links: [
      { rel: "stylesheet", href: appStyles },
      { rel: "icon", href: appIcon, type: "image/svg+xml" },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Cypheria" },
    ],
  }),
  ssr: false,
})
