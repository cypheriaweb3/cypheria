import type {
  AgentView,
  HarnessAuthConnection,
  HarnessAuthField,
  HarnessAuthFlow,
  HarnessAuthTestResult,
  HarnessAuthValue,
} from "@cypheria/protocol"
import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import { Checkbox } from "@cypheria/ui/components/checkbox"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@cypheria/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
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
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Unplug,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { createInMemorySearch } from "./harness-selection"
import { WorkspaceTerminalSurface } from "./workspace-terminal"

const connectionSource = (connection: HarnessAuthConnection): string => {
  if (connection.source === "environment") return "Managed by environment"
  if (connection.source === "mixed") return "Managed credential and environment"
  return connection.methodLabel ?? "Authenticated"
}

type AuthValues = Record<string, HarnessAuthValue>

const initialAuthValues = (fields: HarnessAuthField[]): AuthValues =>
  Object.fromEntries(
    fields.flatMap((field) =>
      field.defaultValue === null ? [] : [[field.id, field.defaultValue] as const]
    )
  )

const authFieldVisible = (field: HarnessAuthField, values: AuthValues): boolean =>
  !field.hidden &&
  field.when.every((condition) => {
    const matches = values[condition.fieldId] === condition.value
    return condition.operator === "equals" ? matches : !matches
  })

const authFieldsComplete = (fields: HarnessAuthField[], values: AuthValues): boolean =>
  fields.every((field) => {
    if (!authFieldVisible(field, values) || field.type === "external" || !field.required)
      return true
    const value = values[field.id]
    if (value === undefined || value === "") return false
    if (Array.isArray(value)) return value.length > 0
    return true
  })

function AuthenticationField({
  field,
  onChange,
  values,
}: {
  field: HarnessAuthField
  onChange: (id: string, value: HarnessAuthValue | undefined) => void
  values: AuthValues
}) {
  if (!authFieldVisible(field, values)) return null
  const value = values[field.id]
  const description = field.description ? (
    <FieldDescription>{field.description}</FieldDescription>
  ) : null
  if (field.type === "external") {
    if (!field.url) return null
    return (
      <Button
        variant="outline"
        onClick={() => window.cypheria?.app.openExternal(field.url as string)}
      >
        <ExternalLink />
        {field.label}
      </Button>
    )
  }
  if (field.type === "boolean") {
    return (
      <Field orientation="horizontal">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={`harness-auth-${field.id}`}>{field.label}</FieldLabel>
          {description}
        </div>
        <Switch
          checked={value === true}
          id={`harness-auth-${field.id}`}
          onCheckedChange={(checked) => onChange(field.id, checked)}
        />
      </Field>
    )
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : []
    return (
      <Field>
        <FieldLabel>{field.label}</FieldLabel>
        {description}
        <div className="grid gap-2 rounded-md border p-3">
          {field.options.map((item) => {
            const checked = selected.includes(item.value)
            return (
              <Field key={item.value} orientation="horizontal">
                <Checkbox
                  checked={checked}
                  id={`harness-auth-${field.id}-${item.value}`}
                  onCheckedChange={(nextChecked) =>
                    onChange(
                      field.id,
                      nextChecked
                        ? [...selected, item.value]
                        : selected.filter((candidate) => candidate !== item.value)
                    )
                  }
                />
                <FieldLabel htmlFor={`harness-auth-${field.id}-${item.value}`}>
                  <span>{item.label}</span>
                  {item.description ? (
                    <FieldDescription>{item.description}</FieldDescription>
                  ) : null}
                </FieldLabel>
              </Field>
            )
          })}
        </div>
      </Field>
    )
  }
  if (field.type === "text" && field.options.length > 0) {
    return (
      <Field>
        <FieldLabel htmlFor={`harness-auth-${field.id}`}>{field.label}</FieldLabel>
        {description}
        <Select
          value={typeof value === "string" ? value : null}
          onValueChange={(nextValue) => onChange(field.id, String(nextValue))}
        >
          <SelectTrigger className="w-full" id={`harness-auth-${field.id}`}>
            <SelectValue placeholder={field.placeholder ?? `Select ${field.label}`} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    )
  }
  const numeric = field.type === "number" || field.type === "integer"
  return (
    <Field>
      <FieldLabel htmlFor={`harness-auth-${field.id}`}>{field.label}</FieldLabel>
      {description}
      <Input
        autoComplete="off"
        id={`harness-auth-${field.id}`}
        max={numeric ? (field.max ?? undefined) : undefined}
        min={numeric ? (field.min ?? undefined) : undefined}
        placeholder={field.placeholder ?? undefined}
        step={field.type === "integer" ? 1 : undefined}
        type={field.type === "secret" ? "password" : numeric ? "number" : "text"}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        onChange={(event) => {
          const nextValue = event.currentTarget.value
          onChange(field.id, nextValue === "" ? undefined : numeric ? Number(nextValue) : nextValue)
        }}
      />
    </Field>
  )
}

