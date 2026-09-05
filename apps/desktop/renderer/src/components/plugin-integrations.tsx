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
import { z } from "zod"
import type {
  CodexAppListResult,
  CodexAppView,
  CodexMcpListResult,
  CodexMcpView,
} from "../../../ipc/src/index.js"
import { McpAddRequestSchema } from "../../../ipc/src/integrations.js"
import githubLogo from "../assets/plugins/github.svg"
import gmailLogo from "../assets/plugins/gmail.svg"

const previewApps: CodexAppListResult = {
  runtimeError: null,
  apps: [
    {
      id: "github",
      name: "GitHub",
      description: "Access repositories, issues, and pull requests",
      logoUrl: githubLogo,
      installUrl: "https://github.com",
      accessible: true,
      enabled: true,
      effectiveEnabled: true,
      callable: true,
      pluginNames: ["GitHub"],
    },
    {
      id: "gmail",
      name: "Gmail",
      description: "Read and manage Gmail",
      logoUrl: gmailLogo,
      installUrl: "https://mail.google.com",
      accessible: false,
      enabled: true,
      effectiveEnabled: null,
      callable: null,
      pluginNames: ["Gmail"],
    },
  ],
}
const previewMcp: CodexMcpListResult = {
  servers: [
    {
      name: "codex-security",
      pluginId: "codex-security@openai-curated",
      enabled: null,
      configurable: false,
      authStatus: "oAuth",
      runtimeStatus: "connected",
      tools: [
        { name: "scan", description: "Inspect authorized repositories for security findings." },
      ],
      resourceCount: 0,
    },
    {
      name: "project-docs",
      pluginId: null,
      enabled: true,
      configurable: true,
      authStatus: "notLoggedIn",
      runtimeStatus: "authenticationRequired",
      tools: [],
      resourceCount: 0,
    },
    {
      name: "local-tools",
      pluginId: null,
      enabled: false,
      configurable: true,
      authStatus: "unsupported",
      runtimeStatus: "disabled",
      tools: [],
      resourceCount: 0,
    },
  ],
}

const completionSchema = z.object({
  method: z.literal("mcpServer/oauthLogin/completed"),
  params: z.object({ name: z.string(), success: z.boolean(), error: z.string().optional() }),
})
const notificationSchema = z.object({ method: z.string() })
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed. Please retry."

export function usePluginIntegrations(active: boolean) {
  const cache = useQueryClient()
  const [sampleApps, setSampleApps] = useState(previewApps)
  const [sampleMcp, setSampleMcp] = useState(previewMcp)
  const [notice, setNotice] = useState<string | null>(null)
  const [authorizing, setAuthorizing] = useState<string | null>(null)
  const appsQuery = useQuery({
    queryKey: ["codex", "apps"],
    enabled: active,
    queryFn: () => window.cypheria?.codex.listApps(true) ?? sampleApps,
  })
  const mcpQuery = useQuery({
    queryKey: ["codex", "mcp"],
    enabled: active,
    queryFn: () => window.cypheria?.codex.listMcp() ?? sampleMcp,
  })
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["codex", "apps"] }),
      cache.invalidateQueries({ queryKey: ["codex", "mcp"] }),
    ])
  }
  useEffect(() => {
    if (!active || !window.cypheria) return
    const unsubscribe = window.cypheria.codex.onEvent((event) => {
      if (event.event !== "codex.notification") return
      const completion = completionSchema.safeParse(event.payload)
      if (completion.success) {
        const { name, success, error } = completion.data.params
        setAuthorizing((current) => (current === name ? null : current))
        setNotice(
          success
            ? `${name}: authorization completed. Refreshing availability…`
            : `${name}: ${error ?? "Authorization was not completed. You can retry."}`
        )
        void cache.invalidateQueries({ queryKey: ["codex", "mcp"] })
      }
      const notification = notificationSchema.safeParse(event.payload)
      if (notification.success && notification.data.method === "mcpServer/startupStatus/updated")
        void cache.invalidateQueries({ queryKey: ["codex", "mcp"] })
    })
    // An external connection page has no trusted local success callback: re-read on return.
    const onFocus = () => {
      void cache.invalidateQueries({ queryKey: ["codex", "apps"] })
      void cache.invalidateQueries({ queryKey: ["codex", "mcp"] })
    }
    window.addEventListener("focus", onFocus)
    return () => {
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
      if (window.cypheria) {
        await window.cypheria.codex.setAppEnabled(app.id, enabled)
        return
      }
      setSampleApps((old) => ({
        ...old,
        apps: old.apps.map((a) =>
          a.id === app.id
            ? { ...a, enabled, effectiveEnabled: enabled, callable: enabled && a.accessible }
            : a
        ),
      }))
    },
    onSettled: refresh,
  })
  const mcpMutation = useMutation({
    mutationFn: async ({ server, enabled }: { server: CodexMcpView; enabled: boolean }) => {
      if (window.cypheria) {
        await window.cypheria.codex.setMcpEnabled(server.name, enabled)
        return
      }
      setSampleMcp((old) => ({
        servers: old.servers.map((s) =>
          s.name === server.name
            ? { ...s, enabled, runtimeStatus: enabled ? "notStarted" : "disabled" }
            : s
        ),
      }))
    },
    onSettled: refresh,
  })
  const connect = useMutation({
    mutationFn: async (app: CodexAppView) => {
      if (!window.cypheria) {
        setNotice(
          "Preview only. In Electron this opens the app connection page; returning refreshes availability."
        )
        return
      }
      await window.cypheria.codex.connectApp(app.id)
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
      if (!window.cypheria) {
        setNotice(
          "Preview only. OAuth is started by Electron; the preview does not change authentication state."
        )
        return
      }
      await window.cypheria.codex.loginMcp(server.name)
    },
    onError: () => setAuthorizing(null),
  })
  const addMcp = useMutation({
    mutationFn: async (input: { name: string; url: string }) => {
      McpAddRequestSchema.parse(input)
      if (window.cypheria) {
        await window.cypheria.codex.addMcp(input)
        return
      }
      if (sampleMcp.servers.some((server) => server.name === input.name))
        throw new Error("A server with this name already exists.")
      setSampleMcp((old) => ({
        servers: [
          ...old.servers,
          {
            name: input.name,
            pluginId: null,
            enabled: true,
            configurable: true,
            authStatus: "unknown",
            runtimeStatus: null,
            tools: [],
            resourceCount: 0,
          },
        ],
      }))
    },
    onSettled: refresh,
  })
  return {
    apps: window.cypheria ? (appsQuery.data?.apps ?? []) : sampleApps.apps,
    servers: window.cypheria ? (mcpQuery.data?.servers ?? []) : sampleMcp.servers,
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
