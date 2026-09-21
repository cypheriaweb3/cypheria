import type { AgentId } from "@cypheria/protocol"

export type AgentCompatibilityRule = {
  agentId: AgentId
  additionalPythonPackages?: readonly string[]
  reason: string
  upstreamIssue?: string
  version: string
}

// Compatibility rules are a last resort for defects in an exact upstream
// release. The normal installer always applies the registry FORMAT.md runner
// semantics first; a rule may only add narrowly-scoped runtime dependencies.
const RULES: readonly AgentCompatibilityRule[] = [
  {
    agentId: "minion-code",
    additionalPythonPackages: ["agent-client-protocol==0.8.1"],
    reason:
      "minion-code 0.1.44 imports acp.schema.AuthMethod but leaves agent-client-protocol unbounded, so the current dependency no longer provides the imported model.",
    version: "0.1.44",
  },
]

export const agentCompatibilityRule = (
  agentId: AgentId,
  version: string
): AgentCompatibilityRule | undefined =>
  RULES.find((rule) => rule.agentId === agentId && rule.version === version)

export const AGENT_COMPATIBILITY_RULES = RULES
