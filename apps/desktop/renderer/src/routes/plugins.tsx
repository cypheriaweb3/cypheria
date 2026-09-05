import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { z } from "zod"

export const Route = createFileRoute("/plugins")({
  component: lazyRouteComponent(() => import("../components/plugins-page"), "PluginsRoute"),
  ssr: false,
  validateSearch: z.object({
    view: z.enum(["plugins", "skills", "manage"]).optional().catch(undefined),
    plugin: z.string().optional().catch(undefined),
  }),
})
