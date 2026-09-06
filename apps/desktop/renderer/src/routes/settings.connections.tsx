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
import { Tabs, TabsList, TabsTrigger } from "@cypheria/ui/components/tabs"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  LogOut,
  Network,
  RefreshCw,
  SquareTerminal,
  X,
} from "lucide-react"
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react"
import type {
  CodexAccountView,
  CodexLoginRequest,
  CodexLoginResult,
  ConnectionProxyProtocol,
  ConnectionProxySettings,
  ConnectionProxyTestResult,
  HarnessEvent,
  HarnessId,
  HarnessTerminalSession,
  HarnessView,
} from "../../../ipc/src/index.js"
import codexOnDarkLogo from "../assets/harnesses/codex-on-dark.svg"
import codexOnLightLogo from "../assets/harnesses/codex-on-light.svg"
import cursorLogo from "../assets/harnesses/cursor.svg"
import geminiCliLogo from "../assets/harnesses/gemini-cli.svg"
import grokOnDarkLogo from "../assets/harnesses/grok-on-dark.svg"
import grokOnLightLogo from "../assets/harnesses/grok-on-light.svg"
import hermesLogo from "../assets/harnesses/hermes.svg"
import openCodeOnDarkLogo from "../assets/harnesses/opencode-on-dark.svg"
import openCodeOnLightLogo from "../assets/harnesses/opencode-on-light.svg"
import { SettingsFrame } from "../components/settings-frame"

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsSettingsRoute,
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

const harnesses: ReadonlyArray<{
  description: string
  id: "codex" | HarnessId
  icon: ReactNode
  name: string
}> = [
  {
    description: "OpenAI coding agent",
    id: "codex",
    icon: <ThemeLogo className="size-8" sources={codexLogoSources} />,
    name: "Codex",
  },
  {
    description: "xAI coding agent",
    id: "grok-build",
    icon: (
      <ThemeLogo
        className="size-5 rounded-sm"
        sources={{ darkTheme: grokOnDarkLogo, lightTheme: grokOnLightLogo }}
      />
    ),
    name: "Grok Build",
  },
  {
    description: "Cursor coding agent",
    id: "cursor",
    icon: <img alt="" className="size-5 rounded-sm" src={cursorLogo} />,
    name: "Cursor",
  },
  {
    description: "Google Gemini CLI",
    id: "gemini",
    icon: <img alt="" className="size-5 rounded-sm" src={geminiCliLogo} />,
    name: "Gemini CLI",
  },
  {
    description: "Nous Research agent",
    id: "hermes",
    icon: <img alt="" className="size-5" src={hermesLogo} />,
    name: "Hermes",
  },
  {
    description: "Open source coding agent",
    id: "opencode",
    icon: (
      <ThemeLogo
        className="size-5 rounded-sm"
        sources={{ darkTheme: openCodeOnDarkLogo, lightTheme: openCodeOnLightLogo }}
      />
    ),
    name: "OpenCode",
  },
]

const harnessLogos: Record<HarnessId, ThemeLogoSources> = {
  "grok-build": { darkTheme: grokOnDarkLogo, lightTheme: grokOnLightLogo },
  cursor: { darkTheme: cursorLogo, lightTheme: cursorLogo },
  gemini: { darkTheme: geminiCliLogo, lightTheme: geminiCliLogo },
  hermes: { darkTheme: hermesLogo, lightTheme: hermesLogo },
  opencode: { darkTheme: openCodeOnDarkLogo, lightTheme: openCodeOnLightLogo },
}

