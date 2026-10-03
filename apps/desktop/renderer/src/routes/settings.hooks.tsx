import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"

export const Route = createFileRoute("/settings/hooks")({
  component: lazyRouteComponent(() => import("../components/hooks-page"), "HooksPage"),
  ssr: false,
})
