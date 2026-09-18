import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Input } from "@cypheria/ui/components/input"
import { Switch } from "@cypheria/ui/components/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ExternalLink, Plug, Settings } from "lucide-react"
import { useEffect, useId, useState } from "react"
import type { CodexAppView, CodexMcpView } from "../../../ipc/src/index.js"
import { McpAddRequestSchema } from "../../../ipc/src/integrations.js"
import { ensureCypheriaClient } from "../cypheria-client.js"
import { integrationApi } from "../integration-api.js"

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed. Please retry."

export function usePluginIntegrations(active: boolean) {
  const cache = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [authorizing, setAuthorizing] = useState<string | null>(null)
  const appsQuery = useQuery({
    queryKey: ["codex", "apps"],
    enabled: active,
    queryFn: () => {
      return integrationApi.apps.list(true)
    },
  })
  const mcpQuery = useQuery({
    queryKey: ["codex", "mcp"],
    enabled: active,
    queryFn: () => {
      return integrationApi.mcp.list()
    },
  })
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["codex", "apps"] }),
      cache.invalidateQueries({ queryKey: ["codex", "mcp"] }),
    ])
  }
  useEffect(() => {
    if (!active) return
    let disposed = false
    let unsubscribe: () => void = () => undefined
    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      unsubscribe = client.on("thread.event.notification", (message) => {
        const event = message.payload.event
        if (event.type !== "provider" || event.agentId !== "codex") return
        const payload = event.payload as Record<string, unknown>
        if (event.nativeType === "agent.codex.mcp_server.oauth_login.completed.notification") {
          const name = typeof payload.name === "string" ? payload.name : "MCP server"
          const success = payload.success === true
          const error = typeof payload.error === "string" ? payload.error : undefined
          setAuthorizing((current) => (current === name ? null : current))
          setNotice(
            success
              ? `${name}: authorization completed. Refreshing availability…`
              : `${name}: ${error ?? "Authorization was not completed. You can retry."}`
          )
          void cache.invalidateQueries({ queryKey: ["codex", "mcp"] })
        }
        if (event.nativeType === "agent.codex.mcp_server.startup_status.updated.notification") {
          void cache.invalidateQueries({ queryKey: ["codex", "mcp"] })
        }
      })
    })
    // An external connection page has no trusted local success callback: re-read on return.
    const onFocus = () => {
      void cache.invalidateQueries({ queryKey: ["codex", "apps"] })
      void cache.invalidateQueries({ queryKey: ["codex", "mcp"] })
    }
    window.addEventListener("focus", onFocus)
    return () => {
      disposed = true
      unsubscribe()
      window.removeEventListener("focus", onFocus)
    }
  }, [active, cache])
  useEffect(() => {
    if (!authorizing) return
    const timeout = window.setTimeout(() => {
      setAuthorizing(null)
      setNotice("No authorization result received. Refresh status or retry sign in.")
    }, 120_000)
    return () => window.clearTimeout(timeout)
  }, [authorizing])
  const appMutation = useMutation({
    mutationFn: async ({ app, enabled }: { app: CodexAppView; enabled: boolean }) => {
      await integrationApi.apps.setEnabled(app.id, enabled)
    },
    onSettled: refresh,
  })
  const mcpMutation = useMutation({
    mutationFn: async ({ server, enabled }: { server: CodexMcpView; enabled: boolean }) => {
      await integrationApi.mcp.setEnabled(server.name, enabled)
    },
    onSettled: refresh,
  })
  const connect = useMutation({
    mutationFn: async (app: CodexAppView) => {
      await integrationApi.apps.connect(app.id)
      setNotice(
        "Complete connection in your browser, then return here. Availability will be refreshed."
      )
    },
  })
  const login = useMutation({
    onMutate: (server: CodexMcpView) => {
      setNotice(null)
      if (window.cypheria) setAuthorizing(server.name)
    },
    mutationFn: async (server: CodexMcpView) => {
      await integrationApi.mcp.login(server.name)
    },
    onError: () => setAuthorizing(null),
  })
  const addMcp = useMutation({
    mutationFn: async (input: { name: string; url: string }) => {
      McpAddRequestSchema.parse(input)
      await integrationApi.mcp.add(input)
    },
    onSettled: refresh,
  })
  return {
    apps: appsQuery.data?.apps ?? [],
    servers: mcpQuery.data?.servers ?? [],
    appsQuery,
    mcpQuery,
    notice,
    authorizing,
    refresh,
    appMutation,
    mcpMutation,
    connect,
    login,
    addMcp,
    error: appMutation.error ?? mcpMutation.error ?? connect.error ?? login.error,
  }
}

