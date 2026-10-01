export type SettingsNavigationAgent = {
  id: string
  name: string
}

export type SettingsNavigationGatewaySection = {
  href: string
  id: string
  label: string
}

export type SettingsNavigationRow<TAgent extends SettingsNavigationAgent, TIcon> =
  | { id: "back"; kind: "back" }
  | { id: string; kind: "group"; label: string }
  | { href: string; icon: TIcon; id: string; kind: "item"; label: string }
  | { id: "agent-harnesses"; kind: "harness"; label: string }
  | { agent: TAgent; id: string; kind: "agent" }
  | { id: "gateway"; kind: "gateway"; label: string }
  | { href: string; id: string; kind: "gateway-section"; label: string; sectionId: string }
  | { id: "empty"; kind: "empty"; label: string }

const nativeOrder = new Map([
  ["codex", 0],
  ["claude", 1],
  ["pi", 2],
  ["opencode", 3],
])

export function buildSettingsNavigationRows<TAgent extends SettingsNavigationAgent, TIcon>(input: {
  agents: TAgent[]
  emptyLabel: string
  gatewayExpanded?: boolean
  gatewayLabel?: string
  gatewaySections?: SettingsNavigationGatewaySection[]
  groups: Array<{
    id: string
    items: Array<{ href: string; icon: TIcon; label: string }>
    label: string
  }>
  harnessGroupId: string
  harnessLabel: string
  harnessesExpanded: boolean
  locale: string
  query: string
}): Array<SettingsNavigationRow<TAgent, TIcon>> {
  const needle = input.query.trim().toLocaleLowerCase(input.locale)
  const harnessMatches =
    !needle || input.harnessLabel.toLocaleLowerCase(input.locale).includes(needle)
  const agents = input.agents
    .filter(
      (agent) =>
        !needle || harnessMatches || agent.name.toLocaleLowerCase(input.locale).includes(needle)
    )
    .sort((left, right) => {
      const leftOrder = nativeOrder.get(left.id)
      const rightOrder = nativeOrder.get(right.id)
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER)
      }
      return left.name.localeCompare(right.name, input.locale)
    })
  const rows: Array<SettingsNavigationRow<TAgent, TIcon>> = [{ id: "back", kind: "back" }]
  for (const group of input.groups) {
    const items = group.items.filter(
      (item) => !needle || item.label.toLocaleLowerCase(input.locale).includes(needle)
    )
    const gatewayMatches =
      Boolean(input.gatewayLabel && input.gatewaySections?.length) &&
      (!needle ||
        input.gatewayLabel?.toLocaleLowerCase(input.locale).includes(needle) ||
        input.gatewaySections?.some((sec) =>
          sec.label.toLocaleLowerCase(input.locale).includes(needle)
        ))
    const showGateway = group.id === input.harnessGroupId && gatewayMatches
    const showHarnesses = group.id === input.harnessGroupId && (harnessMatches || agents.length > 0)
    if (!items.length && !showHarnesses && !showGateway) continue
    rows.push({ id: `group:${group.id}`, kind: "group", label: group.label })
    rows.push(
      ...items.map((item) => ({
        ...item,
        id: `item:${item.href}`,
        kind: "item" as const,
      }))
    )
    if (showHarnesses) {
      rows.push({ id: "agent-harnesses", kind: "harness", label: input.harnessLabel })
      if (input.harnessesExpanded || needle) {
        rows.push(
          ...agents.map((agent) => ({ agent, id: `agent:${agent.id}`, kind: "agent" as const }))
        )
      }
    }
    if (showGateway && input.gatewayLabel && input.gatewaySections) {
      const isGatewayHeaderMatch =
        !needle || input.gatewayLabel.toLocaleLowerCase(input.locale).includes(needle)
      const sections = input.gatewaySections.filter(
        (sec) =>
          !needle ||
          isGatewayHeaderMatch ||
          sec.label.toLocaleLowerCase(input.locale).includes(needle)
      )
      rows.push({ id: "gateway", kind: "gateway", label: input.gatewayLabel })
      if (input.gatewayExpanded !== false || needle) {
        rows.push(
          ...sections.map((sec) => ({
            href: sec.href,
            id: `gateway:${sec.id}`,
            kind: "gateway-section" as const,
            label: sec.label,
            sectionId: sec.id,
          }))
        )
      }
    }
  }
  if (rows.length === 1 && needle)
    rows.push({ id: "empty", kind: "empty", label: input.emptyLabel })
  return rows
}
