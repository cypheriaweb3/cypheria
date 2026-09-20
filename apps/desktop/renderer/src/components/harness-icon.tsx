import type { AgentId } from "@cypheria/protocol"
import claudeLogo from "@cypheria/ui/assets/agents/claude.svg"
import codexOnDarkLogo from "@cypheria/ui/assets/agents/codex-on-dark.svg"
import codexOnLightLogo from "@cypheria/ui/assets/agents/codex-on-light.svg"
import openCodeOnDarkLogo from "@cypheria/ui/assets/agents/opencode-on-dark.svg"
import openCodeOnLightLogo from "@cypheria/ui/assets/agents/opencode-on-light.svg"
import piLogo from "@cypheria/ui/assets/agents/pi.svg"
import { useState } from "react"

type HarnessIconProps = {
  agentId: AgentId
  className?: string
  icon?: string | null
  name: string
}

function ThemeIcon({ dark, light, className }: { dark: string; light: string; className: string }) {
  return (
    <>
      <img alt="" className={`${className} dark:hidden`} src={light} />
      <img alt="" className={`${className} hidden dark:block`} src={dark} />
    </>
  )
}

export function HarnessIcon({ agentId, className = "size-5", icon, name }: HarnessIconProps) {
  const [failed, setFailed] = useState(false)
  if (agentId === "codex") {
    return <ThemeIcon className={className} dark={codexOnDarkLogo} light={codexOnLightLogo} />
  }
  if (agentId === "claude") return <img alt="" className={className} src={claudeLogo} />
  if (agentId === "pi") return <img alt="" className={className} src={piLogo} />
  if (agentId === "opencode") {
    return <ThemeIcon className={className} dark={openCodeOnDarkLogo} light={openCodeOnLightLogo} />
  }
  if (icon?.startsWith("https://") && !failed) {
    return (
      <img
        alt=""
        className={className}
        loading="lazy"
        referrerPolicy="no-referrer"
        src={icon}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span aria-hidden="true" className="text-[10px] font-semibold uppercase">
      {name.slice(0, 2)}
    </span>
  )
}
