import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { z } from "zod"

export const Route = createFileRoute("/")({
  component: lazyRouteComponent(() => import("../components/task-workspace")),
  ssr: false,
  validateSearch: z.object({
    thread: z.string().min(1).optional().catch(undefined),
    prompt: z.string().optional().catch(undefined),
  }),
})
