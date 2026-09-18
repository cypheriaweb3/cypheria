import type { CodexAccountView, CodexLoginInput, CodexLoginResult } from "@cypheria/protocol"
import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cypheria/ui/components/collapsible"
import { Field, FieldDescription, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import { RadioGroup, RadioGroupItem } from "@cypheria/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { Switch } from "@cypheria/ui/components/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  LogOut,
  Network,
} from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { z } from "zod"
import type {
  ConnectionProxyProtocol,
  ConnectionProxySettings,
  ConnectionProxyTestResult,
} from "../../../ipc/src/index.js"
import codexOnDarkLogo from "../assets/harnesses/codex-on-dark.svg"
import codexOnLightLogo from "../assets/harnesses/codex-on-light.svg"
import { SettingsFrame } from "../components/settings-frame"
import { ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsSettingsRoute,
  validateSearch: z.object({ focus: z.literal("codex").optional().catch(undefined) }),
})

type ThemeLogoSources = {
  darkTheme: string
  lightTheme: string
}

const codexLogoSources: ThemeLogoSources = {
  darkTheme: codexOnDarkLogo,
  lightTheme: codexOnLightLogo,
}

function ThemeLogo({
  className,
  sources,
}: Readonly<{ className: string; sources: ThemeLogoSources }>) {
  return (
    <>
      <img alt="" className={`${className} dark:hidden`} src={sources.lightTheme} />
      <img alt="" className={`${className} hidden dark:block`} src={sources.darkTheme} />
    </>
  )
}

type CodexAuthenticationMethod = "apiKey" | "chatgpt"
type ProxyDraft = {
  bypass: string
  host: string
  mode: ConnectionProxySettings["mode"]
  password: string
  port: string
  protocol: ConnectionProxyProtocol
  username: string
}

const defaultProxyDraft: ProxyDraft = {
  bypass: "localhost, 127.0.0.1, ::1",
  host: "127.0.0.1",
  mode: "system",
  password: "",
  port: "7890",
  protocol: "http",
  username: "",
}

const settingsToProxyDraft = (settings: ConnectionProxySettings): ProxyDraft =>
  settings.mode === "manual"
    ? { ...settings, port: String(settings.port) }
    : { ...defaultProxyDraft, mode: settings.mode }

const proxyDraftToSettings = (draft: ProxyDraft): ConnectionProxySettings => {
  if (draft.mode !== "manual") return { mode: draft.mode }
  return {
    bypass: draft.bypass.trim(),
    host: draft.host.trim(),
    mode: "manual",
    password: draft.password,
    port: Number(draft.port),
    protocol: draft.protocol,
    username: draft.username,
  }
}

const waitForAgentOperation = async (operation: AgentOperation): Promise<AgentOperation> => {
  if (operation.status === "succeeded") return operation
  if (operation.status === "failed") throw new Error(operation.error ?? "Agent operation failed")
  const client = await ensureCypheriaClient()
  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    const current = await client.agents.getOperation(operation.id)
    if (current.status === "succeeded") return current
    if (current.status === "failed") throw new Error(current.error ?? "Agent operation failed")
  }
}

function AgentIcon({ agent, large = false }: Readonly<{ agent: AgentView; large?: boolean }>) {
  if (agent.id === "codex") {
    return <ThemeLogo className={large ? "size-10" : "size-8"} sources={codexLogoSources} />
  }
  return (
    <span
      aria-hidden="true"
      className={large ? "text-base font-semibold uppercase" : "text-sm font-semibold uppercase"}
    >
      {agent.name.slice(0, 2)}
    </span>
  )
}

