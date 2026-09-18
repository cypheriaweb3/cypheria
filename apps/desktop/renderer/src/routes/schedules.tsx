import type { Schedule } from "@cypheria/protocol"
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
import { useEffect } from "react"
import { WorkbenchFrame } from "../components/workbench-frame"
import { cypheriaClient, ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/schedules")({ component: SchedulesRoute })

const scheduleQueryKey = ["cypheria", "schedules"] as const

const describeCadence = (schedule: Schedule): string => {
  switch (schedule.cadence.type) {
    case "once":
      return `Once · ${new Date(schedule.cadence.at).toLocaleString()}`
    case "interval":
      return `Every ${Math.round(schedule.cadence.everyMs / 1_000)} seconds`
    case "cron":
      return `${schedule.cadence.expression}${schedule.cadence.timezone ? ` · ${schedule.cadence.timezone}` : ""}`
  }
}

const describeTarget = (schedule: Schedule): string => {
  switch (schedule.target.type) {
    case "new-thread":
      return `New ${schedule.target.agentId} thread`
    case "thread":
      return `Thread ${schedule.target.threadId}`
    case "web3":
      return schedule.target.method
  }
}

function SchedulesRoute() {
  const queryClient = useQueryClient()
  const schedules = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).schedules.list(),
    queryKey: scheduleQueryKey,
  })
  const action = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: "pause" | "resume" | "run" }) => {
      const client = await ensureCypheriaClient()
      if (kind === "pause") return client.schedules.pause(id)
      if (kind === "resume") return client.schedules.resume(id)
      return client.schedules.run(id)
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: scheduleQueryKey }),
  })

  useEffect(
    () =>
      cypheriaClient.subscribe((message) => {
        if (message.type.startsWith("schedule.")) {
          void queryClient.invalidateQueries({ queryKey: scheduleQueryKey })
        }
      }),
    [queryClient]
  )

  return (
    <WorkbenchFrame>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Workflow className="size-5" />
          Schedules
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Run and supervise Server schedules. Signing remains subject to wallet policy and approval.
        </p>
      </header>
      {schedules.isLoading ? (
        <Skeleton className="h-40" />
      ) : schedules.data?.length ? (
        <div className="grid gap-3">
          {schedules.data.map((schedule) => (
            <Card key={schedule.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{schedule.name ?? "Untitled schedule"}</CardTitle>
                    <CardDescription>{describeTarget(schedule)}</CardDescription>
                  </div>
                  <Badge variant="secondary">{schedule.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {describeCadence(schedule)}
                  {schedule.nextRunAt
                    ? ` · Next ${new Date(schedule.nextRunAt).toLocaleString()}`
                    : ""}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={action.isPending || schedule.status === "completed"}
                    onClick={() => action.mutate({ id: schedule.id, kind: "run" })}
                  >
                    <RotateCw className="size-4" />
                    Run now
                  </Button>
                  {schedule.status === "paused" ? (
                    <Button
                      size="sm"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: schedule.id, kind: "resume" })}
                    >
                      <Play className="size-4" />
                      Resume
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending || schedule.status !== "active"}
                      onClick={() => action.mutate({ id: schedule.id, kind: "pause" })}
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
            <CardTitle>No schedules yet</CardTitle>
            <CardDescription>
              Create one through the Cypheria API or CLI to start a thread, continue a thread, or
              run a policy-controlled Web3 operation.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {schedules.error ? (
        <p className="text-sm text-destructive">{schedules.error.message}</p>
      ) : null}
      {action.error ? <p className="text-sm text-destructive">{action.error.message}</p> : null}
    </WorkbenchFrame>
  )
}
