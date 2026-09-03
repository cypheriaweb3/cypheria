/// <reference types="vite/client" />

import appStyles from "@cypheria/ui/styles.css?url"
import { createRootRoute, lazyRouteComponent } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: lazyRouteComponent(() => import("../components/app-shell")),
  head: () => ({
    links: [{ rel: "stylesheet", href: appStyles }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Cypheria" },
    ],
  }),
  ssr: false,
})