function ConnectionsSettingsRoute() {
  const search = Route.useSearch()
  const queryClient = useQueryClient()
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>("codex")
  const [flow, setFlow] = useState<CodexLoginResult | null>(null)
  const agents = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).agents.list(),
    queryKey: ["cypheria", "agents"],
  })
  const account = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).providers.codex.account.get(),
    queryKey: ["codex", "account"],
    refetchInterval: flow ? 2_000 : false,
  })
  const [apiKey, setApiKey] = useState("")
  const [authenticationMethod, setAuthenticationMethod] =
    useState<CodexAuthenticationMethod>("chatgpt")
  const [notificationError, setNotificationError] = useState<string | null>(null)

  const login = useMutation({
    mutationFn: async (request: CodexLoginInput) => {
      const result = await (await ensureCypheriaClient()).providers.codex.account.login(request)
      if (result.authUrl && window.cypheria) await window.cypheria.app.openExternal(result.authUrl)
      return result
    },
    onMutate: () => setNotificationError(null),
    onSuccess: (result) => {
      setFlow(result)
      if (result.type === "apiKey") {
        setApiKey("")
        void queryClient.invalidateQueries({ queryKey: ["codex", "account"] })
      }
    },
  })

  const logout = useMutation({
    mutationFn: async () => {
      return (await ensureCypheriaClient()).providers.codex.account.logout()
    },
    onSuccess: async () => {
      setFlow(null)
      await queryClient.invalidateQueries({ queryKey: ["codex"] })
    },
  })

  const cancelLogin = useMutation({
    mutationFn: async (loginId: string) => {
      return (await ensureCypheriaClient()).providers.codex.account.cancelLogin(loginId)
    },
    onSuccess: () => setFlow(null),
  })

  useEffect(() => {
    if (!flow || !account.data?.type) return
    setFlow(null)
  }, [account.data?.type, flow])

  useEffect(() => {
    if (search.focus === "codex") {
      document.getElementById("codex-connection")?.scrollIntoView({ block: "start" })
    }
  }, [search.focus])

  useEffect(() => {
    let unsubscribeUpdated: () => void = () => undefined
    let unsubscribeCompleted: () => void = () => undefined
    void ensureCypheriaClient().then((client) => {
      const refresh = () => void queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
      unsubscribeUpdated = client.on("agent.updated.notification", refresh)
      unsubscribeCompleted = client.on("agent.operation.completed.notification", refresh)
    })
    return () => {
      unsubscribeUpdated()
      unsubscribeCompleted()
    }
  }, [queryClient])

  const connected = Boolean(account.data?.type)
  const error = login.error?.message ?? logout.error?.message ?? notificationError
  const selectedAgent = agents.data?.agents.find((agent) => agent.id === selectedAgentId)

  return (
    <SettingsFrame wide>
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Install, enable, and connect server-managed agents in Cypheria.
        </p>
      </div>

      <ProxySettingsCard />

      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Agents</CardTitle>
          </CardHeader>
          <CardContent className="cypheria-scrollbar grid max-h-[70vh] gap-1 overflow-y-auto px-2 pb-2">
            {agents.data?.agents.map((agent) => (
              <button
                className={
                  selectedAgentId === agent.id
                    ? "flex items-center gap-3 rounded-md bg-muted px-3 py-2.5 text-left"
                    : "flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-muted-foreground hover:bg-muted/50"
                }
                key={agent.id}
                type="button"
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                  <AgentIcon agent={agent} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {agent.name}
                  </span>
                  <span className="block truncate text-xs">
                    {agent.native ? "First-party" : "ACP"} · {agent.version}
                  </span>
                </span>
              </button>
            ))}
            {agents.isLoading ? <Skeleton className="h-48 w-full" /> : null}
          </CardContent>
        </Card>

        {selectedAgentId === "codex" ? (
          <Card className="scroll-mt-6" id="codex-connection">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="grid gap-1.5">
                  <CardTitle className="flex items-center gap-2">
                    Codex
                    <Badge variant={connected ? "secondary" : "outline"}>
                      {connected ? "Connected" : "Not connected"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>Connect Codex to use OpenAI models in Cypheria.</CardDescription>
                </div>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
                  <ThemeLogo className="size-10" sources={codexLogoSources} />
                </span>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              {selectedAgent ? <AgentLifecycleControls agent={selectedAgent} /> : null}
              {account.isLoading ? <Skeleton className="h-24 w-full" /> : null}

              {account.isError ? (
                <Alert variant="destructive">
                  <CircleAlert className="size-4" />
                  <AlertTitle>Could not read the Codex connection</AlertTitle>
                  <AlertDescription>{account.error.message}</AlertDescription>
                </Alert>
              ) : null}

              {connected ? (
                <ConnectedAccount
                  account={account.data as CodexAccountView}
                  pending={logout.isPending}
                  onLogout={() => logout.mutate()}
                />
              ) : account.isLoading || account.isError ? null : (
                <>
                  <RadioGroup
                    value={authenticationMethod}
                    onValueChange={(value) =>
                      setAuthenticationMethod(value as CodexAuthenticationMethod)
                    }
                  >
                    <Field
                      className="rounded-md border p-3 has-data-checked:border-primary/30 has-data-checked:bg-primary/5"
                      orientation="horizontal"
                    >
                      <RadioGroupItem
                        disabled={flow?.type === "chatgpt"}
                        id="codex-auth-chatgpt"
                        value="chatgpt"
                      />
                      <FieldLabel
                        className="cursor-pointer flex-col items-start gap-1 text-left"
                        htmlFor="codex-auth-chatgpt"
                      >
                        <span>Sign in with ChatGPT</span>
                        <span className="text-sm font-normal text-muted-foreground">
                          Use your ChatGPT subscription. Codex stores and refreshes the sign-in.
                        </span>
                      </FieldLabel>
                    </Field>
                    <Field
                      className="rounded-md border p-3 has-data-checked:border-primary/30 has-data-checked:bg-primary/5"
                      orientation="horizontal"
                    >
                      <RadioGroupItem
                        disabled={flow?.type === "chatgpt"}
                        id="codex-auth-api-key"
                        value="apiKey"
                      />
                      <FieldLabel
                        className="cursor-pointer flex-col items-start gap-1 text-left"
                        htmlFor="codex-auth-api-key"
                      >
                        <span>Sign in with OpenAI API key</span>
                        <span className="text-sm font-normal text-muted-foreground">
                          Use API billing from the OpenAI account associated with the key.
                        </span>
                      </FieldLabel>
                    </Field>
                  </RadioGroup>

                  {authenticationMethod === "chatgpt" ? (
                    flow?.type === "chatgpt" ? (
                      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
                        <span className="flex items-center gap-2 text-sm">
                          <LoaderCircle className="size-4 animate-spin" />
                          Waiting for browser sign-in…
                        </span>
                        <Button
                          disabled={cancelLogin.isPending || !flow.loginId}
                          size="sm"
                          variant="ghost"
                          onClick={() => flow.loginId && cancelLogin.mutate(flow.loginId)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="justify-self-start"
                        disabled={login.isPending}
                        onClick={() => login.mutate({ type: "chatgpt" })}
                      >
                        <ExternalLink className="size-4" />
                        Continue in browser
                      </Button>
                    )
                  ) : (
                    <ApiKeyForm
                      apiKey={apiKey}
                      pending={login.isPending}
                      onApiKeyChange={setApiKey}
                      onSubmit={() => login.mutate({ apiKey: apiKey.trim(), type: "apiKey" })}
                    />
                  )}
                </>
              )}

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </CardContent>
          </Card>
        ) : (
          <AgentConnectionCard agent={selectedAgent} loading={agents.isLoading} />
        )}
      </div>
    </SettingsFrame>
  )
}

function AgentConnectionCard({
  agent,
  loading,
}: Readonly<{ agent?: AgentView; loading: boolean }>) {
  if (loading || !agent) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-56 w-full" />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {agent.name}
              <Badge variant={agent.native ? "secondary" : "outline"}>
                {agent.native ? "First-party" : "ACP"}
              </Badge>
            </CardTitle>
            <CardDescription>{agent.description}</CardDescription>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <AgentIcon agent={agent} large />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <AgentLifecycleControls agent={agent} />
      </CardContent>
    </Card>
  )
}