export type PluginIntegrations = ReturnType<typeof usePluginIntegrations>

export function appState(app: CodexAppView) {
  if (!app.accessible) return "Not connected"
  if (!app.enabled) return "Disabled"
  if (app.effectiveEnabled === false) return "Restricted"
  if (app.callable === true) return "Ready"
  if (app.callable === false) return "No available tools"
  return "Available"
}

export function AppConnection({
  app,
  integrations,
}: {
  app: CodexAppView
  integrations: PluginIntegrations
}) {
  if (!app.accessible)
    return app.installUrl ? (
      <Button
        size="sm"
        variant="outline"
        disabled={integrations.connect.isPending}
        onClick={() => integrations.connect.mutate(app)}
      >
        Connect <ExternalLink className="size-3" />
      </Button>
    ) : (
      <span className="text-xs text-muted-foreground">Unavailable</span>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="outline" className="gap-1.5 rounded-lg" />}
      >
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${app.callable && app.enabled ? "bg-green-600" : "bg-muted-foreground"}`}
        />
        {appState(app)}
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={integrations.appMutation.isPending}
          onClick={() => integrations.appMutation.mutate({ app, enabled: !app.enabled })}
        >
          {app.enabled ? "Disable in Cypheria" : "Enable in Cypheria"}
        </DropdownMenuItem>
        {app.installUrl && (
          <DropdownMenuItem
            disabled={integrations.connect.isPending}
            onClick={() => integrations.connect.mutate(app)}
          >
            Manage connection <ExternalLink />
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function IntegrationAppRow({
  app,
  integrations,
}: {
  app: CodexAppView
  integrations: PluginIntegrations
}) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex min-h-[72px] min-w-0 items-center gap-3 rounded-xl px-2 py-3 hover:bg-muted/50">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70">
        {app.logoUrl && !failed ? (
          <img
            alt=""
            src={app.logoUrl}
            onError={() => setFailed(true)}
            className="size-8 object-contain"
          />
        ) : (
          <Plug className="size-5 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{app.name}</p>
        <p className="mt-1 truncate text-sm text-muted-foreground">{app.description}</p>
      </div>
      <AppConnection app={app} integrations={integrations} />
      {app.accessible && (
        <Switch
          aria-label={`Enable ${app.name}`}
          checked={app.enabled}
          disabled={integrations.appMutation.isPending}
          onCheckedChange={(enabled) => integrations.appMutation.mutate({ app, enabled })}
        />
      )}
    </div>
  )
}

const runtimeLabels: Record<NonNullable<CodexMcpView["runtimeStatus"]>, string> = {
  notStarted: "Not started",
  starting: "Starting…",
  connected: "Connected",
  authenticationRequired: "Sign in required",
  failed: "Connection failed",
  cancelled: "Cancelled",
  disabled: "Disabled",
}
export const mcpState = (server: CodexMcpView) =>
  server.enabled === false
    ? "Disabled"
    : server.runtimeStatus
      ? runtimeLabels[server.runtimeStatus]
      : "Runtime status unavailable"
export function McpServerRow({
  server,
  integrations,
  compact = false,
}: {
  server: CodexMcpView
  integrations: PluginIntegrations
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const canLogin =
    server.enabled !== false &&
    (server.authStatus === "notLoggedIn" ||
      server.authStatus === "oAuth" ||
      server.runtimeStatus === "authenticationRequired")
  const authorizing = integrations.authorizing === server.name
  return (
    <>
      <div className="flex min-h-[68px] min-w-0 items-center gap-3 rounded-xl px-2 py-3 hover:bg-muted/50">
        <Plug className="mx-2.5 size-5 shrink-0 text-muted-foreground" />
        <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm">{server.name}</p>
          {!compact && (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {mcpState(server)} · {server.tools.length} tools
            </p>
          )}
        </button>
        <Button
          aria-label={`Manage ${server.name}`}
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
        >
          <Settings className="size-4" />
        </Button>
        {!compact && server.configurable && (
          <Switch
            aria-label={`Enable ${server.name}`}
            checked={server.enabled ?? false}
            disabled={integrations.mcpMutation.isPending}
            onCheckedChange={(enabled) => integrations.mcpMutation.mutate({ server, enabled })}
          />
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{server.name}</DialogTitle>
            <DialogDescription>{mcpState(server)}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[110px_1fr] gap-3 text-sm">
            <dt className="text-muted-foreground">Authentication</dt>
            <dd>
              {
                {
                  unknown: "Unknown",
                  unsupported: "OAuth not supported",
                  notLoggedIn: "Not signed in",
                  bearerToken: "Bearer token configured",
                  oAuth: "OAuth credentials stored",
                }[server.authStatus]
              }
            </dd>
            <dt className="text-muted-foreground">Resources</dt>
            <dd>{server.resourceCount}</dd>
          </dl>
          {server.pluginId && (
            <p className="text-sm text-muted-foreground">
              Managed by plugin {server.pluginId}. Enable or disable the owning plugin in the
              Plugins tab.
            </p>
          )}
          {canLogin && (
            <Button
              disabled={integrations.login.isPending || authorizing || !!integrations.authorizing}
              onClick={() => integrations.login.mutate(server)}
            >
              {authorizing
                ? "Waiting for authorization…"
                : server.authStatus === "oAuth"
                  ? "Sign in again"
                  : "Sign in"}
              <ExternalLink className="size-4" />
            </Button>
          )}
          {integrations.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(integrations.error)}
            </p>
          )}
          {integrations.notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {integrations.notice}
            </p>
          )}
          <h3 className="border-b pb-2 text-sm font-medium">Tools · {server.tools.length}</h3>
          {server.tools.length ? (
            server.tools.map((tool) => (
              <div key={tool.name}>
                <p className="break-words text-sm">{tool.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No tools reported. Connect or enable the server, then refresh.
            </p>
          )}
          <Button
            variant="outline"
            disabled={integrations.mcpQuery.isFetching}
            onClick={() => void integrations.mcpQuery.refetch()}
          >
            Refresh status
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function AddMcpDialog({
  open,
  onOpenChange,
  onAdded,
  integrations,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
  integrations: PluginIntegrations
}) {
  const [name, setName] = useState("")
  const nameId = useId()
  const urlId = useId()
  const [url, setUrl] = useState("")
  const input = { name: name.trim(), url: url.trim() }
  const valid = McpAddRequestSchema.safeParse(input).success
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!integrations.addMcp.isPending) {
          onOpenChange(next)
          integrations.addMcp.reset()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            Connect a trusted HTTP MCP server. It can provide tools to Cypheria; only add servers
            you trust. Credentials are managed by Codex, not this form.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid && !integrations.addMcp.isPending)
              integrations.addMcp.mutate(input, {
                onSuccess: () => {
                  onAdded()
                  setName("")
                  setUrl("")
                },
              })
          }}
        >
          <label htmlFor={nameId} className="grid gap-2 text-sm">
            Name
            <Input
              id={nameId}
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="project-docs"
              disabled={integrations.addMcp.isPending}
            />
          </label>
          <p className="-mt-2 text-xs text-muted-foreground">
            Letters, numbers, hyphens and underscores. Existing servers are not overwritten.
          </p>
          <label htmlFor={urlId} className="grid gap-2 text-sm">
            Server URL
            <Input
              id={urlId}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/mcp"
              disabled={integrations.addMcp.isPending}
            />
          </label>
          {!!url && !valid && (
            <p className="text-xs text-muted-foreground">
              Enter a valid name and HTTP(S) URL without embedded credentials.
            </p>
          )}
          {integrations.addMcp.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(integrations.addMcp.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={integrations.addMcp.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || integrations.addMcp.isPending}>
              {integrations.addMcp.isPending ? "Adding…" : "Add server"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
