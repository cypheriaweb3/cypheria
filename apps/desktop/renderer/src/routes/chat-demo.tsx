import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router"

import { isDesktopDevelopment } from "../development-mode.js"

export const Route = createFileRoute("/chat-demo")({
  beforeLoad: () => {
    if (!isDesktopDevelopment()) throw redirect({ to: "/" })
  },
  component: lazyRouteComponent(() => import("../components/chat-demo")),
  ssr: false,
})
