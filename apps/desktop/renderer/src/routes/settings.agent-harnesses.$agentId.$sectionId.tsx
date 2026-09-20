import type {
  AgentId,
  AgentOperation,
  AgentView,
  HarnessAuthFlow,
  HarnessCatalogSnapshot,
  HarnessSettingSection,
  HarnessSettingValue,
} from "@cypheria/protocol"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import { Field, FieldDescription, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import { Progress, ProgressLabel, ProgressValue } from "@cypheria/ui/components/progress"
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
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ExternalLink, LogOut, RefreshCw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { waitForAgentOperation } from "../components/agent-operation"
import { HarnessIcon } from "../components/harness-icon"
import { NetworkProxyCard } from "../components/network-proxy-card"
import { SettingsFrame } from "../components/settings-frame"
import { WorkspaceTerminalSurface } from "../components/workspace-terminal"
import { ensureCypheriaClient } from "../cypheria-client.js"

export const Route = createFileRoute("/settings/agent-harnesses/$agentId/$sectionId")({
  component: AgentHarnessSettingsRoute,
})

const baseSections = [
  { id: "authentication", label: "Authentication" },
  { id: "models", label: "Models" },
]

function AgentHarnessSettingsRoute() {
  const { agentId: routeAgentId, sectionId } = Route.useParams()
  const navigate = useNavigate()
  const agentsQuery = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).agents.list(),
    queryKey: ["cypheria", "agents"],
  })
  const agent = agentsQuery.data?.agents.find((item) => item.id === routeAgentId)
  const agentId = (agent?.id ?? "codex") as AgentId
  const catalogQuery = useQuery({
    enabled: Boolean(agent?.installed) && sectionId !== "authentication",
    queryFn: async () => (await ensureCypheriaClient()).harnesses.settings.get({ agentId }),
    queryKey: ["harness", agentId, "catalog"],
  })
  const sections = useMemo(
    () => [
      ...baseSections,
      ...(catalogQuery.data?.settingSections ?? []).map(({ id, label }) => ({ id, label })),
    ],
    [catalogQuery.data?.settingSections]
  )

  useEffect(() => {
    if (!agentsQuery.data) return
    if (!agent || (!agent.native && !agent.installed)) {
      void navigate({
        params: { agentId: "codex", sectionId: "authentication" },
        replace: true,
        to: "/settings/agent-harnesses/$agentId/$sectionId",
      })
      return
    }
    if (!sections.some((item) => item.id === sectionId) && !catalogQuery.isLoading) {
      void navigate({
        params: { agentId, sectionId: sections[0]?.id ?? "authentication" },
        replace: true,
        to: "/settings/agent-harnesses/$agentId/$sectionId",
      })
    }
  }, [agent, agentId, agentsQuery.data, catalogQuery.isLoading, navigate, sectionId, sections])

  return (
    <SettingsFrame wide>
      <NetworkProxyCard />
      {agentsQuery.isLoading || !agent ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="grid gap-6">
          <header className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-card">
              <HarnessIcon
                agentId={agent.id}
                className="size-8"
                icon={agent.icon}
                name={agent.name}
              />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold">{agent.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
            </div>
            <HarnessMaintenanceActions agent={agent} />
          </header>
          <div className="grid min-h-[520px] gap-6 md:grid-cols-[190px_minmax(0,1fr)]">
            <Select
              value={sectionId}
              onValueChange={(value) =>
                void navigate({
                  params: { agentId, sectionId: String(value) },
                  to: "/settings/agent-harnesses/$agentId/$sectionId",
                })
              }
            >
              <SelectTrigger className="md:hidden">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sections.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <nav
              aria-label={`${agent.name} settings`}
              className="cypheria-scrollbar hidden max-h-[70vh] content-start gap-1 overflow-y-auto md:grid"
            >
              {sections.map((item) => (
                <button
                  className={
                    item.id === sectionId
                      ? "rounded-md bg-muted px-3 py-2 text-left text-sm font-medium"
                      : "rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }
                  key={item.id}
                  type="button"
                  onClick={() =>
                    void navigate({
                      params: { agentId, sectionId: item.id },
                      to: "/settings/agent-harnesses/$agentId/$sectionId",
                    })
                  }
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <section className="min-w-0">
              {sectionId === "authentication" ? <AuthenticationSection agent={agent} /> : null}
              {sectionId === "models" ? (
                <ModelsSection agentId={agentId} snapshot={catalogQuery.data} />
              ) : null}
              {!baseSections.some((item) => item.id === sectionId) ? (
                <SettingsSection
                  agentId={agentId}
                  section={catalogQuery.data?.settingSections.find((item) => item.id === sectionId)}
                  loading={catalogQuery.isLoading}
                />
              ) : null}
            </section>
          </div>
        </div>
      )}
    </SettingsFrame>
  )
}

function HarnessMaintenanceActions({ agent }: { agent: AgentView }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [operation, setOperation] = useState<AgentOperation>()
  const update = useMutation({
    mutationFn: async () => {
      const client = await ensureCypheriaClient()
      return waitForAgentOperation(await client.agents.update(agent.id), setOperation)
    },
    onSuccess: async () => {
      setOperation(undefined)
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
      await queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
    },
  })
  const uninstall = useMutation({
    mutationFn: async () => {
      const client = await ensureCypheriaClient()
      return waitForAgentOperation(await client.agents.uninstall(agent.id), setOperation)
    },
    onSuccess: async () => {
      setOperation(undefined)
      setUninstallOpen(false)
      queryClient.removeQueries({ queryKey: ["harness", agent.id] })
      await queryClient.invalidateQueries({ queryKey: ["cypheria", "agents"] })
      if (!agent.native) {
        await navigate({
          params: { agentId: "codex", sectionId: "authentication" },
          to: "/settings/agent-harnesses/$agentId/$sectionId",
        })
      }
    },
  })
  const setUninstallDialogOpen = (open: boolean) => {
    if (uninstall.isPending) return
    if (!open) {
      uninstall.reset()
      setOperation(undefined)
    }
    setUninstallOpen(open)
  }
  if (!agent.installed) return null
  const progress = Math.round((operation?.progress ?? 0) * 100)
  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex gap-2">
        <Button
          disabled={update.isPending || uninstall.isPending}
          variant="outline"
          onClick={() => update.mutate()}
        >
          <RefreshCw className={update.isPending ? "size-4 animate-spin" : "size-4"} />
          {update.isPending ? "Updating…" : "Update"}
        </Button>
        <Button
          disabled={update.isPending || uninstall.isPending}
          variant="destructive"
          onClick={() => setUninstallDialogOpen(true)}
        >
          <Trash2 className="size-4" />
          Uninstall
        </Button>
      </div>
      {update.isPending && operation ? (
        <span className="max-w-64 text-right text-xs text-muted-foreground">
          {operation.message ?? `Updating… ${progress}%`}
        </span>
      ) : null}
      {update.error ? (
        <span className="text-xs text-destructive">{update.error.message}</span>
      ) : null}
      <Dialog open={uninstallOpen} onOpenChange={setUninstallDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall {agent.name}?</DialogTitle>
            <DialogDescription>
              This removes the managed harness runtime. You can install it again from the Agent
              harnesses add menu.
            </DialogDescription>
          </DialogHeader>
          {uninstall.isPending && operation ? (
            <Progress value={progress}>
              <ProgressLabel>{operation.message ?? "Removing harness…"}</ProgressLabel>
              <ProgressValue />
            </Progress>
          ) : null}
          {uninstall.error ? (
            <p className="text-sm text-destructive">{uninstall.error.message}</p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={uninstall.isPending}
              variant="outline"
              onClick={() => setUninstallDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={uninstall.isPending}
              variant="destructive"
              onClick={() => uninstall.mutate()}
            >
              {uninstall.isPending ? "Uninstalling…" : "Uninstall"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AuthenticationSection({ agent }: { agent: AgentView }) {
  const queryClient = useQueryClient()
  const [flow, setFlow] = useState<HarnessAuthFlow>()
  const view = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).harnesses.get(agent.id),
    queryKey: ["harness", agent.id, "auth"],
    refetchInterval: flow?.state === "pending" && !flow.terminalId ? 1_000 : false,
  })
  const [methodId, setMethodId] = useState("")
  const [secret, setSecret] = useState("")
  const [flowResponse, setFlowResponse] = useState("")
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const terminalReplay = useRef(new Map<string, string>())
  const activeFlow = useRef<{ flowId: string; terminalId: string } | null>(null)
  const pendingFlow = useRef<string | null>(null)
  const auth = useMutation({
    mutationFn: async () =>
      (await ensureCypheriaClient()).harnesses.auth.start({
        agentId: agent.id,
        methodId: methodId || view.data?.authMethods[0]?.id || "",
        ...(secret ? { secret } : {}),
      }),
    onSuccess: async (flow) => {
      setFlow(flow)
      setTerminalError(null)
      if (flow.state === "pending" && flow.externalUrl)
        await window.cypheria?.app.openExternal(flow.externalUrl)
      if (flow.state === "completed") {
        setSecret("")
        await queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
      }
    },
  })
  const logout = useMutation({
    mutationFn: async () => (await ensureCypheriaClient()).harnesses.auth.logout(agent.id),
    onSuccess: async () => {
      setFlow(undefined)
      await queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
    },
  })
  const cancel = useMutation({
    mutationFn: async () => {
      if (flow?.state !== "pending" || !flow.flowId) return
      await (await ensureCypheriaClient()).harnesses.auth.cancel({
        agentId: agent.id,
        flowId: flow.flowId,
      })
    },
    onSuccess: () => {
      activeFlow.current = null
      pendingFlow.current = null
      setFlow(undefined)
    },
  })
  const respond = useMutation({
    mutationFn: async () => {
      if (flow?.state !== "pending" || !flow.flowId) {
        throw new Error("No authentication flow is waiting for a response")
      }
      return (await ensureCypheriaClient()).harnesses.auth.respond({
        agentId: agent.id,
        flowId: flow.flowId,
        response: flowResponse,
      })
    },
    onSuccess: async (nextFlow) => {
      setFlow(nextFlow)
      setFlowResponse("")
      await queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
    },
  })
  const selected =
    view.data?.authMethods.find((item) => item.id === methodId) ?? view.data?.authMethods[0]
  useEffect(() => {
    if (flow?.state === "pending" && flow.flowId) {
      pendingFlow.current = flow.flowId
      if (flow.terminalId) {
        activeFlow.current = { flowId: flow.flowId, terminalId: flow.terminalId }
      }
    } else {
      pendingFlow.current = null
    }
  }, [flow])
  useEffect(() => {
    if (view.data?.connected && flow?.state === "pending" && !flow.terminalId) {
      setFlow(undefined)
    }
  }, [flow, view.data?.connected])
  const getTerminalReplay = useCallback(
    (terminalId: string) => terminalReplay.current.get(terminalId) ?? "",
    []
  )
  useEffect(() => {
    let disposed = false
    let unsubscribeOutput: () => void = () => undefined
    let unsubscribeExited: () => void = () => undefined
    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      unsubscribeOutput = client.on("terminal.output.notification", (message) => {
        const current = terminalReplay.current.get(message.payload.terminalId) ?? ""
        terminalReplay.current.set(message.payload.terminalId, `${current}${message.payload.data}`)
      })
      unsubscribeExited = client.on("terminal.exited.notification", (message) => {
        if (message.payload.terminalId !== activeFlow.current?.terminalId) return
        activeFlow.current = null
        pendingFlow.current = null
        setFlow(undefined)
        setTerminalError(
          message.payload.exitCode === 0
            ? null
            : `Authentication process exited with code ${message.payload.exitCode}.`
        )
        void queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
      })
    })
    return () => {
      disposed = true
      unsubscribeOutput()
      unsubscribeExited()
      const flowId = pendingFlow.current
      activeFlow.current = null
      pendingFlow.current = null
      if (flowId) {
        void ensureCypheriaClient().then((client) =>
          client.harnesses.auth.cancel({ agentId: agent.id, flowId })
        )
      }
    }
  }, [agent.id, queryClient])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentication</CardTitle>
        <CardDescription>
          Credentials stay in the harness credential store and are never written to Cypheria
          settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {view.isLoading ? <Skeleton className="h-40" /> : null}
        {view.data?.connected ? (
          <Alert>
            <AlertTitle>Connected</AlertTitle>
            <AlertDescription>
              {view.data.detail ?? "This harness is authenticated."}
            </AlertDescription>
          </Alert>
        ) : null}
        <RadioGroup
          value={selected?.id ?? ""}
          onValueChange={(value) => setMethodId(String(value))}
        >
          {view.data?.authMethods.map((method) => (
            <Field className="rounded-md border p-3" key={method.id} orientation="horizontal">
              <RadioGroupItem id={`auth-${method.id}`} value={method.id} />
              <FieldLabel htmlFor={`auth-${method.id}`}>
                <span>{method.label}</span>
                {method.description ? (
                  <FieldDescription>{method.description}</FieldDescription>
                ) : null}
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
        {selected?.input === "secret" ? (
          <Field>
            <FieldLabel htmlFor="harness-secret">Secret</FieldLabel>
            <Input
              autoComplete="off"
              id="harness-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.currentTarget.value)}
            />
          </Field>
        ) : null}
        {flow?.state === "pending" ? (
          <Alert>
            <AlertTitle>Complete sign in</AlertTitle>
            <AlertDescription>{flow.message}</AlertDescription>
          </Alert>
        ) : null}
        {flow?.state === "pending" && flow.terminalId ? (
          <div className="h-72 overflow-hidden rounded-md border bg-black">
            <WorkspaceTerminalSurface
              active
              getReplay={getTerminalReplay}
              session={{
                cwd: "Authentication",
                terminalId: flow.terminalId,
                title: `${agent.name} authentication`,
              }}
            />
          </div>
        ) : null}
        {flow?.state === "pending" && flow.flowId && flow.input !== "none" ? (
          <Field>
            <FieldLabel htmlFor="harness-flow-response">Authentication response</FieldLabel>
            <Input
              id="harness-flow-response"
              type={flow.input === "secret" ? "password" : "text"}
              value={flowResponse}
              onChange={(event) => setFlowResponse(event.currentTarget.value)}
            />
            <Button
              className="mt-2 justify-self-start"
              disabled={!flowResponse || respond.isPending}
              onClick={() => respond.mutate()}
            >
              Submit code
            </Button>
          </Field>
        ) : null}
        <div className="flex gap-2">
          <Button
            disabled={!selected || auth.isPending || (selected.input === "secret" && !secret)}
            onClick={() => auth.mutate()}
          >
            {auth.isPending ? "Connecting…" : "Connect"}
          </Button>
          {flow?.state === "pending" && flow.flowId ? (
            <Button disabled={cancel.isPending} variant="outline" onClick={() => cancel.mutate()}>
              Cancel
            </Button>
          ) : null}
          {view.data?.logoutSupported && view.data.connected ? (
            <Button disabled={logout.isPending} variant="outline" onClick={() => logout.mutate()}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          ) : null}
        </div>
        {auth.error ||
        cancel.error ||
        logout.error ||
        respond.error ||
        view.error ||
        terminalError ? (
          <p className="text-sm text-destructive">
            {auth.error?.message ??
              logout.error?.message ??
              cancel.error?.message ??
              respond.error?.message ??
              view.error?.message ??
              terminalError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ModelsSection({
  agentId,
  snapshot,
}: {
  agentId: AgentId
  snapshot?: HarnessCatalogSnapshot
}) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState("all")
  const scrollRef = useRef<HTMLDivElement>(null)
  const refresh = useMutation({
    mutationFn: async () =>
      (await ensureCypheriaClient()).harnesses.models.list({ agentId, refresh: true }),
    onSuccess: (value) => queryClient.setQueryData(["harness", agentId, "catalog"], value),
  })
  const providers = useMemo(
    () => [
      ...new Map(
        (snapshot?.models ?? [])
          .filter((model) => model.providerId)
          .map((model) => [
            model.providerId as string,
            model.providerLabel ?? (model.providerId as string),
          ])
      ).entries(),
    ],
    [snapshot?.models]
  )
  const models = useMemo(
    () =>
      (snapshot?.models ?? []).filter(
        (model) => provider === "all" || model.providerId === provider
      ),
    [provider, snapshot?.models]
  )
  const virtualizer = useVirtualizer({
    count: models.length,
    estimateSize: () => 78,
    getItemKey: (index) => models[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  })
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Models</CardTitle>
            <CardDescription>Read-only model catalog reported by the harness.</CardDescription>
          </div>
          <Button
            disabled={refresh.isPending}
            size="sm"
            variant="outline"
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className={refresh.isPending ? "size-4 animate-spin" : "size-4"} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {providers.length > 1 ? (
          <Select value={provider} onValueChange={(value) => setProvider(String(value))}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {snapshot?.stale ? (
          <Alert variant="destructive">
            <AlertTitle>Showing saved catalog</AlertTitle>
            <AlertDescription>{snapshot.error}</AlertDescription>
          </Alert>
        ) : null}
        <div
          className="cypheria-scrollbar h-[480px] overflow-y-auto rounded-md border"
          ref={scrollRef}
        >
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((row) => {
              const model = models[row.index]
              if (!model) return null
              return (
                <div
                  className="absolute left-0 top-0 w-full px-4 py-3"
                  key={model.id}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <div className="flex items-start justify-between gap-3 border-b pb-3">
                    <div>
                      <div className="font-medium">{model.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {model.providerLabel ?? model.providerId ?? "Provider default"} · {model.id}
                      </div>
                      {model.description ? (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {model.description}
                        </p>
                      ) : null}
                    </div>
                    {model.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {!models.length ? (
          <p className="text-sm text-muted-foreground">
            No models reported. Authenticate this harness, then refresh.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SettingsSection({
  agentId,
  loading,
  section,
}: {
  agentId: AgentId
  loading: boolean
  section?: HarnessSettingSection
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, HarnessSettingValue>>({})
  useEffect(() => {
    if (section) setDraft(Object.fromEntries(section.settings.map((item) => [item.id, item.value])))
  }, [section])
  const save = useMutation({
    mutationFn: async () =>
      (await ensureCypheriaClient()).harnesses.settings.update({ agentId, values: draft }),
    onSuccess: (value) => queryClient.setQueryData(["harness", agentId, "catalog"], value),
  })
  if (loading || !section) return <Skeleton className="h-72" />
  if (section.id === "advanced")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
          <CardDescription>
            Open the server configuration file for advanced Codex settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void window.cypheria?.app.openConfig()}>
            <ExternalLink className="size-4" />
            Open config.json
          </Button>
        </CardContent>
      </Card>
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.label}</CardTitle>
        {section.description ? <CardDescription>{section.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-6">
        {section.settings.map((setting) => (
          <Field key={setting.id}>
            <FieldLabel htmlFor={`setting-${setting.id}`}>{setting.label}</FieldLabel>
            {setting.type === "boolean" ? (
              <Switch
                checked={Boolean(draft[setting.id])}
                id={`setting-${setting.id}`}
                onCheckedChange={(value) =>
                  setDraft((current) => ({ ...current, [setting.id]: value }))
                }
              />
            ) : setting.type === "number" ? (
              <Input
                id={`setting-${setting.id}`}
                max={setting.max ?? undefined}
                min={setting.min ?? undefined}
                step={setting.step ?? undefined}
                type="number"
                value={String(draft[setting.id] ?? "")}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [setting.id]: event.currentTarget.value
                      ? Number(event.currentTarget.value)
                      : null,
                  }))
                }
              />
            ) : (
              <Select
                value={String(draft[setting.id] ?? "")}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, [setting.id]: String(value) }))
                }
              >
                <SelectTrigger id={`setting-${setting.id}`}>
                  <SelectValue placeholder="Harness default" />
                </SelectTrigger>
                <SelectContent>
                  {setting.options.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {setting.description ? (
              <FieldDescription>{setting.description}</FieldDescription>
            ) : null}
            {setting.type === "select" &&
            draft[setting.id] &&
            setting.options.length > 0 &&
            !setting.options.some((item) => item.value === draft[setting.id]) ? (
              <FieldDescription className="text-destructive">
                The saved value is no longer available and will not be applied.
              </FieldDescription>
            ) : null}
          </Field>
        ))}
        {section.settings.length ? (
          <div className="flex justify-end">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This harness does not expose configurable defaults in this category.
          </p>
        )}
        {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
      </CardContent>
    </Card>
  )
}
