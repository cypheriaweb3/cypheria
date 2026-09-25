import { AgentIdSchema } from "@cypheria/protocol"
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"
import { z } from "zod"

export const Route = createFileRoute("/")({
  component: lazyRouteComponent(() => import("../components/chat-workspace")),
  ssr: false,
  validateSearch: z.object({
    agent: AgentIdSchema.optional().catch(undefined),
    prompt: z.string().optional().catch(undefined),
    project: z.string().min(1).optional().catch(undefined),
    section: z.string().min(1).optional().catch(undefined),
    thread: z.string().min(1).optional().catch(undefined),
  }),
})
