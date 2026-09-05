import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"

export const Route = createFileRoute("/settings/plugins")({
  component: lazyRouteComponent(() => import("../components/plugins-page"), "PluginManagementPage"),
  ssr: false,
})
