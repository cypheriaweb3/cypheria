/// <reference types="vite/client" />

import { createRootRoute, lazyRouteComponent } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: lazyRouteComponent(() => import("../components/app-shell")),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Cypheria" },
    ],
  }),
  ssr: false,
})
