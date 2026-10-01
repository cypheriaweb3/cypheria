import { describe, expect, it } from "vitest"

import { buildSettingsNavigationRows } from "./settings-navigation-model"

const groups = [
  {
    id: "personal",
    items: [{ href: "/settings/general", icon: "settings", label: "General" }],
    label: "Personal",
  },
  {
    id: "integrations",
    items: [{ href: "/settings/plugins", icon: "plugin", label: "Plugins" }],
    label: "Integrations",
  },
]
const agents = [
  { id: "zeta", name: "Zeta" },
  { id: "opencode", name: "OpenCode" },
  { id: "pi", name: "Pi" },
  { id: "codex", name: "Codex" },
  { id: "claude", name: "Claude" },
  ...Array.from({ length: 500 }, (_, index) => ({
    id: `registry-${index}`,
    name: `Registry ${index.toString().padStart(3, "0")}`,
  })),
]

const build = (query = "", harnessesExpanded = true) =>
  buildSettingsNavigationRows({
    agents,
    emptyLabel: "No results",
    groups,
    harnessGroupId: "integrations",
    harnessLabel: "Agent harnesses",
    harnessesExpanded,
    locale: "en",
    query,
  })

describe("settings navigation row model", () => {
  it("flattens the entire navigation and keeps native agents first", () => {
    const rows = build()
    expect(rows[0]).toMatchObject({ kind: "back" })
    expect(
      rows
        .filter((row) => row.kind === "agent")
        .slice(0, 5)
        .map((row) => (row.kind === "agent" ? row.agent.id : ""))
    ).toEqual(["codex", "claude", "pi", "opencode", "registry-0"])
    expect(rows.filter((row) => row.kind === "agent")).toHaveLength(505)
  })

  it("collapses agent rows without creating a separate row container", () => {
    const rows = build("", false)
    expect(rows.some((row) => row.kind === "harness")).toBe(true)
    expect(rows.some((row) => row.kind === "agent")).toBe(false)
  })

  it("shows every harness supplied by the persisted registry", () => {
    const ids = build()
      .filter((row) => row.kind === "agent")
      .map((row) => (row.kind === "agent" ? row.agent.id : ""))
    expect(ids).toEqual(expect.arrayContaining(["codex", "claude", "pi", "opencode"]))
    expect(ids).toContain("zeta")
  })

  it("searches regular settings and agent names", () => {
    expect(
      build("general").some((row) => row.kind === "item" && row.href === "/settings/general")
    ).toBe(true)
    const registry = build("Registry 499", false).filter((row) => row.kind === "agent")
    expect(registry).toHaveLength(1)
    expect(registry[0]).toMatchObject({ agent: { id: "registry-499" } })
    expect(build("missing").at(-1)).toMatchObject({ kind: "empty" })
  })

  it("renders gateway header and sections directly under agent harnesses", () => {
    const rows = buildSettingsNavigationRows({
      agents,
      emptyLabel: "No results",
      gatewayExpanded: true,
      gatewayLabel: "Gateway",
      gatewaySections: [
        { href: "/settings/gateway/general", id: "general", label: "General" },
        { href: "/settings/gateway/providers", id: "providers", label: "Providers" },
        { href: "/settings/gateway/routing", id: "routing", label: "Routing" },
        { href: "/settings/gateway/usage", id: "usage", label: "Usage" },
      ],
      groups,
      harnessGroupId: "integrations",
      harnessLabel: "Agent harnesses",
      harnessesExpanded: false,
      locale: "en",
      query: "",
    })

    const harnessIndex = rows.findIndex((row) => row.kind === "harness")
    const gatewayIndex = rows.findIndex((row) => row.kind === "gateway")
    expect(harnessIndex).toBeGreaterThan(-1)
    expect(gatewayIndex).toBe(harnessIndex + 1)

    const gatewaySections = rows.filter((row) => row.kind === "gateway-section")
    expect(gatewaySections).toHaveLength(4)
    expect(
      gatewaySections.map((row) => (row.kind === "gateway-section" ? row.sectionId : ""))
    ).toEqual(["general", "providers", "routing", "usage"])
  })
})
