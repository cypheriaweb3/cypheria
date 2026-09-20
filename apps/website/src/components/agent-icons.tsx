import claudeIcon from "@cypheria/ui/assets/agents/claude.svg?url"
import codexDarkIcon from "@cypheria/ui/assets/agents/codex-on-dark.svg?url"
import codexLightIcon from "@cypheria/ui/assets/agents/codex-on-light.svg?url"
import openCodeDarkIcon from "@cypheria/ui/assets/agents/opencode-on-dark.svg?url"
import openCodeLightIcon from "@cypheria/ui/assets/agents/opencode-on-light.svg?url"
import piIcon from "@cypheria/ui/assets/agents/pi.svg?url"

type AgentMarkProps = {
  name: "ACP" | "Claude" | "Codex" | "OpenCode" | "Pi"
}

export function AgentMark({ name }: AgentMarkProps) {
  if (name === "ACP") {
    return <span className="agent-wordmark">ACP</span>
  }

  if (name === "Codex" || name === "OpenCode") {
    const light = name === "Codex" ? codexLightIcon : openCodeLightIcon
    const dark = name === "Codex" ? codexDarkIcon : openCodeDarkIcon
    return (
      <span className="agent-theme-icon">
        <img alt="" className="agent-icon-light" src={light} />
        <img alt="" className="agent-icon-dark" src={dark} />
      </span>
    )
  }

  return <img alt="" className="agent-icon" src={name === "Claude" ? claudeIcon : piIcon} />
}
