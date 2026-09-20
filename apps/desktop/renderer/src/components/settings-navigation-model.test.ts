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

  it("searches regular settings and agent names", () => {
    expect(
      build("general").some((row) => row.kind === "item" && row.href === "/settings/general")
    ).toBe(true)
    const registry = build("Registry 499", false).filter((row) => row.kind === "agent")
    expect(registry).toHaveLength(1)
    expect(registry[0]).toMatchObject({ agent: { id: "registry-499" } })
    expect(build("missing").at(-1)).toMatchObject({ kind: "empty" })
  })
})
