import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { IntegrationService } from "../integration-service.js"
import { ComposerReferenceService } from "./composer-reference-service.js"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const integrations = {
  listComposerApps: async () => ({ apps: [] }),
  listComposerPlugins: async () => ({ marketplaces: [] }),
  listComposerResources: async () => [],
  listComposerSkills: async () => ({
    skills: [
      {
        description: "Review code",
        displayName: "Review",
        enabled: true,
        name: "review",
        path: "/skills/review/SKILL.md",
      },
    ],
  }),
} as unknown as IntegrationService

describe("ComposerReferenceService", () => {
  it("returns only workspace files and validates the canonical path on submit", async () => {
    const root = await mkdtemp(join(tmpdir(), "cypheria-composer-ref-"))
    const outside = await mkdtemp(join(tmpdir(), "cypheria-composer-outside-"))
    directories.push(root, outside)
    await mkdir(join(root, "src"))
    await writeFile(join(root, "src", "agent.ts"), "export const ok = true")
    await writeFile(join(outside, "secret.ts"), "private")
    await symlink(join(outside, "secret.ts"), join(root, "src", "secret.ts"))
    const service = new ComposerReferenceService({ integrations })
    const context = { agentId: "codex", cwd: root, threadId: "thread-1", workspaceRoots: [root] }
    const suggestions = await service.suggest(context, "@", "agent")
    expect(suggestions.some((item) => item.id === join(root, "src", "agent.ts"))).toBe(true)
    await expect(
      service.resolve(
        {
          id: join(root, "src", "secret.ts"),
          kind: "workspace-file",
          label: "secret.ts",
          type: "reference",
        },
        context
      )
    ).rejects.toThrow("outside the workspace")
  })

  it("revalidates a selected skill instead of trusting its label", async () => {
    const service = new ComposerReferenceService({ integrations })
    const context = { agentId: "codex", cwd: null, threadId: "thread-1" }
    expect(
      await service.resolve(
        { id: "/skills/review/SKILL.md", kind: "skill", label: "Spoofed", type: "reference" },
        context
      )
    ).toEqual({ text: "[$review](/skills/review/SKILL.md)", type: "text" })
    await expect(
      service.resolve(
        { id: "/skills/missing/SKILL.md", kind: "skill", label: "Review", type: "reference" },
        context
      )
    ).rejects.toThrow("no longer available")
  })
})
