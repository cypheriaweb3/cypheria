import { readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { BrowserTabInfo, ThreadInputBlock } from "@cypheria/protocol"
import type { IntegrationService } from "../integration-service.js"

type Reference = Extract<ThreadInputBlock, { type: "reference" }>
type Suggestion = Reference & { description: string | null }
type ReferenceContext = {
  agentId: string
  cwd: string | null
  threadId: string
  workspaceRoots?: readonly string[]
}
/** Plugin mention providers, from the OpenAI MCP Extensions `mentions/search` tools. */
export type ExtensionMentions = {
  providers(): Promise<ReadonlyMap<string, string>>
  search(query: string): Promise<
    {
      items: { description: string | null; name: string; title: string | null; uri: string }[]
      providerId: string
    }[]
  >
  resolve(input: {
    label: string
    providerId: string
    threadId: string | null
    uri: string
  }): Promise<ThreadInputBlock>
}
type ComposerReferenceOptions = {
  integrations: IntegrationService
  mentions?: ExtensionMentions
  listBrowserTabs?: (threadId: string) => Promise<BrowserTabInfo[]>
  listThreads?: () => Promise<Array<{ id: string; title: string | null }>>
  getThread?: (threadId: string) => Promise<{ id: string; title: string | null }>
}
const ignored = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo"])
const markdown = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
const matches = (query: string, ...values: string[]) =>
  values.some((value) => value.toLowerCase().includes(query.toLowerCase()))

export class ComposerReferenceService {
  readonly #integrations: IntegrationService
  readonly #listBrowserTabs: ComposerReferenceOptions["listBrowserTabs"]
  readonly #listThreads: ComposerReferenceOptions["listThreads"]
  readonly #getThread: ComposerReferenceOptions["getThread"]
  readonly #mentions: ExtensionMentions | undefined

  constructor(options: ComposerReferenceOptions) {
    this.#integrations = options.integrations
    this.#listBrowserTabs = options.listBrowserTabs
    this.#listThreads = options.listThreads
    this.#getThread = options.getThread
    this.#mentions = options.mentions
  }

  async suggest(
    context: ReferenceContext,
    trigger: "@" | "$",
    query: string
  ): Promise<Suggestion[]> {
    const items: Suggestion[] = []
    const cwd = context.cwd ?? undefined
    if (trigger === "@") {
      if (query.trim()) {
        for (const path of await this.#files(context.workspaceRoots ?? (cwd ? [cwd] : []), query)) {
          items.push({
            description: path,
            id: path,
            kind: "workspace-file",
            label: path.split(/[\\/]/u).at(-1) ?? path,
            type: "reference",
          })
        }
      }
      if (this.#listThreads) {
        for (const thread of await this.#listThreads()) {
          if (!matches(query, thread.title ?? "", thread.id)) continue
          items.push({
            description: thread.id,
            id: thread.id,
            kind: "thread",
            label: thread.title ?? thread.id,
            type: "reference",
          })
        }
      }
      if (context.threadId && this.#listBrowserTabs) {
        for (const tab of await this.#listBrowserTabs(context.threadId).catch(() => [])) {
          if (tab.threadId !== context.threadId || !matches(query, tab.title, tab.url)) continue
          items.push({
            description: tab.url,
            id: tab.browserId,
            kind: "browser-tab",
            label: tab.title || tab.url,
            type: "reference",
          })
        }
      }
      if (this.#mentions && query.trim()) {
        const [titles, groups] = await Promise.all([
          this.#mentions.providers().catch(() => new Map<string, string>()),
          this.#mentions.search(query).catch(() => []),
        ])
        for (const group of groups) {
          for (const item of group.items) {
            items.push({
              description: item.description ?? titles.get(group.providerId) ?? null,
              id: JSON.stringify(["mention", group.providerId, item.uri]),
              kind: "mcp-resource",
              label: item.title ?? item.name,
              type: "reference",
            })
          }
        }
      }
      if (context.agentId === "codex") {
        const plugins = await this.#integrations.listComposerPlugins(cwd).catch(() => null)
        for (const plugin of plugins?.marketplaces.flatMap((entry) => entry.plugins) ?? []) {
          if (
            !plugin.installed ||
            !plugin.enabled ||
            !matches(query, plugin.displayName, plugin.name)
          )
            continue
          items.push({
            description: plugin.description,
            id: plugin.id,
            kind: "plugin",
            label: plugin.displayName,
            type: "reference",
          })
        }
        const resources = await this.#integrations.listComposerResources().catch(() => [])
        for (const resource of resources) {
          if (!matches(query, resource.title, resource.uri)) continue
          items.push({
            description: resource.description,
            id: JSON.stringify([resource.server, resource.uri]),
            kind: "mcp-resource",
            label: resource.title,
            type: "reference",
          })
        }
      }
    } else if (context.agentId === "codex") {
      const [skills, apps] = await Promise.all([
        this.#integrations.listComposerSkills(cwd).catch(() => null),
        this.#integrations.listComposerApps().catch(() => null),
      ])
      for (const skill of skills?.skills ?? []) {
        if (!skill.enabled || !matches(query, skill.displayName, skill.name, skill.description))
          continue
        items.push({
          description: skill.description,
          id: skill.path,
          kind: "skill",
          label: skill.displayName,
          type: "reference",
        })
      }
      for (const app of apps?.apps ?? []) {
        if (!app.accessible || !app.enabled || !matches(query, app.name, app.description ?? ""))
          continue
        items.push({
          description: app.description,
          id: app.id,
          kind: "app",
          label: app.name,
          type: "reference",
        })
      }
    }
    return items.slice(0, 100)
  }

  async resolve(block: Reference, context: ReferenceContext): Promise<ThreadInputBlock> {
    if (block.kind === "workspace-file") {
      const path = await this.#verifiedWorkspacePath(
        block.id,
        context.workspaceRoots ?? (context.cwd ? [context.cwd] : [])
      )
      return { text: `[${markdown(block.label)}](${markdown(path)})`, type: "text" }
    }
    if (block.kind === "thread") {
      if (!this.#getThread) throw new Error("Thread references are unavailable")
      const thread = await this.#getThread(block.id)
      return {
        text: `Referenced Cypheria chat: ${thread.title ?? thread.id} (threadId: ${thread.id}). Use read_thread to inspect it before relying on its contents.`,
        type: "text",
      }
    }
    if (block.kind === "browser-tab") {
      if (!context.threadId || !this.#listBrowserTabs)
        throw new Error("Browser tab references are unavailable")
      const tab = (await this.#listBrowserTabs(context.threadId)).find(
        (item) => item.browserId === block.id && item.threadId === context.threadId
      )
      if (!tab) throw new Error("Browser tab is no longer available")
      const mention = new URL("plugin://browser@cypheria-bundled")
      mention.search = new URLSearchParams({
        mention: "tab-v1",
        tabId: tab.browserId,
        title: tab.title,
        url: tab.url,
      }).toString()
      return {
        text: `Built-in browser tab "${tab.title}" (${tab.url}): ${mention.href} — open it in cua_repl with cua.iab.getTab({ mention }) to read its current contents.`,
        type: "text",
      }
    }
    if (context.agentId !== "codex")
      throw new Error(`${block.kind} references are unavailable for ${context.agentId}`)
    if (block.kind === "skill") {
      const skills = await this.#integrations.listComposerSkills(context.cwd ?? undefined)
      const skill = skills.skills.find((item) => item.path === block.id && item.enabled)
      if (!skill) throw new Error("Skill is no longer available")
      return { text: `[$${markdown(skill.name)}](${markdown(skill.path)})`, type: "text" }
    }
    if (block.kind === "app") {
      const apps = await this.#integrations.listComposerApps()
      const app = apps.apps.find((item) => item.id === block.id && item.accessible && item.enabled)
      if (!app) throw new Error("App is no longer available")
      return { text: `[$${markdown(app.name)}](app://${markdown(app.id)})`, type: "text" }
    }
    if (block.kind === "plugin") {
      const plugins = await this.#integrations.listComposerPlugins(context.cwd ?? undefined)
      const plugin = plugins.marketplaces
        .flatMap((entry) => entry.plugins)
        .find((item) => item.id === block.id && item.installed && item.enabled)
      if (!plugin) throw new Error("Plugin is no longer available")
      return {
        text: `[@${markdown(plugin.displayName)}](plugin://${markdown(plugin.id)})`,
        type: "text",
      }
    }
    if (block.kind === "mcp-resource") {
      const value = JSON.parse(block.id) as unknown
      if (
        this.#mentions &&
        Array.isArray(value) &&
        value.length === 3 &&
        value[0] === "mention" &&
        typeof value[1] === "string" &&
        typeof value[2] === "string"
      ) {
        return this.#mentions.resolve({
          label: block.label,
          providerId: value[1],
          threadId: context.threadId || null,
          uri: value[2],
        })
      }
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        typeof value[0] !== "string" ||
        typeof value[1] !== "string"
      )
        throw new Error("Invalid MCP resource reference")
      const resource = (await this.#integrations.listComposerResources()).find(
        (item) => item.server === value[0] && item.uri === value[1]
      )
      if (!resource) throw new Error("MCP resource is no longer available")
      return {
        text: `[${markdown(resource.title)}](${markdown(resource.uri)}) (MCP server: ${resource.server})`,
        type: "text",
      }
    }
    throw new Error(`${block.kind} references are not supported yet`)
  }

  async #verifiedWorkspacePath(path: string, roots: readonly string[]): Promise<string> {
    if (!isAbsolute(path) || roots.length === 0)
      throw new Error("Reference is outside the workspace")
    const actual = await realpath(path)
    for (const root of roots) {
      const canonicalRoot = await realpath(root).catch(() => null)
      if (!canonicalRoot) continue
      const within = relative(canonicalRoot, actual)
      if (
        within === "" ||
        (within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within))
      ) {
        await stat(actual)
        return actual
      }
    }
    throw new Error("Reference is outside the workspace")
  }

  async #files(roots: readonly string[], query: string): Promise<string[]> {
    const found: string[] = []
    const queue = roots.map((root) => ({ path: resolve(root), depth: 0 }))
    let visited = 0
    while (queue.length && visited < 10_000 && found.length < 50) {
      const current = queue.shift()
      if (!current) break
      const entries = await readdir(current.path, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (++visited > 10_000) break
        if (ignored.has(entry.name) || entry.isSymbolicLink()) continue
        const path = join(current.path, entry.name)
        if (matches(query, entry.name, path)) found.push(path)
        if (entry.isDirectory() && current.depth < 6) queue.push({ path, depth: current.depth + 1 })
        if (found.length >= 50) break
      }
    }
    return found
  }
}
