import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Pause, Play, RotateCw, Workflow } from "lucide-react"
import { WorkbenchFrame } from "../components/workbench-frame"

export const Route = createFileRoute("/automations")({ component: AutomationsRoute })

function AutomationsRoute() {
  const queryClient = useQueryClient()
  const tasks = useQuery({
    queryFn: () => window.cypheria?.automation.listTasks() ?? [],
    queryKey: ["automation", "tasks"],
  })
  const action = useMutation({
    mutationFn: async ({
      id,
      kind,
      revision,
    }: {
      id: string
      kind: "pause" | "resume" | "run"
      revision: number
    }) => {
      if (!window.cypheria) throw new Error("Automations are only available in the desktop app.")
      if (kind === "pause") return window.cypheria.automation.pauseTask(id, revision)
      if (kind === "resume") return window.cypheria.automation.resumeTask(id, revision)
      return window.cypheria.automation.runTask(id)
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["automation"] }),
  })

  return (
    <WorkbenchFrame>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Workflow className="size-5" />
          Automations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Run and supervise local tasks. Signing remains subject to wallet policy and approval.
        </p>
      </header>
      {tasks.isLoading ? (
        <Skeleton className="h-40" />
      ) : tasks.data?.length ? (
        <div className="grid gap-3">
          {tasks.data.map((task) => (
            <Card key={task.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{task.title}</CardTitle>
                    <CardDescription>
                      {task.definition.handler} · {task.workspace.label ?? task.workspace.path}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">{task.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {task.trigger.kind === "scheduled"
                    ? `${task.trigger.rrule} · ${task.trigger.timezone}`
                    : task.trigger.kind}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={action.isPending || task.status !== "enabled"}
                    onClick={() =>
                      action.mutate({ id: task.id, kind: "run", revision: task.revision })
                    }
                  >
                    <RotateCw className="size-4" />
                    Run now
                  </Button>
                  {task.status === "paused" ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        action.mutate({ id: task.id, kind: "resume", revision: task.revision })
                      }
                    >
                      <Play className="size-4" />
                      Resume
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={task.status !== "enabled"}
                      onClick={() =>
                        action.mutate({ id: task.id, kind: "pause", revision: task.revision })
                      }
                    >
                      <Pause className="size-4" />
                      Pause
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No automations yet</CardTitle>
            <CardDescription>
              Ask Cypheria to create a local automation after its handler and wallet policy are
              configured.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {action.error ? <p className="text-sm text-destructive">{action.error.message}</p> : null}
    </WorkbenchFrame>
  )
}
