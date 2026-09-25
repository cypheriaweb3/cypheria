import type {
  AgentId,
  HarnessCatalogSnapshot,
  HarnessSettingDefinition,
  HarnessSettingValue,
} from "@cypheria/protocol"
import { ChatModelSelector, type ChatModelSelectorOption } from "@cypheria/ui/components/chat"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { HarnessIcon } from "./harness-icon.js"

const setting = (
  catalog: HarnessCatalogSnapshot | undefined,
  ids: readonly string[]
): HarnessSettingDefinition | undefined =>
  catalog?.settingSections
    .flatMap((section) => section.settings)
    .find((item) => ids.includes(item.id))

const settingOptions = (value: HarnessSettingDefinition | undefined): ChatModelSelectorOption[] =>
  value?.type === "select"
    ? value.options.map((option) => ({
        description: option.description,
        label: option.label,
        value: option.value,
      }))
    : []

export function ComposerModelSelector({
  agentId,
  allowAgentChange,
  onAgentChange,
  onThreadConfigChange,
}: {
  agentId: AgentId
  allowAgentChange: boolean
  onAgentChange: (agentId: AgentId) => void
  onThreadConfigChange?: (patch: {
    model?: string | null
    speed?: string | null
    thinking?: string | null
  }) => Promise<void> | void
}) {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const agentsQuery = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).agents.list(),
    queryKey: ["agents", "composer"],
    staleTime: 30_000,
  })
  const catalogQuery = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).harnesses.models.list({ agentId }),
    queryKey: ["harness", "models", agentId],
  })
  const settingsQuery = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).harnesses.settings.get({ agentId }),
    queryKey: ["harness", "settings", agentId],
  })
  const catalog = catalogQuery.data ?? settingsQuery.data
  const agents = (agentsQuery.data?.agents ?? []).filter(
    (agent) => agent.id === agentId || (agent.enabled && agent.available)
  )
  const currentAgent = agents.find((agent) => agent.id === agentId)
  const modelSetting = setting(settingsQuery.data, ["model"])
  const reasoningSetting = setting(settingsQuery.data, [
    "reasoningEffort",
    "effort",
    "thinkingLevel",
    "thought_level",
  ])
  const speedSetting = setting(settingsQuery.data, ["serviceTier", "speed"])
  const currentModelId =
    modelSetting?.type === "select" && modelSetting.value
      ? modelSetting.value
      : (catalog?.models.find((model) => model.isDefault)?.id ?? catalog?.models[0]?.id ?? null)
  const currentModel = catalog?.models.find(
    (model) => model.id === currentModelId || model.aliases.includes(currentModelId ?? "")
  )
  const modelSpeedOptions = Array.isArray(currentModel?.metadata.serviceTiers)
    ? currentModel.metadata.serviceTiers.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return []
        const tier = candidate as Record<string, unknown>
        if (typeof tier.id !== "string" || typeof tier.name !== "string") return []
        return [
          {
            description: typeof tier.description === "string" ? tier.description : undefined,
            label: tier.name,
            value: tier.id,
          },
        ]
      })
    : []
  const reasoningOptions = currentModel?.thinkingOptions.length
    ? currentModel.thinkingOptions.map((option) => ({
        description: option.description,
        label: option.label,
        value: option.id,
      }))
    : settingOptions(reasoningSetting)
  const reasoning =
    reasoningSetting?.type === "select"
      ? reasoningSetting.value
      : (currentModel?.defaultThinkingOptionId ?? null)
  const speed = speedSetting?.type === "select" ? speedSetting.value : null

  const update = async (id: string, value: HarnessSettingValue) => {
    await (await ensureCypheriaClient()).harnesses.settings.update({
      agentId,
      values: { [id]: value },
    })
    await queryClient.invalidateQueries({ queryKey: ["harness", "settings", agentId] })
  }
  const commit = (
    id: string,
    value: HarnessSettingValue,
    patch: { model?: string | null; speed?: string | null; thinking?: string | null }
  ) => {
    void update(id, value)
      .then(() => onThreadConfigChange?.(patch))
      .catch(() => undefined)
  }

  const agentOptions = (
    allowAgentChange ? agents : agents.filter((agent) => agent.id === agentId)
  ).map((agent) => ({
    description: agent.description,
    icon: <HarnessIcon agentId={agent.id} icon={agent.icon} name={agent.name} />,
    label: agent.name,
    value: agent.id,
  }))

  return (
    <ChatModelSelector
      agent={agentId}
      agentLabel={currentAgent?.name ?? agentId}
      agentOptions={agentOptions}
      labels={{
        agent: i18n._(msg({ id: "chat.agent", message: "Agent" })),
        model: i18n._(msg({ id: "chat.model", message: "Model" })),
        reasoning: i18n._(msg({ id: "chat.reasoningEffort", message: "Reasoning effort" })),
        speed: i18n._(msg({ id: "chat.speed", message: "Speed" })),
      }}
      model={currentModelId}
      modelOptions={(catalog?.models ?? [])
        .filter((model) => model.isSelectable)
        .map((model) => ({
          description: model.providerLabel ?? model.description,
          label: model.label,
          value: model.id,
        }))}
      onAgentChange={(value) => onAgentChange(value as AgentId)}
      onModelChange={(value) => {
        commit(modelSetting?.id ?? "model", value, { model: value })
      }}
      onReasoningChange={(value) => {
        commit(reasoningSetting?.id ?? "reasoningEffort", value, { thinking: value })
      }}
      onSpeedChange={(value) => {
        if (!speedSetting) return
        commit(speedSetting.id, value, { speed: value })
      }}
      reasoning={reasoning}
      reasoningOptions={reasoningOptions}
      speed={speed}
      speedOptions={
        Array.isArray(currentModel?.metadata.serviceTiers)
          ? modelSpeedOptions
          : settingOptions(speedSetting)
      }
    />
  )
}