function AgentLifecycleControls({ agent }: Readonly<{ agent: AgentView }>) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
  const install = useMutation({
    mutationFn: async () => {
      const client = await ensureCypheriaClient()
      const operation = isAgentUpdateAvailable(agent)
        ? await client.agents.update(agent.id)
        : await client.agents.install(agent.id)
      return waitForAgentOperation(operation)
    },
    onSuccess: refresh,
  })
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const client = await ensureCypheriaClient()
      return enabled ? client.agents.enable(agent.id) : client.agents.disable(agent.id)
    },
    onSuccess: refresh,
  })
  const runtime = useMutation({
    mutationFn: async (running: boolean) => {
      const client = await ensureCypheriaClient()
      return running ? client.agents.start(agent.id) : client.agents.stop(agent.id)
    },
    onSuccess: refresh,
  })
  const error = install.error?.message ?? toggle.error?.message ?? runtime.error?.message
  const updateAvailable = isAgentUpdateAvailable(agent)

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={agent.installed ? "secondary" : "outline"}>
          {agent.installed ? `Installed ${agent.version}` : "Not installed"}
        </Badge>
        <Badge variant="outline">{agent.runtimeState}</Badge>
        {updateAvailable ? <Badge>Update {agent.availableVersion}</Badge> : null}
        <Badge variant="outline">{agent.integrity}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={install.isPending || !agent.available} onClick={() => install.mutate()}>
          {install.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {updateAvailable ? "Update" : agent.installed ? "Reinstall" : "Install"}
        </Button>
        <Button
          disabled={!agent.installed || !agent.enabled || runtime.isPending}
          variant="outline"
          onClick={() => runtime.mutate(agent.runtimeState !== "running")}
        >
          {runtime.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {agent.runtimeState === "running" ? "Stop" : "Start"}
        </Button>
      </div>

      <div className="flex items-center justify-between rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">Enable in Cypheria</p>
          <p className="text-xs text-muted-foreground">
            Enabled agents can create Threads and are started by the Server when needed.
          </p>
        </div>
        <Switch
          checked={agent.enabled}
          disabled={!agent.installed || toggle.isPending}
          onCheckedChange={(checked) => toggle.mutate(checked)}
        />
      </div>

      <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs">
        <div>
          <span className="text-muted-foreground">Runtime scope: </span>
          <span>{agent.runtimeScope}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Source: </span>
          <span>{agent.native ? "Cypheria first-party adapter" : "ACP Registry"}</span>
        </div>
        {agent.repository ? (
          <div>
            <span className="text-muted-foreground">Repository: </span>
            <span className="break-all">{agent.repository}</span>
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>Agent operation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function ProxySettingsCard() {
  const queryClient = useQueryClient()
  const proxy = useQuery({
    queryFn: () => {
      if (!window.cypheria) throw new Error("Proxy settings are only available in the desktop app.")
      return window.cypheria.settings.getConnectionProxy()
    },
    queryKey: ["settings", "connectionProxy"],
  })
  const [draft, setDraft] = useState<ProxyDraft>(defaultProxyDraft)
  const [savedSettings, setSavedSettings] = useState<ConnectionProxySettings | null>(null)
  const [testResult, setTestResult] = useState<ConnectionProxyTestResult | null>(null)

  useEffect(() => {
    if (proxy.data) {
      setDraft(settingsToProxyDraft(proxy.data))
      setSavedSettings(proxy.data)
    }
  }, [proxy.data])

  const save = useMutation({
    mutationFn: (settings: ConnectionProxySettings) => {
      if (!window.cypheria) throw new Error("Proxy settings are only available in the desktop app.")
      return window.cypheria.settings.setConnectionProxy(settings)
    },
    onSuccess: async (settings) => {
      setDraft(settingsToProxyDraft(settings))
      setSavedSettings(settings)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings", "connectionProxy"] }),
        queryClient.invalidateQueries({ queryKey: ["codex"] }),
      ])
    },
  })
  const test = useMutation({
    mutationFn: (settings: ConnectionProxySettings) => {
      if (!window.cypheria) throw new Error("Proxy settings are only available in the desktop app.")
      return window.cypheria.settings.testConnectionProxy(settings)
    },
    onMutate: () => setTestResult(null),
    onSuccess: setTestResult,
  })

  const updateDraft = <K extends keyof ProxyDraft>(key: K, value: ProxyDraft[K]) => {
    setTestResult(null)
    save.reset()
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const selectMode = (mode: ProxyDraft["mode"]) => {
    if (mode === draft.mode) return
    setTestResult(null)
    save.reset()
    const nextDraft = { ...draft, mode }
    setDraft(nextDraft)
    save.mutate(proxyDraftToSettings(nextDraft))
  }
  const settings = proxyDraftToSettings(draft)
  const manualInvalid =
    draft.mode === "manual" &&
    (!draft.host.trim() || !/^\d+$/u.test(draft.port) || Number(draft.port) > 65_535)
  const error = proxy.error?.message ?? save.error?.message ?? test.error?.message
  const manualChanged =
    draft.mode === "manual" && JSON.stringify(settings) !== JSON.stringify(savedSettings)
  const modeLabel =
    draft.mode === "system"
      ? "System proxy"
      : draft.mode === "direct"
        ? "Direct"
        : `${draft.protocol.toUpperCase()} ${draft.host}:${draft.port}`

  return (
    <Card className="py-0">
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="group flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/30">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <Network className="size-5" />
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="font-semibold leading-none">Network proxy</span>
            <span className="text-sm text-muted-foreground">
              Configure the proxy used by Codex and every agent harness connection.
            </span>
          </div>
          <Badge className="shrink-0" variant="outline">
            {proxy.isLoading ? "Loading…" : save.isPending ? "Reconnecting…" : modeLabel}
          </Badge>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="grid gap-5 px-4 pb-4">
            {proxy.isLoading ? <Skeleton className="h-32 w-full" /> : null}
            {proxy.isLoading ? null : (
              <>
                <RadioGroup
                  className="grid gap-2 md:grid-cols-3"
                  disabled={save.isPending}
                  value={draft.mode}
                  onValueChange={(value) => selectMode(value as ProxyDraft["mode"])}
                >
                  {[
                    ["system", "Use system proxy", "Follow this computer's proxy settings."],
                    ["direct", "Connect directly", "Do not use a proxy for connections."],
                    ["manual", "Manual proxy", "Use the proxy configured below."],
                  ].map(([value, title, description]) => (
                    <Field
                      className="rounded-md border p-3 has-data-checked:border-primary/30 has-data-checked:bg-primary/5"
                      key={value}
                      orientation="horizontal"
                    >
                      <RadioGroupItem id={`proxy-${value}`} value={value} />
                      <FieldLabel
                        className="cursor-pointer flex-col items-start gap-1 text-left"
                        htmlFor={`proxy-${value}`}
                      >
                        <span>{title}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {description}
                        </span>
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>

                {draft.mode === "manual" ? (
                  <div className="grid gap-4 rounded-md border bg-muted/20 p-4">
                    <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)_140px]">
                      <Field>
                        <FieldLabel htmlFor="proxy-protocol">Protocol</FieldLabel>
                        <Select
                          value={draft.protocol}
                          onValueChange={(value) =>
                            updateDraft("protocol", value as ConnectionProxyProtocol)
                          }
                        >
                          <SelectTrigger id="proxy-protocol">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="http">HTTP</SelectItem>
                            <SelectItem value="https">HTTPS</SelectItem>
                            <SelectItem value="socks5">SOCKS5</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="proxy-host">Host</FieldLabel>
                        <Input
                          id="proxy-host"
                          placeholder="127.0.0.1"
                          required
                          value={draft.host}
                          onChange={(event) => updateDraft("host", event.currentTarget.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="proxy-port">Port</FieldLabel>
                        <Input
                          id="proxy-port"
                          inputMode="numeric"
                          max={65_535}
                          min={1}
                          required
                          type="number"
                          value={draft.port}
                          onChange={(event) => updateDraft("port", event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="proxy-username">Username</FieldLabel>
                        <Input
                          autoComplete="off"
                          id="proxy-username"
                          placeholder="Optional"
                          value={draft.username}
                          onChange={(event) => updateDraft("username", event.currentTarget.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="proxy-password">Password</FieldLabel>
                        <Input
                          autoComplete="new-password"
                          id="proxy-password"
                          placeholder="Optional"
                          type="password"
                          value={draft.password}
                          onChange={(event) => updateDraft("password", event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="proxy-bypass">Bypass proxy for</FieldLabel>
                      <Input
                        id="proxy-bypass"
                        placeholder="localhost, 127.0.0.1, ::1"
                        value={draft.bypass}
                        onChange={(event) => updateDraft("bypass", event.currentTarget.value)}
                      />
                      <FieldDescription>Separate hosts with commas or spaces.</FieldDescription>
                    </Field>
                  </div>
                ) : null}

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
                {save.isSuccess && !manualChanged ? (
                  <p className="text-sm text-muted-foreground">Saved. Codex reconnected.</p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={manualInvalid || test.isPending || save.isPending}
                    type="button"
                    variant="outline"
                    onClick={() => test.mutate(settings)}
                  >
                    {test.isPending ? "Testing…" : "Test connection"}
                  </Button>
                  {manualChanged && !save.isPending ? (
                    <Button
                      disabled={manualInvalid || test.isPending}
                      type="button"
                      onClick={() => save.mutate(settings)}
                    >
                      Save proxy
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function ConnectedAccount({
  account,
  onLogout,
  pending,
}: Readonly<{
  account: CodexAccountView
  onLogout: () => void
  pending: boolean
}>) {
  const method =
    account.type === "chatgpt"
      ? "Sign in with ChatGPT"
      : account.type === "apiKey"
        ? "Sign in with OpenAI API key"
        : "Existing provider credentials"
  return (
    <div className="grid gap-4 rounded-md border bg-muted/30 p-4">
      <div className="grid gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Authentication method
        </span>
        <span className="text-sm font-medium">{method}</span>
        {account.email ? (
          <span className="text-sm text-muted-foreground">{account.email}</span>
        ) : null}
        {account.planType ? (
          <span className="text-sm text-muted-foreground">ChatGPT {account.planType}</span>
        ) : null}
      </div>
      {account.type === "apiKey" ? (
        <Alert>
          <CircleAlert className="size-4" />
          <AlertTitle>Some Codex features require ChatGPT</AlertTitle>
          <AlertDescription>
            The remote plugin catalog may not be available with an API key. Sign out below, then
            choose Sign in with ChatGPT.
          </AlertDescription>
        </Alert>
      ) : null}
      <Button
        className="justify-self-start"
        disabled={pending}
        variant="outline"
        onClick={onLogout}
      >
        <LogOut className="size-4" />
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  )
}

function ApiKeyForm({
  apiKey,
  onApiKeyChange,
  onSubmit,
  pending,
}: Readonly<{
  apiKey: string
  onApiKeyChange: (value: string) => void
  onSubmit: () => void
  pending: boolean
}>) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (apiKey.trim()) onSubmit()
  }
  return (
    <form className="grid gap-3" onSubmit={submit}>
      <Field>
        <FieldLabel htmlFor="codex-api-key">API key</FieldLabel>
        <Input
          autoComplete="off"
          id="codex-api-key"
          placeholder="sk-…"
          required
          type="password"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.currentTarget.value)}
        />
        <FieldDescription>
          API usage is billed through the associated OpenAI account.
        </FieldDescription>
      </Field>
      <Button
        className="justify-self-start"
        disabled={pending || !apiKey.trim()}
        type="submit"
        variant="outline"
      >
        {pending ? "Connecting…" : "Connect"}
      </Button>
    </form>
  )
}

import { isAgentUpdateAvailable } from "@cypheria/client"
import type { AgentId, AgentOperation, AgentView } from "@cypheria/protocol"
