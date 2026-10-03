import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { z } from "zod"

/**
 * A plugin's global entry point, as `cypheria://plugins/<plugin>@<marketplace>/app/<tool>` and the
 * Sidebar open it. `path` is the App-relative URL the App receives as `openai/deepLink`.
 */
export const Route = createFileRoute("/plugins_/$pluginId/app/$tool")({
  component: lazyRouteComponent(() => import("../components/extensions/global-app-page")),
  ssr: false,
  validateSearch: z.object({
    path: z
      .string()
      .startsWith("/")
      .refine((value) => !value.includes("#"))
      .optional()
      .catch(undefined),
  }),
})
