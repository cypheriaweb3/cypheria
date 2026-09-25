import { compatibilityTagForAgent, type ThreadContextUsage } from "@cypheria/protocol"
import { ChatContextUsage } from "@cypheria/ui/components/chat"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"

import { HarnessIcon } from "./harness-icon.js"

const sourceMessage = (source: ThreadContextUsage["source"]) => {
  if (source === "reported") return msg({ id: "chat.context.reported", message: "Agent reported" })
  if (source === "queried") return msg({ id: "chat.context.queried", message: "Live query" })
  if (source === "derived") return msg({ id: "chat.context.derived", message: "Derived" })
  return msg({ id: "chat.context.estimated", message: "Estimated" })
}

export function ContextUsage({ usage }: { usage: ThreadContextUsage }) {
  const { i18n } = useLingui()
  const agent = compatibilityTagForAgent(usage.agentId)
  const agentLabel =
    agent === "acp"
      ? usage.agentId
      : agent === "opencode"
        ? "OpenCode"
        : agent.charAt(0).toUpperCase() + agent.slice(1)
  const costLabel = usage.cost
    ? `${usage.cost.amount.toFixed(4)} ${usage.cost.currency} · ${usage.cost.scope}`
    : undefined

  return (
    <ChatContextUsage
      agent={agent}
      agentLabel={agentLabel}
      categories={
        usage.kind === "claude"
          ? usage.categories.map((category) => ({ ...category, label: category.name }))
          : undefined
      }
      costLabel={costLabel}
      icon={<HarnessIcon agentId={usage.agentId} name={agentLabel} />}
      maxTokens={usage.maxTokens}
      model={usage.model}
      sessionTokens={usage.kind === "pi" ? usage.sessionTokens : null}
      sourceLabel={i18n._(sourceMessage(usage.source))}
      tokens={usage.tokens}
      usedTokens={usage.usedTokens}
    />
  )
}