function ConnectionTestResult({ result }: { result?: HarnessAuthTestResult }) {
  if (!result) return null
  const succeeded = result.status === "succeeded"
  return (
    <p
      className={
        succeeded
          ? "flex items-center gap-1.5 text-xs text-emerald-700"
          : "flex items-center gap-1.5 text-xs text-destructive"
      }
    >
      {succeeded ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
      {`${result.message} (${result.latencyMs} ms)`}
    </p>
  )
}

function ConnectionRow({
  agent,
  connection,
  multiple,
}: {
  agent: AgentView
  connection: HarnessAuthConnection
  multiple: boolean
}) {
  const queryClient = useQueryClient()
  const [testResult, setTestResult] = useState<HarnessAuthTestResult>()
  const test = useMutation({
    mutationFn: async () =>
      (await ensureCypheriaClient()).harnesses.auth.test({
        agentId: agent.id,
        connectionId: connection.id,
      }),
    onSuccess: setTestResult,
  })
  const disconnect = useMutation({
    mutationFn: async () =>
      (await ensureCypheriaClient()).harnesses.auth.logout({
        agentId: agent.id,
        connectionId: connection.id,
      }),
    onSuccess: async () => {
      setTestResult(undefined)
      await queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
    },
  })
  const error = test.error?.message ?? disconnect.error?.message
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-sm font-medium">
          {connection.providerLabel.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{connection.providerLabel}</p>
          <p className="truncate text-sm text-muted-foreground">
            {[connection.detail, connectionSource(connection)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button
          disabled={!connection.testSupported || test.isPending || disconnect.isPending}
          size="sm"
          variant="outline"
          onClick={() => {
            setTestResult(undefined)
            test.reset()
            test.mutate()
          }}
        >
          {test.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Test connection
        </Button>
        {multiple && connection.disconnectSupported ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={`Authentication options for ${connection.providerLabel}`}
                  disabled={disconnect.isPending}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => disconnect.mutate()}>
                <Unplug />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : !multiple && connection.disconnectSupported ? (
          <Button
            disabled={!connection.disconnectSupported || disconnect.isPending}
            size="sm"
            variant="outline"
            onClick={() => disconnect.mutate()}
          >
            {disconnect.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Unplug />}
            Disconnect
          </Button>
        ) : null}
      </div>
      <ConnectionTestResult result={testResult} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export function AuthenticationSection({ agent }: { agent: AgentView }) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [providerStep, setProviderStep] = useState(false)
  const [providerId, setProviderId] = useState("")
  const [providerSearchQuery, setProviderSearchQuery] = useState("")
  const [methodId, setMethodId] = useState("")
  const [values, setValues] = useState<AuthValues>({})
  const [flow, setFlow] = useState<HarnessAuthFlow>()
  const [flowResponse, setFlowResponse] = useState("")
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const terminalReplay = useRef(new Map<string, string>())
  const activeFlow = useRef<{ flowId: string; terminalId?: string } | null>(null)
  const view = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).harnesses.get(agent.id),
    queryKey: ["harness", agent.id, "auth"],
    refetchInterval: dialogOpen && flow?.state === "pending" && !flow.terminalId ? 1_000 : false,
  })
  const connectedProviderIds = useMemo(
    () => new Set(view.data?.connections.map((connection) => connection.providerId) ?? []),
    [view.data?.connections]
  )
  const availableProviders = useMemo(
    () =>
      (view.data?.providers ?? []).filter(
        (provider) =>
          !connectedProviderIds.has(provider.id) &&
          !provider.busy &&
          provider.authMethods.length > 0
      ),
    [connectedProviderIds, view.data?.providers]
  )
  const providerSearch = useMemo(
    () =>
      createInMemorySearch(
        availableProviders,
        (candidate) => `${candidate.label} ${candidate.id} ${candidate.description ?? ""}`
      ),
    [availableProviders]
  )
  const visibleProviders = useMemo(
    () => providerSearch.search(providerSearchQuery),
    [providerSearch, providerSearchQuery]
  )
  const provider = view.data?.providers.find((candidate) => candidate.id === providerId)
  const method = provider?.authMethods.find((candidate) => candidate.id === methodId)

  const clearDialog = useCallback(() => {
    activeFlow.current = null
    terminalReplay.current.clear()
    setDialogOpen(false)
    setProviderStep(false)
    setProviderId("")
    setProviderSearchQuery("")
    setMethodId("")
    setValues({})
    setFlow(undefined)
    setFlowResponse("")
    setTerminalError(null)
  }, [])

  const completeDialog = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["harness", agent.id] })
    clearDialog()
  }, [agent.id, clearDialog, queryClient])

  const auth = useMutation({
    mutationFn: async () => {
      if (!provider || !method) throw new Error("Choose an authentication method")
      return (await ensureCypheriaClient()).harnesses.auth.start({
        agentId: agent.id,
        methodId: method.id,
        providerId: provider.id,
        ...(Object.keys(values).length > 0 ? { values } : {}),
      })
    },
    onSuccess: async (nextFlow) => {
      setFlow(nextFlow)
      setTerminalError(null)
      if (nextFlow.state === "pending" && nextFlow.flowId) {
        activeFlow.current = {
          flowId: nextFlow.flowId,
          ...(nextFlow.terminalId ? { terminalId: nextFlow.terminalId } : {}),
        }
      }
      if (nextFlow.state === "pending" && nextFlow.externalUrl) {
        await window.cypheria?.app.openExternal(nextFlow.externalUrl)
      }
      if (nextFlow.state === "completed") await completeDialog()
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
    onSuccess: clearDialog,
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
      setFlowResponse("")
      setFlow(nextFlow)
      if (nextFlow.state === "pending" && nextFlow.externalUrl) {
        await window.cypheria?.app.openExternal(nextFlow.externalUrl)
      }
      if (nextFlow.state === "completed") await completeDialog()
    },
  })

  const resetAuth = auth.reset
  const resetCancel = cancel.reset
  const resetRespond = respond.reset
  const resetDialogRequests = useCallback(() => {
    resetAuth()
    resetCancel()
    resetRespond()
  }, [resetAuth, resetCancel, resetRespond])

  useEffect(() => {
    if (!dialogOpen) resetDialogRequests()
  }, [dialogOpen, resetDialogRequests])

  const requestClose = useCallback(() => {
    if (auth.isPending) return
    if (flow?.state === "pending" && flow.flowId) cancel.mutate()
    else {
      clearDialog()
      resetDialogRequests()
    }
  }, [auth.isPending, cancel, clearDialog, flow, resetDialogRequests])

  const openSingle = () => {
    const nextProvider = view.data?.providers[0]
    if (!nextProvider) return
    resetDialogRequests()
    setProviderId(nextProvider.id)
    setMethodId((current) =>
      nextProvider.authMethods.some((candidate) => candidate.id === current)
        ? current
        : (nextProvider.authMethods[0]?.id ?? "")
    )
    const nextMethod =
      nextProvider.authMethods.find((candidate) => candidate.id === methodId) ??
      nextProvider.authMethods[0]
    setValues(initialAuthValues(nextMethod?.fields ?? []))
    setProviderStep(false)
    setDialogOpen(true)
  }

  const openMultiple = () => {
    resetDialogRequests()
    setProviderId("")
    setProviderSearchQuery("")
    setMethodId("")
    setValues({})
    setProviderStep(true)
    setDialogOpen(true)
  }

  useEffect(() => {
    if (!dialogOpen || !providerId) return
    if (view.data?.connections.some((connection) => connection.providerId === providerId)) {
      void completeDialog()
    }
  }, [completeDialog, dialogOpen, providerId, view.data?.connections])

  useEffect(() => {
    if (
      flow?.state !== "pending" ||
      !flow.flowId ||
      (!flow.flowId?.startsWith("pi:") &&
        !flow.flowId?.startsWith("opencode:") &&
        agent.id !== "codex") ||
      flow.input !== "none"
    ) {
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = () => {
      void ensureCypheriaClient()
        .then((client) =>
          client.harnesses.auth.poll(
            { agentId: agent.id, flowId: flow.flowId as string },
            { timeoutMs: 5 * 60_000 }
          )
        )
        .then(async (nextFlow) => {
          if (disposed) return
          setFlow(
            nextFlow.state === "pending" && !nextFlow.externalUrl && flow.externalUrl
              ? { ...nextFlow, externalUrl: flow.externalUrl }
              : nextFlow
          )
          if (nextFlow.state === "pending" && nextFlow.externalUrl) {
            await window.cypheria?.app.openExternal(nextFlow.externalUrl)
          }
          if (nextFlow.state === "completed") await completeDialog()
        })
        .catch((error: unknown) => {
          if (!disposed) {
            setFlow({
              message: error instanceof Error ? error.message : String(error),
              state: "failed",
            })
          }
        })
    }
    if (flow.flowId.startsWith("opencode:")) timer = setTimeout(poll, 1_000)
    else poll()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [agent.id, completeDialog, flow])

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
        if (message.payload.exitCode === 0) {
          void completeDialog()
        } else {
          setTerminalError(`Authentication process exited with code ${message.payload.exitCode}.`)
          setFlow({
            message: `Authentication process exited with code ${message.payload.exitCode}.`,
            state: "failed",
          })
        }
      })
    })
    return () => {
      disposed = true
      unsubscribeOutput()
      unsubscribeExited()
      const pending = activeFlow.current
      activeFlow.current = null
      if (pending?.flowId) {
        void ensureCypheriaClient().then((client) =>
          client.harnesses.auth.cancel({ agentId: agent.id, flowId: pending.flowId })
        )
      }
    }
  }, [agent.id, completeDialog])

  const error =
    auth.error?.message ??
    cancel.error?.message ??
    respond.error?.message ??
    view.error?.message ??
    terminalError ??
    (flow?.state === "failed" ? flow.message : null)
  const single = view.data?.mode !== "multiple"
  const singleConnection = view.data?.connections[0]
  const canSubmit = Boolean(method) && authFieldsComplete(method?.fields ?? [], values)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentication</CardTitle>
        <CardDescription>
          Credentials stay in the harness credential store and are never written to Cypheria
          settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view.isLoading ? <Skeleton className="h-32" /> : null}
        {view.data?.connections.map((connection) => (
          <ConnectionRow
            agent={agent}
            connection={connection}
            key={connection.id}
            multiple={!single}
          />
        ))}
        {single &&
        !singleConnection &&
        view.data?.providers[0] &&
        view.data.providers[0].authMethods.length > 0 ? (
          <div className="grid gap-4">
            <RadioGroup
              className="cypheria-scrollbar max-h-80 overflow-y-auto pr-1"
              value={methodId || view.data.providers[0].authMethods[0]?.id || ""}
              onValueChange={(value) => {
                const nextMethod = view.data?.providers[0]?.authMethods.find(
                  (candidate) => candidate.id === String(value)
                )
                setMethodId(String(value))
                setValues(initialAuthValues(nextMethod?.fields ?? []))
              }}
            >
              {view.data.providers[0].authMethods.map((authMethod) => (
                <Field
                  className="rounded-md border p-3"
                  key={authMethod.id}
                  orientation="horizontal"
                >
                  <RadioGroupItem id={`auth-${authMethod.id}`} value={authMethod.id} />
                  <FieldLabel htmlFor={`auth-${authMethod.id}`}>
                    <span>{authMethod.label}</span>
                    {authMethod.description ? (
                      <FieldDescription>{authMethod.description}</FieldDescription>
                    ) : null}
                  </FieldLabel>
                </Field>
              ))}
            </RadioGroup>
            <Button className="justify-self-start" onClick={openSingle}>
              Configure
            </Button>
          </div>
        ) : null}
        {!single ? (
          <Button
            className="justify-self-start"
            disabled={availableProviders.length === 0}
            variant="outline"
            onClick={openMultiple}
          >
            <Plus />
            Add provider
          </Button>
        ) : null}
        {!view.isLoading &&
        !singleConnection &&
        (view.data?.providers.length === 0 ||
          view.data?.providers.every((candidate) => candidate.authMethods.length === 0)) ? (
          <Alert>
            <AlertTitle>Authentication unavailable</AlertTitle>
            <AlertDescription>
              {view.data?.providers[0]?.description ??
                "This harness does not advertise an authentication method."}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : requestClose())}
      >
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={!auth.isPending && !cancel.isPending}
        >
          <DialogHeader>
            <DialogTitle>
              {providerStep ? "Add provider" : `Configure ${provider?.label ?? agent.name}`}
            </DialogTitle>
            <DialogDescription>
              {providerStep
                ? "Choose a provider. Its authentication methods are selected in the next step."
                : single
                  ? (method?.description ?? `Configure ${method?.label ?? agent.name}.`)
                  : "Choose one authentication method for this provider."}
            </DialogDescription>
          </DialogHeader>

          {providerStep ? (
            <Command className="rounded-lg border" shouldFilter={false}>
              <CommandInput
                placeholder="Search providers…"
                value={providerSearchQuery}
                onValueChange={setProviderSearchQuery}
              />
              <CommandList className="cypheria-scrollbar max-h-72 p-1 pt-2">
                <CommandEmpty>No matching providers.</CommandEmpty>
                {visibleProviders.map((candidate) => (
                  <CommandItem
                    key={candidate.id}
                    value={`${candidate.label} ${candidate.description ?? ""}`}
                    onSelect={() => {
                      setProviderId(candidate.id)
                      setMethodId(candidate.authMethods[0]?.id ?? "")
                      setValues(initialAuthValues(candidate.authMethods[0]?.fields ?? []))
                      setProviderStep(false)
                    }}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-xs font-medium">
                      {candidate.label.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{candidate.label}</span>
                      {candidate.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {candidate.description}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          ) : (
            <div className="grid gap-4">
              {view.data?.mode === "multiple" && !flow ? (
                <Button
                  className="justify-self-start px-0"
                  size="sm"
                  variant="ghost"
                  onClick={() => setProviderStep(true)}
                >
                  <ArrowLeft />
                  Providers
                </Button>
              ) : null}
              {!flow && !single ? (
                <RadioGroup
                  className="cypheria-scrollbar max-h-64 overflow-y-auto pr-1"
                  value={method?.id ?? ""}
                  onValueChange={(value) => {
                    const nextMethod = provider?.authMethods.find(
                      (candidate) => candidate.id === String(value)
                    )
                    setMethodId(String(value))
                    setValues(initialAuthValues(nextMethod?.fields ?? []))
                  }}
                >
                  {provider?.authMethods.map((authMethod) => (
                    <Field
                      className="rounded-md border p-3"
                      key={authMethod.id}
                      orientation="horizontal"
                    >
                      <RadioGroupItem id={`dialog-auth-${authMethod.id}`} value={authMethod.id} />
                      <FieldLabel htmlFor={`dialog-auth-${authMethod.id}`}>
                        <span>{authMethod.label}</span>
                        {authMethod.description ? (
                          <FieldDescription>{authMethod.description}</FieldDescription>
                        ) : null}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              ) : null}
              {!flow
                ? method?.fields.map((field) => (
                    <AuthenticationField
                      field={field}
                      key={field.id}
                      values={values}
                      onChange={(id, value) =>
                        setValues((current) => {
                          if (value === undefined) {
                            const { [id]: _removed, ...rest } = current
                            return rest
                          }
                          return { ...current, [id]: value }
                        })
                      }
                    />
                  ))
                : null}
              {flow?.state === "pending" &&
              flow.message &&
              !flow.deviceCode &&
              flow.input !== "text" &&
              flow.input !== "secret" ? (
                <Alert>
                  <AlertTitle>Complete authentication</AlertTitle>
                  <AlertDescription>{flow.message}</AlertDescription>
                </Alert>
              ) : null}
              {flow?.state === "pending" && flow.deviceCode ? (
                <div className="grid gap-3 rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">Device code</p>
                    <p className="text-sm text-muted-foreground">
                      Enter this code on the authentication page.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-center text-lg font-semibold tracking-[0.18em]">
                      {flow.deviceCode.userCode}
                    </code>
                    <Button
                      aria-label="Copy device code"
                      size="icon"
                      variant="outline"
                      onClick={() =>
                        void navigator.clipboard.writeText(flow.deviceCode?.userCode ?? "")
                      }
                    >
                      <Copy />
                    </Button>
                  </div>
                  {flow.deviceCode.expiresInSeconds ? (
                    <p className="text-xs text-muted-foreground">
                      Expires in {Math.ceil(flow.deviceCode.expiresInSeconds / 60)} minutes.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {flow?.state === "pending" && flow.externalUrl ? (
                <Button
                  variant="outline"
                  onClick={() => window.cypheria?.app.openExternal(flow.externalUrl as string)}
                >
                  <ExternalLink />
                  Open authentication page
                </Button>
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
              {flow?.state === "pending" && flow.flowId && flow.input === "select" ? (
                <RadioGroup
                  className="cypheria-scrollbar max-h-64 overflow-y-auto pr-1"
                  value={flowResponse}
                  onValueChange={(value) => setFlowResponse(String(value))}
                >
                  {flow.inputOptions.map((option) => (
                    <Field
                      className="rounded-md border p-3"
                      key={option.value}
                      orientation="horizontal"
                    >
                      <RadioGroupItem id={`flow-option-${option.value}`} value={option.value} />
                      <FieldLabel htmlFor={`flow-option-${option.value}`}>
                        <span>{option.label}</span>
                        {option.description ? (
                          <FieldDescription>{option.description}</FieldDescription>
                        ) : null}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              ) : null}
              {flow?.state === "pending" &&
              flow.flowId &&
              (flow.input === "text" || flow.input === "secret") ? (
                <Field>
                  <FieldLabel htmlFor="harness-auth-response">
                    {flow.message ?? "Authentication response"}
                  </FieldLabel>
                  <Input
                    id="harness-auth-response"
                    placeholder={flow.placeholder ?? undefined}
                    type={flow.input === "secret" ? "password" : "text"}
                    value={flowResponse}
                    onChange={(event) => setFlowResponse(event.currentTarget.value)}
                  />
                </Field>
              ) : null}
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Authentication failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}

          {!providerStep ? (
            <DialogFooter>
              <Button
                disabled={auth.isPending || cancel.isPending}
                variant="outline"
                onClick={requestClose}
              >
                {cancel.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Cancel
              </Button>
              {!flow ? (
                <Button disabled={!canSubmit || auth.isPending} onClick={() => auth.mutate()}>
                  {auth.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  OK
                </Button>
              ) : null}
              {flow?.state === "pending" && flow.input !== "none" ? (
                <Button
                  disabled={!flowResponse || respond.isPending}
                  onClick={() => respond.mutate()}
                >
                  {respond.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  OK
                </Button>
              ) : null}
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
