import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@cypheria/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { CodexModelSettings, CodexNativeProvider } from "../../../ipc/src/index.js"
import { SettingsFrame } from "../components/settings-frame"

export const Route = createFileRoute("/settings/models")({ component: ModelSettingsRoute })

const providerOptions: Array<{ description: string; label: string; value: CodexNativeProvider }> = [
  { description: "ChatGPT or OpenAI API credentials", label: "OpenAI", value: "openai" },
  { description: "AWS-hosted foundation models", label: "Amazon Bedrock", value: "amazon-bedrock" },
  { description: "Models running on this computer", label: "Ollama", value: "ollama" },
  { description: "Local OpenAI-compatible runtime", label: "LM Studio", value: "lmstudio" },
]

function ModelSettingsRoute() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.getModelSettings(),
    queryKey: ["codex", "model-settings"],
  })
  const modelsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.listModels() ?? [],
    queryKey: ["codex", "models"],
  })
  const [draft, setDraft] = useState<CodexModelSettings | null>(null)
  useEffect(() => {
    if (settingsQuery.data) setDraft(settingsQuery.data)
  }, [settingsQuery.data])
  const models = modelsQuery.data ?? []
  const selectedModel = useMemo(
    () =>
      models.find((model) => model.model === draft?.model) ??
      models.find((model) => model.isDefault) ??
      models[0],
    [draft?.model, models]
  )
  const save = useMutation({
    mutationFn: async (settings: CodexModelSettings) => {
      if (!window.cypheria) throw new Error("Model settings are only available in the desktop app.")
      return window.cypheria.codex.setModelSettings(settings)
    },
    onSuccess: async (settings) => {
      setDraft(settings)
      queryClient.setQueryData(["codex", "model-settings"], settings)
      await queryClient.invalidateQueries({ queryKey: ["codex", "models"] })
    },
  })

  if (!draft)
    return (
      <SettingsFrame>
        <Skeleton className="h-80 w-full" />
      </SettingsFrame>
    )

  return (
    <SettingsFrame>
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the Codex provider and defaults used for new tasks.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Provider</CardTitle>
            <CardDescription>
              Cypheria uses providers supported by the bundled Codex App Server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel>Model provider</FieldLabel>
                <Select
                  value={draft.provider}
                  onValueChange={(value) =>
                    setDraft({ ...draft, model: null, provider: value as CodexNativeProvider })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providerOptions.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        <span className="grid">
                          <span>{provider.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {provider.description}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {draft.provider === "ollama" || draft.provider === "lmstudio"
                    ? "This provider can run without signing in to OpenAI."
                    : "Authentication is managed in Account & authentication."}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Default model</CardTitle>
            <CardDescription>
              The catalog is loaded from App Server and changes with authentication and provider
              configuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel>Model</FieldLabel>
                <Select
                  value={draft.model ?? selectedModel?.model ?? ""}
                  onValueChange={(value) => setDraft({ ...draft, model: String(value) })}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={modelsQuery.isLoading ? "Loading models…" : "Select a model"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.model}>
                        <span className="flex items-center gap-2">
                          {model.displayName}
                          {model.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Reasoning effort</FieldLabel>
                <Select
                  value={draft.reasoningEffort ?? selectedModel?.defaultReasoningEffort ?? ""}
                  onValueChange={(value) => setDraft({ ...draft, reasoningEffort: String(value) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Provider default" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedModel?.reasoningEfforts.map((effort) => (
                      <SelectItem key={effort.value} value={effort.value}>
                        {effort.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Service tier</FieldLabel>
                <Select
                  value={draft.serviceTier ?? "provider-default"}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      serviceTier: value === "provider-default" ? null : String(value),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="provider-default">Provider default</SelectItem>
                    {selectedModel?.serviceTiers.map((tier) => (
                      <SelectItem key={tier.id} value={tier.id}>
                        {tier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
        <div className="flex justify-end">
          <Button disabled={save.isPending} onClick={() => save.mutate(draft)}>
            {save.isSuccess ? <Check className="size-4" /> : null}
            {save.isPending ? "Saving…" : "Save model settings"}
          </Button>
        </div>
      </div>
    </SettingsFrame>
  )
}