const disconnectedCodexAccount: CodexAccountView = {
  email: null,
  planType: null,
  requiresOpenaiAuth: true,
  type: null,
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

function ConnectionsSettingsRoute() {
  const queryClient = useQueryClient()
  const [selectedHarness, setSelectedHarness] = useState<"codex" | HarnessId>("codex")
  const [terminals, setTerminals] = useState<HarnessTerminalSession[]>([])
  const [activeTerminal, setActiveTerminal] = useState<string | null>(null)
  const harnessList = useQuery({
    queryFn: () => window.cypheria?.harnesses.list() ?? Promise.resolve([]),
    queryKey: ["harnesses"],
  })
  const account = useQuery({
    queryFn: () => window.cypheria?.codex.getAccount() ?? Promise.resolve(disconnectedCodexAccount),
    queryKey: ["codex", "account"],
  })
  const [apiKey, setApiKey] = useState("")
  const [authenticationMethod, setAuthenticationMethod] =
    useState<CodexAuthenticationMethod>("chatgpt")
  const [flow, setFlow] = useState<CodexLoginResult | null>(null)
  const [notificationError, setNotificationError] = useState<string | null>(null)

  const login = useMutation({
    mutationFn: async (request: CodexLoginRequest) => {
      if (!window.cypheria) throw new Error("Connections are only available in the desktop app.")
      return window.cypheria.codex.login(request)
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
      if (!window.cypheria) throw new Error("Connections are only available in the desktop app.")
      return window.cypheria.codex.logout()
    },
    onSuccess: async () => {
      setFlow(null)
      await queryClient.invalidateQueries({ queryKey: ["codex"] })
    },
  })

  const cancelLogin = useMutation({
    mutationFn: async (loginId: string) => {
      if (!window.cypheria) throw new Error("Connections are only available in the desktop app.")
      return window.cypheria.codex.cancelLogin(loginId)
    },
    onSuccess: () => setFlow(null),
  })

  useEffect(
    () =>
      window.cypheria?.codex.onEvent((envelope) => {
        if (envelope.event !== "codex.notification") return
        const payload = envelope.payload as {
          method?: string
          params?: { error?: string | null; success?: boolean }
        }
        if (payload.method === "account/login/completed") {
          setFlow(null)
          if (payload.params?.success === false) {
            setNotificationError(payload.params.error ?? "ChatGPT sign-in did not complete.")
          }
          void queryClient.invalidateQueries({ queryKey: ["codex", "account"] })
        }
        if (payload.method === "account/updated") {
          void queryClient.invalidateQueries({ queryKey: ["codex", "account"] })
        }
      }),
    [queryClient]
  )

  useEffect(() => {
    return () => {
      void window.cypheria?.harnesses.closeAllTerminals()
    }
  }, [])

  const openTerminal = async (id: HarnessId) => {
    const existing = terminals.find((terminal) => terminal.harnessId === id)
    if (existing) {
      setActiveTerminal(existing.terminalId)
      return
    }
    if (!window.cypheria) return
    const terminal = await window.cypheria.harnesses.openTerminal(id)
    setTerminals((current) => [...current, terminal])
    setActiveTerminal(terminal.terminalId)
  }

  const closeTerminal = async (terminalId: string) => {
    await window.cypheria?.harnesses.closeTerminal(terminalId)
    setTerminals((current) => {
      const remaining = current.filter((terminal) => terminal.terminalId !== terminalId)
      setActiveTerminal((active) =>
        active === terminalId ? (remaining.at(-1)?.terminalId ?? null) : active
      )
      return remaining
    })
  }

  const connected = Boolean(account.data?.type)
  const error = login.error?.message ?? logout.error?.message ?? notificationError

  return (
    <SettingsFrame wide>
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to the agent harnesses in Cypheria.
        </p>
      </div>

      <ProxySettingsCard />

      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Agent harnesses</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 px-2 pb-2">
            {harnesses.map((harness) => (
              <button
                className={
                  selectedHarness === harness.id
                    ? "flex items-center gap-3 rounded-md bg-muted px-3 py-2.5 text-left"
                    : "flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-muted-foreground hover:bg-muted/50"
                }
                key={harness.name}
                type="button"
                onClick={() => setSelectedHarness(harness.id)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                  {harness.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {harness.name}
                  </span>
                  <span className="block truncate text-xs">{harness.description}</span>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        {selectedHarness === "codex" ? (
          <Card>
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
          <HarnessConnectionCard
            harness={harnessList.data?.find((item) => item.id === selectedHarness)}
            loading={harnessList.isLoading}
            onOpenTerminal={() => void openTerminal(selectedHarness)}
            onUpdated={() => void queryClient.invalidateQueries({ queryKey: ["harnesses"] })}
          />
        )}
      </div>
      {terminals.length > 0 ? (
        <ConnectionTerminalDock
          activeTerminal={activeTerminal}
          terminals={terminals}
          onActiveTerminalChange={setActiveTerminal}
          onCloseTerminal={(terminalId) => void closeTerminal(terminalId)}
        />
      ) : null}
    </SettingsFrame>
  )
}

function HarnessConnectionCard({
  harness,
  loading,
  onOpenTerminal,
  onUpdated,
}: Readonly<{
  harness?: HarnessView
  loading: boolean
  onOpenTerminal: () => void
  onUpdated: () => void
}>) {
  const [progress, setProgress] = useState<string[]>([])
  useEffect(
    () =>
      window.cypheria?.harnesses.onEvent((event) => {
        if (!("harnessId" in event) || event.harnessId !== harness?.id) return
        setProgress((current) => [...current.slice(-9), event.message.trim()].filter(Boolean))
      }),
    [harness?.id]
  )
  const install = useMutation({
    mutationFn: async () => {
      if (!harness || !window.cypheria) throw new Error("Harness management is unavailable.")
      setProgress([])
      return harness.installState === "installed"
        ? window.cypheria.harnesses.update(harness.id)
        : window.cypheria.harnesses.install(harness.id)
    },
    onSuccess: onUpdated,
  })
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!harness || !window.cypheria) throw new Error("Harness management is unavailable.")
      return window.cypheria.harnesses.setEnabled(harness.id, enabled)
    },
    onSuccess: onUpdated,
  })
  const checkUpdate = useMutation({
    mutationFn: async () => {
      if (!harness || !window.cypheria) throw new Error("Harness management is unavailable.")
      return window.cypheria.harnesses.checkUpdate(harness.id)
    },
    onSuccess: onUpdated,
  })
  const checkForUpdate = checkUpdate.mutate
  const harnessId = harness?.id

  useEffect(() => {
    if (
      harnessId &&
      harness?.installState === "installed" &&
      harness.updateCheck === "supported" &&
      (!harness.lastUpdateCheckAt ||
        Date.now() - new Date(harness.lastUpdateCheckAt).getTime() > 24 * 60 * 60 * 1_000)
    ) {
      checkForUpdate()
    }
  }, [
    checkForUpdate,
    harnessId,
    harness?.installState,
    harness?.lastUpdateCheckAt,
    harness?.updateCheck,
  ])

  if (loading || !harness)
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-56 w-full" />
        </CardContent>
      </Card>
    )
  const installed = harness.installState === "installed"
  const error = install.error?.message ?? toggle.error?.message ?? checkUpdate.error?.message
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1.5">
            <CardTitle className="flex items-center gap-2">
              {harness.displayName}
              <Badge
                variant={harness.updateAvailable ? "default" : installed ? "secondary" : "outline"}
              >
                {installed ? (harness.installedVersion ?? "Installed") : "Not installed"}
              </Badge>
              {harness.updateAvailable ? (
                <Badge variant="outline">Update {harness.availableVersion}</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {harness.description}. Managed by Cypheria and launched through ACP.
            </CardDescription>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <ThemeLogo className="size-6 rounded-sm" sources={harnessLogos[harness.id]} />
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={install.isPending} onClick={() => install.mutate()}>
            {install.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {harness.updateAvailable
              ? `Install ${harness.availableVersion}`
              : installed
                ? "Install latest"
                : "Install latest version"}
          </Button>
          {installed && harness.updateCheck === "supported" ? (
            <Button
              disabled={checkUpdate.isPending}
              variant="outline"
              onClick={() => checkUpdate.mutate()}
            >
              <RefreshCw className={checkUpdate.isPending ? "size-4 animate-spin" : "size-4"} />
              Check updates
            </Button>
          ) : null}
          <Button disabled={!installed} variant="outline" onClick={onOpenTerminal}>
            <SquareTerminal className="size-4" /> Open terminal
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Enable in Cypheria</p>
            <p className="text-xs text-muted-foreground">
              The ACP process still starts only when this agent is used.
            </p>
          </div>
          <Switch
            checked={harness.enabled}
            disabled={!installed || toggle.isPending}
            onCheckedChange={(checked) => toggle.mutate(checked)}
          />
        </div>

        <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs">
          <div>
            <span className="text-muted-foreground">Managed home: </span>
            <span className="font-mono break-all">{harness.managedHome}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Executable: </span>
            <span className="font-mono break-all">{harness.executablePath}</span>
          </div>
          {harness.receiptPath ? (
            <div>
              <span className="text-muted-foreground">Latest install receipt: </span>
              <span className="font-mono break-all">{harness.receiptPath}</span>
            </div>
          ) : null}
          {installed ? (
            <div>
              <span className="text-muted-foreground">Updates: </span>
              <span>
                {harness.updateCheck === "nativeAuto"
                  ? "Cursor manages update checks; Install latest remains available."
                  : harness.updateCheck === "unsupported"
                    ? "No reliable upstream check is available."
                    : harness.updateAvailable
                      ? `${harness.availableVersion} is available.`
                      : harness.lastUpdateCheckAt
                        ? "No newer version reported."
                        : "Not checked yet."}
              </span>
            </div>
          ) : null}
        </div>

        {progress.length > 0 ? (
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md border bg-zinc-950 p-3 text-xs text-zinc-300">
            {progress.join("\n")}
          </pre>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <CircleAlert className="size-4" />
            <AlertTitle>Harness operation failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ConnectionTerminalDock({
  activeTerminal,
  terminals,
  onActiveTerminalChange,
  onCloseTerminal,
}: Readonly<{
  activeTerminal: string | null
  terminals: HarnessTerminalSession[]
  onActiveTerminalChange: (terminalId: string) => void
  onCloseTerminal: (terminalId: string) => void
}>) {
  return (
    <section className="sticky bottom-0 overflow-hidden rounded-lg border bg-zinc-950 shadow-2xl">
      <div className="flex items-center justify-between border-zinc-800 border-b px-2">
        <Tabs
          value={activeTerminal ?? terminals[0]?.terminalId}
          onValueChange={onActiveTerminalChange}
        >
          <TabsList className="h-10 bg-transparent">
            {terminals.map((terminal) => (
              <span className="relative" key={terminal.terminalId}>
                <TabsTrigger
                  className="data-active:bg-zinc-800 data-active:text-zinc-100 pr-7"
                  value={terminal.terminalId}
                >
                  {terminal.title}
                </TabsTrigger>
                <button
                  aria-label={`Close ${terminal.title} terminal`}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
                  type="button"
                  onClick={() => onCloseTerminal(terminal.terminalId)}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </TabsList>
        </Tabs>
        <span className="pr-3 text-xs text-zinc-500">Terminals close when leaving Connections</span>
      </div>
      <div className="h-72">
        {terminals.map((terminal) => (
          <ConnectionTerminal
            key={terminal.terminalId}
            active={terminal.terminalId === activeTerminal}
            session={terminal}
          />
        ))}
      </div>
    </section>
  )
}

function ConnectionTerminal({
  active,
  session,
}: Readonly<{ active: boolean; session: HarnessTerminalSession }>) {
  const container = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (!container.current) return
    const instance = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      theme: { background: "#09090b", foreground: "#d4d4d8" },
    })
    const fitAddon = new FitAddon()
    instance.loadAddon(fitAddon)
    instance.open(container.current)
    terminal.current = instance
    fit.current = fitAddon
    const data = instance.onData((value) => {
      void window.cypheria?.harnesses.writeTerminal(session.terminalId, value)
    })
    const unsubscribe = window.cypheria?.harnesses.onEvent((event: HarnessEvent) => {
      if (!("terminalId" in event) || event.terminalId !== session.terminalId) return
      if (event.type === "terminal.output") instance.write(event.data)
      else if (event.type === "terminal.exited")
        instance.write(`\r\n[process exited: ${event.exitCode}]\r\n`)
    })
    const resize = new ResizeObserver(() => {
      if (!activeRef.current) return
      fitAddon.fit()
      void window.cypheria?.harnesses.resizeTerminal(
        session.terminalId,
        instance.cols,
        instance.rows
      )
    })
    resize.observe(container.current)
    requestAnimationFrame(() => fitAddon.fit())
    return () => {
      resize.disconnect()
      unsubscribe?.()
      data.dispose()
      instance.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [session.terminalId])
  useEffect(() => {
    if (active)
      requestAnimationFrame(() => {
        fit.current?.fit()
        terminal.current?.focus()
      })
  }, [active])
  return <div className={active ? "h-full p-2" : "hidden"} ref={container} />
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
