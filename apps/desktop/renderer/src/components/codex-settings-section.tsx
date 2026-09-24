import type { HarnessCatalogSnapshot, HarnessSettingValue } from "@cypheria/protocol"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@cypheria/ui/components/card"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@cypheria/ui/components/select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { Switch } from "@cypheria/ui/components/switch"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { ensureCypheriaClient } from "../cypheria-client.js"

type Choice = { value: string; label: string; description?: string }
type SettingUpdate = { requestId: number; values: Record<string, HarnessSettingValue> }
type PendingValue = { requestId: number; value: HarnessSettingValue }

const effortChoices: Choice[] = [
  { value: "low", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
]

function SettingSelect({
  choices,
  description,
  disabled,
  label,
  onChange,
  value,
}: {
  choices: Choice[]
  description: string
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-4 last:border-b-0 max-sm:flex-col">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Select
        disabled={disabled || choices.length === 0}
        value={value}
        onValueChange={(next) => onChange(String(next))}
      >
        <SelectTrigger aria-label={label} className="w-56 max-sm:w-full">
          {choices.find((choice) => choice.value === value)?.label ?? "Unavailable"}
        </SelectTrigger>
        <SelectContent className="w-max min-w-(--anchor-width) max-w-[min(90vw,36rem)]">
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              <div className="grid gap-0.5">
                <span>{choice.label}</span>
                {choice.description ? (
                  <span className="text-xs whitespace-normal text-muted-foreground">
                    {choice.description}
                  </span>
                ) : null}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SettingSwitch({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  description: string
  disabled?: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

export function CodexSettingsSection({
  snapshot,
  loading,
}: {
  snapshot?: HarnessCatalogSnapshot
  loading: boolean
}) {
  const queryClient = useQueryClient()
  const settings = snapshot?.settingSections.find((section) => section.id === "settings")
  const nextRequestId = useRef(0)
  const [pendingValues, setPendingValues] = useState<Record<string, PendingValue>>({})
  const get = (id: string) =>
    id in pendingValues
      ? pendingValues[id]?.value
      : settings?.settings.find((item) => item.id === id)?.value
  const selectedModel =
    snapshot?.models.find((model) => model.id === get("model")) ??
    snapshot?.models.find((model) => model.isDefault)
  const selectedModelId = String(get("model") ?? selectedModel?.id ?? "")
  const supportedEfforts = useMemo(
    () => new Set(selectedModel?.thinkingOptions.map((effort) => effort.id) ?? []),
    [selectedModel]
  )
  const save = useMutation({
    mutationKey: ["codex", "settings-update"],
    scope: { id: "codex-settings-update" },
    mutationFn: async ({ values }: SettingUpdate) =>
      (await ensureCypheriaClient()).harnesses.settings.update({
        agentId: "codex",
        values,
      }),
    onSuccess: async (value) => {
      queryClient.setQueryData(["harness", "codex", "catalog"], value)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["codex", "model-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["codex", "permission-defaults"] }),
        queryClient.invalidateQueries({ queryKey: ["codex", "permissions"] }),
      ])
    },
    onSettled: (_data, _error, { requestId, values }) => {
      setPendingValues((current) => {
        const next = { ...current }
        for (const id of Object.keys(values)) {
          if (next[id]?.requestId === requestId) delete next[id]
        }
        return next
      })
    },
  })
  const submit = (values: Record<string, HarnessSettingValue>) => {
    const requestId = ++nextRequestId.current
    setPendingValues((current) => ({
      ...current,
      ...Object.fromEntries(
        Object.entries(values).map(([id, value]) => [id, { requestId, value }])
      ),
    }))
    save.mutate({ requestId, values })
  }
  const set = (id: string, value: HarnessSettingValue) => {
    if (get(id) === value) return
    submit({ [id]: value })
  }
  const setModel = (modelId: string) => {
    if (modelId === selectedModelId) return
    const model = snapshot?.models.find((item) => item.id === modelId)
    const effort = get("reasoningEffort")
    const values: Record<string, HarnessSettingValue> = { model: modelId }
    if (
      typeof effort === "string" &&
      model &&
      !model.thinkingOptions.some((option) => option.id === effort)
    ) {
      values.reasoningEffort = null
    }
    submit(values)
  }
  const refreshModels = useMutation({
    mutationFn: async () => {
      const startedAt = performance.now()
      const result = await (await ensureCypheriaClient()).harnesses.models.list({
        agentId: "codex",
        refresh: true,
      })
      const remainingMs = 450 - (performance.now() - startedAt)
      if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingMs))
      return result
    },
    onSuccess: (value) => queryClient.setQueryData(["harness", "codex", "catalog"], value),
  })
  if (loading || !settings) return <Skeleton className="h-96" />
  const options = (id: string, choices: Choice[]) => {
    const allowed = settings.settings.find((item) => item.id === id)
    return allowed?.type === "select"
      ? choices.filter((choice) => allowed.options.some((option) => option.value === choice.value))
      : choices
  }
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingSelect
            label="Approval policy"
            description="Choose when Codex asks for approval"
            value={String(get("approvalPolicy") ?? "on-request")}
            onChange={(value) => set("approvalPolicy", value)}
            choices={options("approvalPolicy", [
              {
                value: "on-request",
                label: "On request",
                description: "Ask when escalation is requested",
              },
              {
                value: "never",
                label: "Never ask for approval",
                description: "Blocked actions fail instead of requesting approval",
              },
            ])}
          />
          {(get("approvalPolicy") ?? "on-request") === "on-request" ? (
            <SettingSelect
              label="Approvals reviewer"
              description="Choose who reviews eligible approval requests"
              value={String(get("approvalsReviewer") ?? "user")}
              onChange={(value) => set("approvalsReviewer", value)}
              choices={options("approvalsReviewer", [
                {
                  value: "user",
                  label: "User",
                  description: "Approval prompts surface to the user",
                },
                {
                  value: "auto_review",
                  label: "Auto review",
                  description: "Eligible approval prompts go to a reviewer agent",
                },
              ])}
            />
          ) : null}
          <SettingSelect
            label="Sandbox settings"
            description="Choose how much Codex can do when running commands"
            value={String(get("sandboxMode") ?? "workspace-write")}
            onChange={(value) => set("sandboxMode", value)}
            choices={options("sandboxMode", [
              {
                value: "read-only",
                label: "Read only",
                description: "Can read files, but cannot edit them",
              },
              {
                value: "workspace-write",
                label: "Workspace write",
                description: "Can edit files, but only in this workspace",
              },
              {
                value: "danger-full-access",
                label: "Full access",
                description: "Can edit files outside this workspace",
              },
            ])}
          />
          {(get("sandboxMode") ?? "workspace-write") === "workspace-write" ? (
            <SettingSwitch
              label="Allow network access"
              description="Allow network access when the sandbox is set to workspace write"
              checked={Boolean(get("networkAccess"))}
              onChange={(value) => set("networkAccess", value)}
            />
          ) : null}
          <SettingSelect
            label="Web search"
            description="Choose how Codex accesses the web"
            value={String(get("webSearch") ?? "cached")}
            onChange={(value) => set("webSearch", value)}
            choices={options("webSearch", [
              { value: "disabled", label: "Disabled", description: "Don't allow web search" },
              {
                value: "cached",
                label: "Cached",
                description: "Use OpenAI's maintained search index",
              },
              {
                value: "indexed",
                label: "Indexed",
                description: "Allow indexed external web access",
              },
              {
                value: "live",
                label: "Live",
                description: "Allow unrestricted, current web access",
              },
            ])}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border-b py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Model</div>
              <Button
                aria-busy={refreshModels.isPending}
                aria-label={refreshModels.isPending ? "Refreshing models" : "Refresh models"}
                disabled={refreshModels.isPending || Object.keys(pendingValues).length > 0}
                onClick={() => refreshModels.mutate()}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCw
                  className={refreshModels.isPending ? "size-4 motion-safe:animate-spin" : "size-4"}
                />
                {refreshModels.isPending ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose the model Codex uses by default
            </p>
            {refreshModels.error ? (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {refreshModels.error.message}
              </p>
            ) : null}
            <div className="cypheria-scrollbar mt-3 max-h-80 overflow-y-auto rounded-md border">
              {(snapshot?.models ?? [])
                .filter((model) => model.isSelectable)
                .map((model) => (
                  <div
                    key={model.id}
                    className="group/model flex w-full items-start justify-between gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{model.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {model.providerLabel ?? model.providerId ?? "Provider default"} · {model.id}
                      </span>
                      {model.description ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {model.description}
                        </span>
                      ) : null}
                    </span>
                    {model.id === selectedModelId ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : (
                      <Button
                        aria-label={`Set ${model.label} as default`}
                        className="opacity-0 transition-opacity group-hover/model:opacity-100 group-focus-within/model:opacity-100 max-sm:opacity-100"
                        onClick={() => setModel(model.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Set default
                      </Button>
                    )}
                  </div>
                ))}
              {!snapshot?.models.some((model) => model.isSelectable) ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No models reported. Authenticate Codex, then refresh.
                </p>
              ) : null}
            </div>
          </div>
          <SettingSelect
            label="Reasoning effort"
            description="Tune how much reasoning effort the model applies when supported"
            value={String(
              get("reasoningEffort") ?? selectedModel?.defaultThinkingOptionId ?? "medium"
            )}
            onChange={(value) => set("reasoningEffort", value)}
            choices={effortChoices.filter(
              (choice) => !selectedModel || supportedEfforts.has(choice.value)
            )}
          />
          <SettingSelect
            label="Speed"
            description="Choose how quickly Codex runs across chats, subagents, and compaction"
            value={String(get("serviceTier") ?? "default")}
            onChange={(value) => set("serviceTier", value)}
            choices={[
              { value: "default", label: "Standard", description: "Default speed" },
              { value: "priority", label: "Fast", description: "Faster speed, increased usage" },
            ]}
          />
          <SettingSelect
            label="Communication style"
            description="Set a default communication style for supported models."
            value={String(get("personality") ?? "pragmatic")}
            onChange={(value) => set("personality", value)}
            choices={[
              { value: "friendly", label: "Friendly" },
              { value: "pragmatic", label: "Pragmatic" },
              { value: "none", label: "None" },
            ]}
          />
          <SettingSelect
            label="Output detail"
            description="Choose how much detail Codex includes in responses"
            value={String(get("modelVerbosity") ?? "model-default")}
            onChange={(value) => set("modelVerbosity", value === "model-default" ? null : value)}
            choices={[
              {
                value: "model-default",
                label: "Model default",
                description: "Let the selected model choose the response detail",
              },
              { value: "low", label: "Low", description: "Keep responses concise" },
              { value: "medium", label: "Medium", description: "Balance detail and brevity" },
              { value: "high", label: "High", description: "Include more detail in responses" },
            ]}
          />
          <SettingSelect
            label="Reasoning summary"
            description="Choose how Codex summarizes its reasoning"
            value={String(get("modelReasoningSummary") ?? "model-default")}
            onChange={(value) =>
              set("modelReasoningSummary", value === "model-default" ? null : value)
            }
            choices={[
              {
                value: "model-default",
                label: "Model default",
                description: "Use the selected model's default reasoning summary",
              },
              {
                value: "auto",
                label: "Auto",
                description: "Let the model choose the summary detail",
              },
              { value: "concise", label: "Concise", description: "Show a brief reasoning summary" },
              {
                value: "detailed",
                label: "Detailed",
                description: "Show a more detailed reasoning summary",
              },
              { value: "none", label: "None", description: "Don't show reasoning summaries" },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingSwitch
            label="Plugins"
            description="Allow Codex to use installed plugins"
            checked={Boolean(get("pluginsEnabled"))}
            onChange={(value) => set("pluginsEnabled", value)}
          />
        </CardContent>
      </Card>
      {save.error ? (
        <p className="text-sm text-destructive" role="alert">
          {save.error.message}
        </p>
      ) : null}
    </div>
  )
}
