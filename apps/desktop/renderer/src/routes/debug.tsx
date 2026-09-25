import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router"

import { isDesktopDevelopment } from "../development-mode.js"

export const Route = createFileRoute("/debug")({
  beforeLoad: () => {
    if (!isDesktopDevelopment()) throw redirect({ to: "/" })
  },
  component: lazyRouteComponent(() => import("../components/debug-storage")),
  ssr: false,
})
