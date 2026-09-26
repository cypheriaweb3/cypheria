import type {
  AgentId,
  NetworkProxyDraft,
  NetworkProxyProtocol,
  NetworkProxySnapshot,
  NetworkProxyTestResult,
} from "@cypheria/protocol"
import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@cypheria/ui/components/alert-dialog"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Card, CardContent } from "@cypheria/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cypheria/ui/components/collapsible"
import { Field, FieldDescription, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import { Switch } from "@cypheria/ui/components/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ChevronDown, CircleAlert, Network, Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"

type ProxyDraftForm = {
  bypass: string
  host: string
  id: string
  mode: "direct" | "manual" | "system"
  name: string
  password: string
  port: string
  protocol: NetworkProxyProtocol
  removePassword: boolean
  username: string
}

const emptyDraft = (): ProxyDraftForm => ({
  bypass: "localhost, 127.0.0.1, ::1",
  host: "127.0.0.1",
  id: `proxy-${Date.now().toString(36)}`,
  mode: "manual",
  name: "New proxy",
  password: "",
  port: "7890",
  protocol: "http",
  removePassword: false,
  username: "",
})

const toDraft = (proxy: NetworkProxySnapshot): ProxyDraftForm =>
  proxy.mode === "manual"
    ? {
        bypass: proxy.bypass.join(", "),
        host: proxy.host,
        id: proxy.id,
        mode: proxy.mode,
        name: proxy.name,
        password: "",
        port: String(proxy.port),
        protocol: proxy.protocol,
        removePassword: false,
        username: proxy.username ?? "",
      }
    : { ...emptyDraft(), id: proxy.id, mode: proxy.mode, name: proxy.name }

const toProxy = (draft: ProxyDraftForm): NetworkProxyDraft => {
  if (draft.mode !== "manual")
    return { id: draft.id.trim(), mode: draft.mode, name: draft.name.trim() }
  return {
    bypass: draft.bypass.split(/[\s,]+/u).filter(Boolean),
    host: draft.host.trim(),
    id: draft.id.trim(),
    mode: "manual",
    name: draft.name.trim(),
    password: draft.removePassword ? null : draft.password || undefined,
    port: Number(draft.port),
    protocol: draft.protocol,
    username: draft.username || undefined,
  }
}

const modeLabel = (proxy: NetworkProxySnapshot): string => {
  if (proxy.mode !== "manual") return proxy.mode === "system" ? "System" : "Direct"
  return `${proxy.protocol.toUpperCase()} · ${proxy.host}:${proxy.port}`
}

export function NetworkProxyCard({ agentId }: Readonly<{ agentId: AgentId }>) {
  const queryClient = useQueryClient()
  const proxies = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).server.networkProxies(),
    queryKey: ["server", "network-proxies"],
  })
  const config = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    queryKey: ["settings", "server-config"],
  })
  const [draft, setDraft] = useState<ProxyDraftForm>(() => emptyDraft())
  const [pendingDelete, setPendingDelete] = useState<NetworkProxySnapshot | null>(null)
  const [testResult, setTestResult] = useState<NetworkProxyTestResult | null>(null)
  const editedProxy = proxies.data?.proxies.find((proxy) => proxy.id === draft.id)
  const draftExists = Boolean(editedProxy)
  const associatedAgents = pendingDelete
    ? Object.entries(config.data?.config.agents ?? {}).flatMap(([id, settings]) =>
        settings.networkProxyId === pendingDelete.id ? [id] : []
      )
    : []

  const saveProxy = useMutation({
    mutationFn: async (proxy: NetworkProxyDraft) =>
      (await ensureCypheriaClient()).server.patchNetworkProxies({
        proxies: { [proxy.id]: proxy },
      }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["server", "network-proxies"], snapshot)
      const saved = snapshot.proxies.find((proxy) => proxy.id === draft.id)
      if (saved) setDraft(toDraft(saved))
    },
  })
  const deleteProxy = useMutation({
    mutationFn: async (proxyId: string) =>
      (await ensureCypheriaClient()).server.patchNetworkProxies({
        ...(proxies.data?.defaultProxyId === proxyId ? { defaultProxyId: null } : {}),
        proxies: { [proxyId]: null },
      }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["server", "network-proxies"], snapshot)
      void queryClient.invalidateQueries({ queryKey: ["settings", "server-config"] })
      setDraft(emptyDraft())
      setPendingDelete(null)
      setTestResult(null)
    },
  })
  const setDefault = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await ensureCypheriaClient()).server.patchNetworkProxies({
        defaultProxyId: enabled ? draft.id : null,
      }),
    onSuccess: (snapshot) => queryClient.setQueryData(["server", "network-proxies"], snapshot),
  })
  const test = useMutation({
    mutationFn: async (proxy: NetworkProxyDraft) =>
      (await ensureCypheriaClient()).server.testNetworkProxy(agentId, proxy),
    onMutate: () => setTestResult(null),
    onSuccess: setTestResult,
  })

  const parsed = toProxy(draft)
  const numericPort = Number(draft.port)
  const invalid =
    !draft.id.trim() ||
    !draft.name.trim() ||
    (draft.mode === "manual" &&
      (!draft.host.trim() || !/^\d+$/u.test(draft.port) || numericPort < 1 || numericPort > 65_535))
  const defaultProxy = proxies.data?.proxies.find(
    (proxy) => proxy.id === proxies.data?.defaultProxyId
  )
  const error =
    proxies.error?.message ??
    config.error?.message ??
    saveProxy.error?.message ??
    deleteProxy.error?.message ??
    setDefault.error?.message ??
    test.error?.message

  return (
    <>
      <Card className="py-0">
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="group flex w-full items-center gap-4 p-4 text-left hover:bg-muted/30">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
              <Network className="size-5" />
            </span>
            <div className="grid min-w-0 flex-1 gap-1">
              <span className="font-semibold leading-none">Network proxies</span>
              <span className="text-sm text-muted-foreground">
                Manage the Server proxy list used by Agent runtimes.
              </span>
            </div>
            <Badge variant="outline">
              {defaultProxy ? `Default: ${defaultProxy.name}` : "No default"}
            </Badge>
            <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="grid gap-5 px-4 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Saved proxies</h3>
                  <p className="text-xs text-muted-foreground">
                    Credentials stay in the Server proxy file and are never returned to the
                    renderer.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDraft(emptyDraft())
                    setTestResult(null)
                  }}
                >
                  <Plus className="size-4" /> New proxy
                </Button>
              </div>
              <div className="grid gap-1 rounded-md border p-1">
                {(proxies.data?.proxies ?? []).map((proxy) => (
                  <button
                    className={
                      proxy.id === draft.id
                        ? "flex items-center gap-3 rounded-sm bg-muted px-3 py-2 text-left"
                        : "flex items-center gap-3 rounded-sm px-3 py-2 text-left hover:bg-muted/50"
                    }
                    key={proxy.id}
                    type="button"
                    onClick={() => {
                      setDraft(toDraft(proxy))
                      setTestResult(null)
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{proxy.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {proxy.id} · {modeLabel(proxy)}
                      </span>
                    </span>
                    {proxies.data?.defaultProxyId === proxy.id ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : null}
                  </button>
                ))}
                {proxies.isLoading ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>
                ) : null}
                {!proxies.isLoading && proxies.data?.proxies.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                    No saved proxies. Add one to make it available to Agents.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-4 rounded-md border bg-muted/20 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>ID</FieldLabel>
                    <Input
                      disabled={draftExists}
                      value={draft.id}
                      onChange={(event) =>
                        setDraft((value) => ({ ...value, id: event.currentTarget.value }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Name</FieldLabel>
                    <Input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((value) => ({ ...value, name: event.currentTarget.value }))
                      }
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>Mode</FieldLabel>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={draft.mode}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        mode: event.currentTarget.value as ProxyDraftForm["mode"],
                      }))
                    }
                  >
                    <option value="system">Inherit Server environment</option>
                    <option value="direct">Direct connection</option>
                    <option value="manual">Manual proxy</option>
                  </select>
                </Field>
                {draft.mode === "manual" ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-[130px_minmax(0,1fr)_120px]">
                      <Field>
                        <FieldLabel>Protocol</FieldLabel>
                        <select
                          className="h-9 rounded-md border bg-background px-3 text-sm"
                          value={draft.protocol}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              protocol: event.currentTarget.value as NetworkProxyProtocol,
                            }))
                          }
                        >
                          <option value="http">HTTP</option>
                          <option value="https">HTTPS</option>
                          <option value="socks4">SOCKS4</option>
                          <option value="socks5">SOCKS5</option>
                        </select>
                      </Field>
                      <Field>
                        <FieldLabel>Host</FieldLabel>
                        <Input
                          value={draft.host}
                          onChange={(event) =>
                            setDraft((value) => ({ ...value, host: event.currentTarget.value }))
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Port</FieldLabel>
                        <Input
                          inputMode="numeric"
                          type="number"
                          value={draft.port}
                          onChange={(event) =>
                            setDraft((value) => ({ ...value, port: event.currentTarget.value }))
                          }
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel>Username</FieldLabel>
                        <Input
                          autoComplete="off"
                          value={draft.username}
                          onChange={(event) =>
                            setDraft((value) => ({ ...value, username: event.currentTarget.value }))
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Password</FieldLabel>
                        <Input
                          autoComplete="new-password"
                          type="password"
                          placeholder={
                            editedProxy?.mode === "manual" && editedProxy.passwordConfigured
                              ? "Leave blank to keep saved password"
                              : "Optional"
                          }
                          value={draft.password}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              password: event.currentTarget.value,
                              removePassword: false,
                            }))
                          }
                        />
                        {editedProxy?.mode === "manual" && editedProxy.passwordConfigured ? (
                          <Button
                            size="sm"
                            type="button"
                            variant={draft.removePassword ? "secondary" : "ghost"}
                            onClick={() =>
                              setDraft((value) => ({
                                ...value,
                                password: "",
                                removePassword: !value.removePassword,
                              }))
                            }
                          >
                            {draft.removePassword
                              ? "Password will be cleared"
                              : "Clear saved password"}
                          </Button>
                        ) : null}
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel>Bypass proxy for</FieldLabel>
                      <Input
                        value={draft.bypass}
                        onChange={(event) =>
                          setDraft((value) => ({ ...value, bypass: event.currentTarget.value }))
                        }
                      />
                      <FieldDescription>Separate hosts with commas or spaces.</FieldDescription>
                    </Field>
                  </>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <Field orientation="horizontal">
                    <Switch
                      checked={proxies.data?.defaultProxyId === draft.id}
                      disabled={!draftExists}
                      onCheckedChange={(checked) => setDefault.mutate(checked)}
                    />
                    <FieldLabel>Use as Server default</FieldLabel>
                  </Field>
                  <div className="flex gap-2">
                    {editedProxy ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setPendingDelete(editedProxy)}
                      >
                        <Trash2 className="size-4" /> Delete
                      </Button>
                    ) : null}
                    <Button
                      disabled={invalid || test.isPending}
                      type="button"
                      variant="outline"
                      onClick={() => test.mutate(parsed)}
                    >
                      {test.isPending ? "Testing…" : "Test"}
                    </Button>
                    <Button
                      disabled={invalid || saveProxy.isPending}
                      type="button"
                      onClick={() => saveProxy.mutate(parsed)}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
              {testResult ? (
                <Alert variant={testResult.ok ? "default" : "destructive"}>
                  {testResult.ok ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <CircleAlert className="size-4" />
                  )}
                  <AlertTitle>
                    {testResult.ok ? "Connection successful" : "Connection failed"}
                  </AlertTitle>
                  <AlertDescription>
                    {testResult.message} {testResult.latencyMs} ms
                  </AlertDescription>
                </Alert>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteProxy.isPending) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {config.isLoading
                ? "Checking which Agents use this proxy…"
                : config.isError
                  ? "Agent associations could not be loaded, so this proxy cannot be deleted yet."
                  : associatedAgents.length > 0
                    ? `${associatedAgents.join(", ")} will stop using this proxy and return to the Server default.`
                    : "This proxy is not selected by any Agent."}
              {proxies.data?.defaultProxyId === pendingDelete?.id
                ? " The Server default will also be cleared."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProxy.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !pendingDelete || deleteProxy.isPending || config.isLoading || config.isError
              }
              onClick={(event) => {
                event.preventDefault()
                if (pendingDelete) deleteProxy.mutate(pendingDelete.id)
              }}
            >
              {deleteProxy.isPending ? "Deleting…" : "Delete proxy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function AgentNetworkProxySection({ agentId }: Readonly<{ agentId: AgentId }>) {
  const queryClient = useQueryClient()
  const proxies = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).server.networkProxies(),
    queryKey: ["server", "network-proxies"],
  })
  const config = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).server.config(),
    queryKey: ["settings", "server-config"],
  })
  const selectedId = config.data?.config.agents[agentId]?.networkProxyId ?? "__default"
  const defaultProxy = proxies.data?.proxies.find(
    (proxy) => proxy.id === proxies.data?.defaultProxyId
  )
  const selectProxy = useMutation({
    mutationFn: async (proxyId: string) =>
      (await ensureCypheriaClient()).server.patchConfig({
        agents: { [agentId]: { networkProxyId: proxyId === "__default" ? null : proxyId } },
      }),
    onSuccess: (snapshot) => queryClient.setQueryData(["settings", "server-config"], snapshot),
  })
  const error = proxies.error?.message ?? config.error?.message ?? selectProxy.error?.message

  return (
    <div className="grid gap-5">
      <header className="grid gap-1">
        <h2 className="text-lg font-semibold">Network proxy</h2>
        <p className="text-sm text-muted-foreground">
          Choose a saved Server proxy for this Agent. No override follows the Server default.
        </p>
      </header>
      <Field>
        <FieldLabel htmlFor={`agent-proxy-${agentId}`}>Proxy for this Agent</FieldLabel>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          disabled={proxies.isLoading || config.isLoading || selectProxy.isPending}
          id={`agent-proxy-${agentId}`}
          value={selectedId}
          onChange={(event) => selectProxy.mutate(event.currentTarget.value)}
        >
          <option value="__default">
            {defaultProxy
              ? `Use Server default (${defaultProxy.name})`
              : "Use Server default (system)"}
          </option>
          {(proxies.data?.proxies ?? []).map((proxy) => (
            <option key={proxy.id} value={proxy.id}>
              {proxy.name} — {modeLabel(proxy)}
            </option>
          ))}
        </select>
        <FieldDescription>
          This override is stored in the shared Server configuration for {agentId}.
        </FieldDescription>
      </Field>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
