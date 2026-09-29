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
const RULES: readonly AgentCompatibilityRule[] = []

export const agentCompatibilityRule = (
  agentId: AgentId,
  version: string
): AgentCompatibilityRule | undefined =>
  RULES.find((rule) => rule.agentId === agentId && rule.version === version)

export const AGENT_COMPATIBILITY_RULES = RULES
