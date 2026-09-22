import type { AgentOperation, ToolchainId, ToolchainView } from "@cypheria/protocol"
import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Card, CardContent } from "@cypheria/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cypheria/ui/components/collapsible"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, CircleAlert, Download, LoaderCircle, Wrench } from "lucide-react"
import { useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { waitForAgentOperation } from "./agent-operation"

const toolchainNames: Record<ToolchainId, string> = {
  node: "Node.js",
  python: "Python",
  uv: "uv",
}

const toolchainsQueryKey = ["cypheria", "agent-toolchains"] as const

function ToolchainRow({ toolchain }: Readonly<{ toolchain: ToolchainView }>) {
  const queryClient = useQueryClient()
  const [operation, setOperation] = useState<AgentOperation>()
  const update = useMutation({
    mutationFn: async () => {
      const client = await ensureCypheriaClient()
      return waitForAgentOperation(await client.agents.updateToolchain(toolchain.id), setOperation)
    },
    onSuccess: async () => {
      setOperation(undefined)
      await queryClient.invalidateQueries({ queryKey: toolchainsQueryKey })
    },
  })
  const progress = Math.round((operation?.progress ?? 0) * 100)
  const actionLabel = toolchain.activeVersion ? "Update" : "Install"
  const targetVersion = toolchain.availableVersion
    ? `${toolchainNames[toolchain.id]} to v${toolchain.availableVersion}`
    : toolchainNames[toolchain.id]

  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{toolchainNames[toolchain.id]}</span>
          <Badge variant={toolchain.activeVersion ? "secondary" : "outline"}>
            {toolchain.activeVersion ? `v${toolchain.activeVersion}` : "Not installed"}
          </Badge>
        </div>
        {toolchain.error || update.error ? (
          <p className="mt-2 text-xs text-destructive">
            {update.error?.message ?? toolchain.error}
          </p>
        ) : null}
      </div>
      {toolchain.updateAvailable ? (
        <Button
          aria-label={
            update.error
              ? `${actionLabel} ${toolchainNames[toolchain.id]} failed: ${update.error.message}`
              : `${actionLabel} ${targetVersion}`
          }
          disabled={update.isPending}
          size={update.isPending ? "default" : "icon"}
          title={update.error?.message ?? `${actionLabel} ${targetVersion}`}
          type="button"
          variant="outline"
          onClick={() => update.mutate()}
        >
          {update.isPending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              <span className="tabular-nums">{progress}%</span>
            </>
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
        </Button>
      ) : null}
    </div>
  )
}

export function ToolchainCard() {
  const toolchains = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).agents.listToolchains(),
    queryKey: toolchainsQueryKey,
  })
  return (
    <Card className="mt-4 py-0">
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="group flex w-full items-center gap-4 p-4 text-left hover:bg-muted/30">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <Wrench className="size-5" />
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="font-semibold leading-none">Managed toolchains</span>
            <span className="text-sm text-muted-foreground">
              Toolchains managed for Agent harnesses.
            </span>
          </div>
          <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="grid gap-3 px-4 pb-4">
            {toolchains.isLoading ? <Skeleton className="h-36" /> : null}
            {toolchains.error ? (
              <Alert variant="destructive">
                <CircleAlert className="size-4" />
                <AlertTitle>Toolchains unavailable</AlertTitle>
                <AlertDescription>{toolchains.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {toolchains.data?.map((toolchain) => (
              <ToolchainRow key={toolchain.id} toolchain={toolchain} />
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
