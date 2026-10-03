import { Button } from "@cypheria/ui/components/button"
import { Plus, RefreshCw } from "lucide-react"
import { useState } from "react"
import type { McpAgent } from "../integration-api.js"
import { AddMcpDialog, McpServerRow, usePluginIntegrations } from "./plugin-integrations"

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed. Please retry."

/** An Agent's own MCP servers, for Agents that manage them outside plugins. */
export function AgentMcpSection({ agentId, agentName }: { agentId: McpAgent; agentName: string }) {
  const integrations = usePluginIntegrations(true, agentId)
  const [adding, setAdding] = useState(false)
  const { mcpQuery, servers } = integrations
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">MCP servers</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Servers in {agentName}'s own configuration. Running sessions pick up changes when they
            restart.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            aria-label="Refresh MCP servers"
            variant="outline"
            size="icon-sm"
            disabled={mcpQuery.isFetching}
            onClick={() => void mcpQuery.refetch()}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add server
          </Button>
        </div>
      </div>
      {mcpQuery.isPending && (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Connecting to MCP servers…
        </p>
      )}
      {mcpQuery.error && (
        <p role="alert" className="py-4 text-sm text-destructive">
          {errorText(mcpQuery.error)}
        </p>
      )}
      {integrations.notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {integrations.notice}
        </p>
      )}
      <div className="grid gap-1">
        {servers.map((server) => (
          <McpServerRow key={server.name} server={server} integrations={integrations} />
        ))}
      </div>
      {mcpQuery.isSuccess && servers.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No MCP servers configured.
        </p>
      )}
      <AddMcpDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={() => setAdding(false)}
        integrations={integrations}
      />
    </div>
  )
}
