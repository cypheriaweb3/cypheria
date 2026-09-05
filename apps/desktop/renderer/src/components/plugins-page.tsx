import { Button } from "@cypheria/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cypheria/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Input } from "@cypheria/ui/components/input"
import { Switch } from "@cypheria/ui/components/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@cypheria/ui/components/tooltip"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import {
  ArrowRight,
  Blocks,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { z } from "zod"
import type {
  CodexPluginDetailView,
  CodexPluginView,
  CodexSkillView,
} from "../../../ipc/src/index.js"
import promptWallpaper from "../assets/plugins/prompt-wallpaper.webp"
import { githubPreviewDetail, pluginDemo, skillDemo } from "../components/plugin-preview"
import {
  AddMcpDialog,
  AppConnection,
  IntegrationAppRow,
  McpServerRow,
  usePluginIntegrations,
} from "./plugin-integrations"

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request could not be completed."
const locator = (plugin: CodexPluginView) => ({
  marketplaceName: plugin.marketplaceName,
  marketplacePath: plugin.marketplacePath,
  pluginName: plugin.name,
})
const unavailable = (plugin: CodexPluginView) =>
  plugin.availability !== "AVAILABLE" || plugin.installPolicy === "NOT_AVAILABLE"
const pill =
  "shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground transition-colors"

function Icon({
  src,
  name,
  large = false,
  skill = false,
}: {
  src: string | null
  name: string
  large?: boolean
  skill?: boolean
}) {
  const [failed, setFailed] = useState(false)
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl ${large ? "size-14" : "size-10"} ${skill ? "bg-muted" : "border border-border/70 bg-background"}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : skill ? (
        <Sparkles aria-hidden className="size-5 text-muted-foreground" />
      ) : (
        <Blocks aria-label={name} className="size-5 text-muted-foreground" />
      )}
    </span>
  )
}

function IconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button aria-label={label} size="icon-sm" variant="ghost" {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex min-h-9 items-center justify-between border-b border-border/50 pb-3">
        <h2 className="text-base font-medium">
          {title}
          {count !== undefined && (
            <span className="ml-2 font-normal text-muted-foreground">{count}</span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PluginManagementPage() {
  return <PluginsRoute management />
}

export function PluginsRoute({ management = false }: { management?: boolean }) {
  const search = z
    .object({
      view: z.enum(["plugins", "skills", "manage"]).optional(),
      plugin: z.string().optional(),
    })
    .parse(useSearch({ strict: false }))
  const view = management ? "manage" : (search.view ?? "plugins")
  const pluginId = search.plugin
  const integrations = usePluginIntegrations(view === "manage" || !!pluginId)
  const navigate = useNavigate()
  const cache = useQueryClient()
  const preview = !window.cypheria
  const [previewPlugins, setPreviewPlugins] = useState(pluginDemo)
  const [previewSkills, setPreviewSkills] = useState(skillDemo)
  const [query, setQuery] = useState("")
  const [source, setSource] = useState("public")
  const [scope, setScope] = useState("all")
  const [manageTab, setManageTab] = useState("plugins")
  const [expanded, setExpanded] = useState<string[]>([])
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [removeMarketName, setRemoveMarketName] = useState<string | null>(null)
  const [removeMarketOpen, setRemoveMarketOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [marketplaceSource, setMarketplaceSource] = useState("")
  const [marketplaceRef, setMarketplaceRef] = useState("")
  const [selectedSkill, setSelectedSkill] = useState<CodexSkillView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const pluginsQuery = useQuery({
    queryKey: ["codex", "plugins"],
    queryFn: () => window.cypheria?.codex.listPlugins() ?? pluginDemo,
  })
  const skillsQuery = useQuery({
    queryKey: ["codex", "skills"],
    queryFn: () => window.cypheria?.codex.listSkills() ?? skillDemo,
  })
  const data = preview ? previewPlugins : pluginsQuery.data
  const skills = (preview ? previewSkills : skillsQuery.data)?.skills ?? []
  const plugins = data?.marketplaces.flatMap((m) => m.plugins) ?? []
  const publicPlugins = plugins.filter((p) => p.sourceKinds?.includes("vertical"))
  const removalTarget = data?.marketplaces.find((m) => m.name === removeMarketName)
  const removalBlocked = !removalTarget?.path || removalTarget.plugins.some((p) => p.installed)
  const selected = plugins.find((p) => p.id === pluginId)
  const installed = plugins.filter((p) => p.installed)
  const detailQuery = useQuery({
    queryKey: ["codex", "plugin-detail", selected?.id],
    enabled: !!selected,
    queryFn: async (): Promise<CodexPluginDetailView> => {
      if (!selected) throw new Error("Plugin not found")
      if (window.cypheria) return window.cypheria.codex.readPlugin(locator(selected))
      if (selected.name === "github") return githubPreviewDetail
      return {
        description: selected.description,
        shareUrl: null,
        prompts: [],
        websiteUrl: null,
        privacyPolicyUrl: null,
        termsOfServiceUrl: null,
        apps: [],
        mcpServers: [],
        skills: [],
      }
    },
  })
  const detail = detailQuery.data
  const changeView = (next: "plugins" | "skills" | "manage", id?: string) => {
    if (next !== view) setQuery("")
    setNotice(null)
    setCopied(false)
    if (next === "manage") void navigate({ to: "/settings/plugins", search: {} })
    else void navigate({ to: "/plugins", search: { view: next, plugin: id } })
  }
  const tryPrompt = (prompt: string) => {
    void navigate({ to: "/", search: { prompt } })
  }
  const mutation = useMutation({
    mutationFn: async (action: {
      type: "install" | "uninstall" | "toggle"
      plugin: CodexPluginView
    }) => {
      const p = action.plugin
      if (!window.cypheria) {
        setPreviewPlugins((old) => ({
          ...old,
          marketplaces: old.marketplaces.map((m) => ({
            ...m,
            plugins: m.plugins.map((item) =>
              item.id !== p.id
                ? item
                : {
                    ...item,
                    installed: action.type !== "uninstall",
                    enabled: action.type === "toggle" ? !p.enabled : action.type === "install",
                  }
            ),
          })),
        }))
        return
      }
      if (action.type === "install") {
        const result = await window.cypheria.codex.installPlugin(locator(p))
        if (result.appsNeedingAuth.length)
          setNotice(
            `Installed. Connect ${result.appsNeedingAuth.join(", ")} to use all capabilities.`
          )
      } else if (action.type === "uninstall") await window.cypheria.codex.uninstallPlugin(p.id)
      else await window.cypheria.codex.setPluginEnabled(p.id, !p.enabled)
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["codex", "plugins"] }),
        cache.invalidateQueries({ queryKey: ["codex", "skills"] }),
        cache.invalidateQueries({ queryKey: ["codex", "plugin-detail"] }),
      ])
    },
  })
  const skillMutation = useMutation({
    mutationFn: async (skill: CodexSkillView) => {
      if (window.cypheria) await window.cypheria.codex.setSkillEnabled(skill.path, !skill.enabled)
      else
        setPreviewSkills((old) => ({
          ...old,
          skills: old.skills.map((s) =>
            s.path === skill.path ? { ...s, enabled: !s.enabled } : s
          ),
        }))
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["codex", "skills"] }),
  })
  const refresh = useMutation({
    mutationFn: async () => {
      if (!window.cypheria) return
      const [p, s] = await Promise.all([
        window.cypheria.codex.listPlugins({ forceRefetch: true }),
        window.cypheria.codex.listSkills({ forceReload: true }),
      ])
      cache.setQueryData(["codex", "plugins"], p)
      cache.setQueryData(["codex", "skills"], s)
      await integrations.refresh()
    },
  })
  const addMarket = useMutation({
    mutationFn: async () => {
      if (!window.cypheria) throw new Error("Open Cypheria Desktop to add a marketplace.")
      await window.cypheria.codex.addMarketplace({
        source: marketplaceSource.trim(),
        ...(marketplaceRef.trim() ? { refName: marketplaceRef.trim() } : {}),
      })
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["codex", "plugins"] })
      setMarketplaceOpen(false)
      setMarketplaceSource("")
      setMarketplaceRef("")
    },
  })
  const updateMarket = useMutation({
    mutationFn: async (name: string) => {
      if (!window.cypheria) throw new Error("Open Cypheria Desktop to update marketplace sources.")
      await window.cypheria.codex.upgradeMarketplaces(name)
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["codex", "plugins"] }),
  })
  const busy = mutation.isPending
  const removeMarket = useMutation({
    mutationFn: async (name: string) => {
      if (removalBlocked)
        throw new Error("Uninstall this marketplace’s plugins before removing its source.")
      if (window.cypheria) await window.cypheria.codex.removeMarketplace(name)
      else
        setPreviewPlugins((old) => ({
          ...old,
          marketplaces: old.marketplaces.filter((m) => m.name !== name),
        }))
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["codex", "plugins"] })
      setRemoveMarketOpen(false)
    },
  })
  const showMore = (key: string) =>
    setExpanded((old) => (old.includes(key) ? old.filter((x) => x !== key) : [...old, key]))
  const matching = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase())
  const filteredPlugins = plugins.filter((p) =>
    matching(`${p.displayName} ${p.description ?? ""} ${p.category ?? ""}`)
  )
  const filteredSkills = skills.filter((s) => matching(`${s.displayName} ${s.description}`))
  const skillSourceLabel = (skill: CodexSkillView) => {
    if (skill.scope === "user") return "Personal"
    if (skill.scope === "system") return "System"
    if (skill.scope === "admin") return "Admin installed"
    const parts = skill.cwd
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
    return parts.at(-1) ?? "Project"
  }
  const repoSkillSources = [
    ...new Set(
      skills.filter((skill) => skill.scope === "repo").map((skill) => skillSourceLabel(skill))
    ),
  ].sort((left, right) => left.localeCompare(right))
  const skillSources = [
    ...(skills.some((skill) => skill.scope === "user") ? ["Personal"] : []),
    ...repoSkillSources,
    ...(skills.some((skill) => skill.scope === "system") ? ["System"] : []),
    ...(skills.some((skill) => skill.scope === "admin") ? ["Admin installed"] : []),
  ]
  const activeSkillSource = skillSources.includes(scope) ? scope : (skillSources[0] ?? null)
  const error =
    integrations.error ??
    mutation.error ??
    skillMutation.error ??
    refresh.error ??
    updateMarket.error ??
    (view === "skills" ? skillsQuery.error : pluginsQuery.error)

  function PluginMenu({ plugin: p }: { plugin: CodexPluginView }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${p.displayName}`}
              size="icon-sm"
              variant="ghost"
              className="rounded-lg"
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36 rounded-2xl p-1.5">
          <DropdownMenuItem onClick={() => tryPrompt(`Use the ${p.displayName} plugin to `)}>
            <Sparkles />
            Try now
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setManageTab("plugins")
              changeView("manage")
              setQuery(p.displayName)
            }}
          >
            <Settings />
            Manage
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={busy || p.installPolicy === "INSTALLED_BY_DEFAULT"}
            onClick={() => mutation.mutate({ type: "uninstall", plugin: p })}
          >
            <Trash2 />
            Uninstall
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  function PluginRow({ plugin: p, manage = false }: { plugin: CodexPluginView; manage?: boolean }) {
    return (
      <div className="group flex min-w-0 items-center gap-2 rounded-2xl px-2 py-2 transition-colors hover:bg-muted/70 focus-within:bg-muted/70">
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left outline-offset-4 ${unavailable(p) ? "opacity-50" : ""}`}
          onClick={() => changeView("plugins", p.id)}
        >
          <Icon src={p.logoUrl} name={p.displayName} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{p.displayName}</span>
            <span className="mt-1 block truncate text-sm text-muted-foreground">
              {p.description}
            </span>
          </span>
        </button>
        {manage ? (
          <Switch
            aria-label={`Enable ${p.displayName}`}
            checked={p.enabled}
            disabled={busy || unavailable(p)}
            onCheckedChange={() => mutation.mutate({ type: "toggle", plugin: p })}
          />
        ) : unavailable(p) ? (
          <IconButton label="Managed by your administrator" disabled>
            <Users className="size-4" />
          </IconButton>
        ) : p.installed ? (
          <PluginMenu plugin={p} />
        ) : (
          <IconButton
            label={`Install ${p.displayName}`}
            disabled={busy}
            onClick={() => mutation.mutate({ type: "install", plugin: p })}
          >
            <Plus className="size-5" />
          </IconButton>
        )}
      </div>
    )
  }
  function SkillRow({ skill, manage = false }: { skill: CodexSkillView; manage?: boolean }) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-2xl px-2 py-2 hover:bg-muted/70 focus-within:bg-muted/70">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
          onClick={() => setSelectedSkill(skill)}
        >
          <Icon src={skill.iconUrl} name={skill.displayName} skill />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{skill.displayName}</span>
            <span className="mt-1 block truncate text-sm text-muted-foreground">
              {skill.description}
            </span>
          </span>
        </button>
        {manage ? (
          <Switch
            aria-label={`Enable ${skill.displayName}`}
            checked={skill.enabled}
            disabled={skillMutation.isPending || skill.scope === "admin"}
            onCheckedChange={() => skillMutation.mutate(skill)}
          />
        ) : (
          <IconButton
            label={skill.enabled ? "Enabled — manage skill" : "Enable skill"}
            disabled={skillMutation.isPending || skill.scope === "admin"}
            onClick={() => (skill.enabled ? setSelectedSkill(skill) : skillMutation.mutate(skill))}
          >
            {skill.enabled ? (
              <Check className="size-4 text-muted-foreground/60" />
            ) : (
              <Plus className="size-4" />
            )}
          </IconButton>
        )}
      </div>
    )
  }
  function PluginGroup({ title, items }: { title: string; items: CodexPluginView[] }) {
    const open = expanded.includes(title)
    return items.length ? (
      <Section title={title}>
        <div className="grid gap-x-7 gap-y-1 sm:grid-cols-2">
          {(open ? items : items.slice(0, 6)).map((p) => (
            <PluginRow key={p.id} plugin={p} />
          ))}
        </div>
        {items.length > 6 && (
          <button
            type="button"
            onClick={() => showMore(title)}
            className="mt-5 flex items-center gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {!open && (
              <span className="flex -space-x-2">
                {items.slice(6, 9).map((p) => (
                  <span key={p.id} className="scale-75">
                    <Icon src={p.logoUrl} name={p.displayName} />
                  </span>
                ))}
              </span>
            )}
            {open
              ? "Show less"
              : `See ${items
                  .slice(6, 8)
                  .map((p) => p.displayName)
                  .join(", ")} and ${items.length - 6} more`}
          </button>
        )}
      </Section>
    ) : null
  }
  function SkillGroup({ title, items }: { title: string; items: CodexSkillView[] }) {
    const open = expanded.includes(title)
    return (
      <Section title={title}>
        <div className="grid gap-x-7 gap-y-1 sm:grid-cols-2">
          {(open ? items : items.slice(0, 6)).map((s) => (
            <SkillRow key={s.path} skill={s} />
          ))}
        </div>
        {items.length > 6 && (
          <button
            type="button"
            onClick={() => showMore(title)}
            className="mt-6 px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {open
              ? "Show less"
              : `See ${items
                  .slice(6, 8)
                  .map((s) => s.displayName)
                  .join(", ")} and ${items.length - 6} more`}
          </button>
        )}
      </Section>
    )
  }
  const AddMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            className="rounded-xl bg-foreground text-background hover:bg-foreground/85"
          />
        }
      >
        Add
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40 rounded-2xl p-1.5">
        <DropdownMenuItem
          onClick={() =>
            tryPrompt(
              view === "skills"
                ? "Help me create a reusable Codex skill. Ask what workflow I want to capture, then use skill-creator to create it in my personal skills directory."
                : "Help me create a Codex plugin. Ask which capabilities it should bundle, then use plugin-creator to scaffold it in my project."
            )
          }
        >
          <Blocks />
          Create {view === "skills" ? "skill" : "plugin"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMarketplaceOpen(true)}>
          <Plus />
          Add marketplace
        </DropdownMenuItem>
        {view === "manage" && (
          <DropdownMenuItem onClick={() => setMcpOpen(true)}>
            <Plus />
            Add MCP server
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background [&_[data-slot=switch][data-checked]]:bg-violet-400">
      <AddMcpDialog
        open={mcpOpen}
        onOpenChange={(open) => {
          setMcpOpen(open)
        }}
        onAdded={() => {
          setMcpOpen(false)
          setManageTab("mcp")
          setQuery("")
        }}
        integrations={integrations}
      />
      <header className="desktop-titlebar flex h-11 shrink-0 items-center justify-between gap-3 px-4">
        {selected ? (
          <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-sm">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => changeView("plugins")}
            >
              Plugins
            </button>
            <ChevronRight className="size-4 text-muted-foreground" />
            <span>{selected.displayName}</span>
          </nav>
        ) : view === "manage" ? (
          <div />
        ) : (
          <nav aria-label="Directory type" className="flex gap-1">
            {(["plugins", "skills"] as const).map((v) => (
              <button
                type="button"
                key={v}
                aria-pressed={view === v}
                className={pill}
                onClick={() => changeView(v)}
              >
                {v === "plugins" ? "Plugins" : "Skills"}
              </button>
            ))}
          </nav>
        )}
        {preview && (
          <span className="ml-auto text-xs text-muted-foreground">Preview · sample catalog</span>
        )}
        {!selected && view !== "manage" && (
          <div className="flex items-center gap-2">
            <IconButton
              label="Refresh"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCw className={`size-4 ${refresh.isPending ? "animate-spin" : ""}`} />
            </IconButton>
            <IconButton label="Manage plugins and skills" onClick={() => changeView("manage")}>
              <Settings className="size-4" />
            </IconButton>
            {AddMenu}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <main
          className={`mx-auto w-full px-6 pb-20 pt-7 ${view === "manage" ? "max-w-[816px]" : "max-w-[768px]"}`}
        >
          {(error || notice || integrations.notice) && (
            <div role={error ? "alert" : "status"} className="mb-5 rounded-xl border p-3 text-sm">
              {error ? errorText(error) : (notice ?? integrations.notice)}
            </div>
          )}
          {selected ? (
            <>
              {selected.logoUrl && (
                <div className="mb-5">
                  <Icon src={selected.logoUrl} name={selected.displayName} large />
                </div>
              )}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-[22px] font-medium">{selected.displayName}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {selected.installed && <PluginMenu plugin={selected} />}
                  {detail?.shareUrl && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(detail.shareUrl ?? "")
                          setCopied(true)
                        } catch (e) {
                          setNotice(errorText(e))
                        }
                      }}
                    >
                      <Link2 className="size-4" />
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="bg-foreground text-background hover:bg-foreground/85"
                    disabled={busy || unavailable(selected)}
                    onClick={() =>
                      selected.installed
                        ? tryPrompt(`Use the ${selected.displayName} plugin to `)
                        : mutation.mutate({ type: "install", plugin: selected })
                    }
                  >
                    {selected.installed ? (
                      <Sparkles className="size-4" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    {selected.installed ? "Try now" : busy ? "Installing…" : "Install plugin"}
                  </Button>
                </div>
              </div>
              {detailQuery.isPending && (
                <p className="mt-8 text-sm text-muted-foreground">Loading plugin details…</p>
              )}
              {detailQuery.error && (
                <p role="alert" className="mt-8 text-sm text-destructive">
                  {errorText(detailQuery.error)}
                </p>
              )}
              {!!detail?.prompts.length && (
                <div
                  className="mt-7 grid gap-4 rounded-2xl bg-muted bg-cover bg-center p-7 sm:px-20"
                  style={{
                    backgroundImage: `linear-gradient(#ffffffa6, #ffffffa6), url(${promptWallpaper})`,
                  }}
                >
                  {detail.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={!selected.installed}
                      onClick={() => tryPrompt(`Use the ${selected.displayName} plugin. ${prompt}`)}
                      className="flex items-center gap-3 rounded-2xl bg-background/80 p-3 text-left text-sm disabled:opacity-65"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="mr-2 font-medium">{selected.displayName}</span>
                        {prompt}
                      </span>
                      <ArrowRight className="size-7 shrink-0 rounded-full bg-muted p-1.5" />
                    </button>
                  ))}
                </div>
              )}
              {detail?.description && (
                <p className="mt-7 text-sm leading-6 text-muted-foreground">{detail.description}</p>
              )}
              {!!detail?.apps.length && (
                <Section title="Apps" count={detail.apps.length}>
                  {Array.from(new Set(detail.apps.map((a) => a.category))).map((category) => (
                    <div key={category ?? "apps"}>
                      {category && (
                        <p className="mb-2 mt-5 text-sm text-muted-foreground">{category}</p>
                      )}
                      {detail.apps
                        .filter((a) => a.category === category)
                        .map((app) => {
                          const linkedApp = integrations.apps.find((entry) => entry.id === app.id)
                          return (
                            <div key={app.id} className="flex items-center gap-3 py-3">
                              <Icon src={linkedApp?.logoUrl ?? null} name={app.name} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm">{app.name}</p>
                                <p className="mt-1 truncate text-sm text-muted-foreground">
                                  {app.description}
                                </p>
                              </div>
                              {linkedApp ? (
                                <AppConnection app={linkedApp} integrations={integrations} />
                              ) : app.installUrl ? (
                                <a
                                  href={app.installUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs"
                                >
                                  Connect
                                  <ExternalLink className="size-3" />
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {integrations.appsQuery.isPending
                                    ? "Checking…"
                                    : "Availability unknown"}
                                </span>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  ))}
                </Section>
              )}
              {!!detail?.mcpServers.length && (
                <Section title="MCP servers" count={detail.mcpServers.length}>
                  {detail.mcpServers.map((server) => {
                    const linkedServer = integrations.servers.find((entry) => entry.name === server)
                    return linkedServer ? (
                      <McpServerRow
                        key={server}
                        server={linkedServer}
                        integrations={integrations}
                        compact
                      />
                    ) : (
                      <div key={server} className="flex items-center gap-3 px-2 py-4 text-sm">
                        <Blocks className="size-5 text-muted-foreground" />
                        {server}
                      </div>
                    )
                  })}
                </Section>
              )}
              {!!detail?.skills.length && (
                <Section title="Skills" count={detail.skills.length}>
                  <div className="grid gap-x-7 gap-y-1 sm:grid-cols-2">
                    {detail.skills.map((s) => (
                      <div key={s.name} className="flex items-center gap-3 px-2 py-3">
                        <Icon src={null} name={s.name} skill />
                        <div className="min-w-0">
                          <p className="truncate text-sm">{s.name}</p>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {s.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
              <Section title="Information">
                <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
                  {[
                    ["Capabilities", selected.capabilities.join(", ")],
                    ["Developer", selected.developerName],
                    ["Category", selected.category],
                    ["Version", selected.version],
                  ]
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <Info key={label} label={label ?? ""}>
                        {value}
                      </Info>
                    ))}
                  {[
                    ["Website", detail?.websiteUrl],
                    ["Privacy policy", detail?.privacyPolicyUrl],
                    ["Terms of service", detail?.termsOfServiceUrl],
                  ]
                    .filter(([, url]) => url)
                    .map(([label, url]) => (
                      <Info key={label} label={label ?? ""}>
                        <a
                          aria-label={label ?? undefined}
                          href={url ?? ""}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Info>
                    ))}
                </dl>
              </Section>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-[28px] font-medium leading-9">
                    {view === "skills" ? "Skills" : "Plugins"}
                  </h1>
                  <p className="mt-2 text-base text-muted-foreground">
                    {view === "manage"
                      ? "Manage plugins, apps, MCP and skills"
                      : view === "skills"
                        ? "Extend Cypheria with task-specific skills"
                        : "Use Cypheria with your favorite tools"}
                  </p>
                </div>
                {view === "manage" && (
                  <div className="flex shrink-0 items-center gap-2">
                    <IconButton
                      label="Refresh"
                      disabled={refresh.isPending}
                      onClick={() => refresh.mutate()}
                    >
                      <RefreshCw className={`size-4 ${refresh.isPending ? "animate-spin" : ""}`} />
                    </IconButton>
                    <Button size="sm" variant="outline" onClick={() => changeView("plugins")}>
                      Browse directory
                    </Button>
                    {AddMenu}
                  </div>
                )}
              </div>
              <div
                className={`relative mt-6 ${view === "manage" ? "sm:float-right sm:mt-7 sm:w-52" : ""}`}
              >
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label={`Search ${view === "manage" ? manageTab : view === "skills" ? "skills" : "plugins"}`}
                  placeholder={`Search ${view === "manage" ? manageTab : view === "skills" ? "skills" : "plugins"}`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 rounded-full pl-10 pr-10 shadow-none"
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setQuery("")}
                  >
                    <CircleX className="size-4" />
                  </button>
                )}
              </div>
              {!preview &&
              (view === "manage"
                ? manageTab === "plugins" || manageTab === "marketplaces"
                  ? pluginsQuery.isPending
                  : manageTab === "skills"
                    ? skillsQuery.isPending
                    : false
                : view === "skills"
                  ? skillsQuery.isPending
                  : pluginsQuery.isPending) ? (
                <div role="status" className="mt-10 text-sm text-muted-foreground">
                  Loading directory…
                </div>
              ) : view === "manage" ? (
                <>
                  <nav
                    aria-label="Management sections"
                    className="mt-7 flex min-h-9 gap-1 overflow-x-auto sm:mr-56"
                  >
                    {[
                      ["plugins", installed.length],
                      ["apps", integrations.apps.length],
                      ["mcp", integrations.servers.length],
                      ["skills", skills.length],
                      ["marketplaces", data?.marketplaces.length ?? 0],
                    ].map(([tab, count]) => (
                      <button
                        key={tab}
                        type="button"
                        aria-pressed={manageTab === tab}
                        className={pill}
                        onClick={() => {
                          setManageTab(String(tab))
                          setQuery("")
                        }}
                      >
                        <span className="capitalize">
                          {tab === "mcp" ? "MCP" : tab === "marketplaces" ? "Markets" : tab}
                        </span>{" "}
                        <span className="text-muted-foreground">{count}</span>
                      </button>
                    ))}
                  </nav>
                  <div className="clear-both mt-8 grid gap-2">
                    {(manageTab === "apps" || manageTab === "mcp") && (
                      <>
                        {(manageTab === "apps"
                          ? integrations.appsQuery.isPending
                          : integrations.mcpQuery.isPending) &&
                          !preview && (
                            <p role="status" className="py-6 text-sm text-muted-foreground">
                              Loading {manageTab}…
                            </p>
                          )}
                        {(manageTab === "apps"
                          ? integrations.appsQuery.error
                          : integrations.mcpQuery.error) && (
                          <div
                            role="alert"
                            className="flex items-center justify-between gap-3 py-4 text-sm text-destructive"
                          >
                            {errorText(
                              manageTab === "apps"
                                ? integrations.appsQuery.error
                                : integrations.mcpQuery.error
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void integrations.refresh()}
                            >
                              Retry
                            </Button>
                          </div>
                        )}
                        {manageTab === "apps" && integrations.appsQuery.data?.runtimeError && (
                          <p role="status" className="py-2 text-sm text-muted-foreground">
                            {integrations.appsQuery.data.runtimeError}
                          </p>
                        )}
                        {manageTab === "apps"
                          ? integrations.apps
                              .filter((app) => matching(`${app.name} ${app.description}`))
                              .map((app) => (
                                <IntegrationAppRow
                                  key={app.id}
                                  app={app}
                                  integrations={integrations}
                                />
                              ))
                          : integrations.servers
                              .filter((server) => matching(server.name))
                              .map((server) => (
                                <McpServerRow
                                  key={server.name}
                                  server={server}
                                  integrations={integrations}
                                />
                              ))}
                        {!(manageTab === "apps"
                          ? integrations.apps.filter((app) =>
                              matching(`${app.name} ${app.description}`)
                            ).length
                          : integrations.servers.filter((server) => matching(server.name))
                              .length) &&
                          (preview ||
                            (manageTab === "apps"
                              ? integrations.appsQuery.isSuccess
                              : integrations.mcpQuery.isSuccess)) && (
                            <p className="py-10 text-center text-sm text-muted-foreground">
                              {query
                                ? `No results for “${query}”.`
                                : `No ${manageTab === "apps" ? "apps available" : "MCP servers configured"}.`}
                            </p>
                          )}
                      </>
                    )}
                    {manageTab === "plugins"
                      ? filteredPlugins
                          .filter((p) => p.installed)
                          .map((p) => <PluginRow key={p.id} plugin={p} manage />)
                      : manageTab === "skills"
                        ? filteredSkills.map((s) => <SkillRow key={s.path} skill={s} manage />)
                        : manageTab === "marketplaces"
                          ? data?.marketplaces
                              .filter((m) => matching(m.name))
                              .map((m) => (
                                <div
                                  key={m.name}
                                  className="flex items-center justify-between gap-4 rounded-xl px-2 py-4"
                                >
                                  <div>
                                    <p className="text-sm font-medium">{m.name}</p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {m.plugins.length}{" "}
                                      {m.plugins.length === 1 ? "plugin" : "plugins"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={updateMarket.isPending}
                                      onClick={() => updateMarket.mutate(m.name)}
                                    >
                                      Update
                                    </Button>
                                    {m.path && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          removeMarket.reset()
                                          setRemoveMarketName(m.name)
                                          setRemoveMarketOpen(true)
                                        }}
                                      >
                                        Remove
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ))
                          : null}
                  </div>
                </>
              ) : query.trim() ? (
                <div className="mt-7 grid gap-x-7 gap-y-1 sm:grid-cols-2">
                  {view === "plugins"
                    ? filteredPlugins.map((p) => <PluginRow key={p.id} plugin={p} />)
                    : filteredSkills.map((s) => <SkillRow key={s.path} skill={s} />)}
                  {!(view === "plugins" ? filteredPlugins.length : filteredSkills.length) && (
                    <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
                      No results for “{query}”. Try another search.
                    </p>
                  )}
                </div>
              ) : view === "skills" ? (
                <>
                  <SkillGroup title="Installed" items={skills.filter((s) => s.enabled)} />
                  <nav aria-label="Skill sources" className="mt-10 flex flex-wrap gap-1">
                    {skillSources.map((sourceLabel) => (
                      <button
                        key={sourceLabel}
                        type="button"
                        aria-pressed={activeSkillSource === sourceLabel}
                        className={pill}
                        onClick={() => setScope(sourceLabel)}
                      >
                        {sourceLabel}
                      </button>
                    ))}
                  </nav>
                  <SkillGroup
                    title={activeSkillSource ?? "Skills"}
                    items={skills.filter((skill) => skillSourceLabel(skill) === activeSkillSource)}
                  />
                </>
              ) : (
                <>
                  <Section
                    title="Installed"
                    action={
                      <IconButton
                        label="Manage installed plugins"
                        onClick={() => changeView("manage")}
                      >
                        <Settings className="size-4" />
                      </IconButton>
                    }
                  >
                    <div className="flex gap-2 overflow-x-auto px-2 pb-3 pt-1">
                      {installed.map((p) => (
                        <Tooltip key={p.id}>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={p.displayName}
                                className="shrink-0 rounded-xl transition-transform hover:-translate-y-1 focus-visible:outline-2"
                                onClick={() => changeView("plugins", p.id)}
                              />
                            }
                          >
                            <Icon src={p.logoUrl} name={p.displayName} />
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{p.displayName}</TooltipContent>
                        </Tooltip>
                      ))}
                      {!installed.length && (
                        <p className="py-3 text-sm text-muted-foreground">
                          Installed plugins will appear here.
                        </p>
                      )}
                    </div>
                  </Section>
                  <nav aria-label="Plugin sources" className="mt-5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      className={pill}
                      aria-pressed={source === "public"}
                      onClick={() => setSource("public")}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      className={pill}
                      aria-pressed={source === "personal"}
                      onClick={() => setSource("personal")}
                    >
                      Personal
                    </button>
                  </nav>
                  {source !== "public" ? (
                    <>
                      <PluginGroup
                        title="Created by me"
                        items={plugins.filter((p) =>
                          p.sourceKinds?.includes("created-by-me-remote")
                        )}
                      />
                      <PluginGroup
                        title="Shared with me"
                        items={plugins.filter((p) => p.sourceKinds?.includes("shared-with-me"))}
                      />
                      <PluginGroup
                        title="Local marketplaces"
                        items={plugins.filter((p) => p.sourceKinds?.includes("local"))}
                      />
                      <PluginGroup
                        title="Workspace"
                        items={plugins.filter((p) =>
                          p.sourceKinds?.includes("workspace-directory")
                        )}
                      />
                      {!plugins.some((p) => p.sourceKinds?.some((kind) => kind !== "vertical")) && (
                        <p className="mt-10 text-sm text-muted-foreground">
                          No personal plugins yet. Plugins you create, receive, or add locally will
                          appear here.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <PluginGroup
                        title="Featured"
                        items={publicPlugins.filter((p) => p.featured)}
                      />
                      {Array.from(
                        new Set(
                          publicPlugins
                            .filter((p) => !p.featured)
                            .map((p) => p.category ?? "More plugins")
                        )
                      ).map((category) => (
                        <PluginGroup
                          key={category}
                          title={category}
                          items={publicPlugins.filter(
                            (p) => !p.featured && (p.category ?? "More plugins") === category
                          )}
                        />
                      ))}
                    </>
                  )}
                  {!plugins.length && (
                    <div className="mt-12 text-center text-sm text-muted-foreground">
                      No plugins found. Add a marketplace to get started.
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {(data?.errors.length ?? 0) > 0 && (
            <div role="alert" className="mt-8 text-sm text-destructive">
              {data?.errors.map((e) => (
                <p key={e.path}>{e.message}</p>
              ))}
            </div>
          )}
        </main>
      </div>
      <Dialog
        open={removeMarketOpen}
        onOpenChange={(open) => {
          if (!removeMarket.isPending) setRemoveMarketOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeMarketName}?</DialogTitle>
            <DialogDescription>
              {removalBlocked
                ? "This marketplace still has installed plugins, or is no longer available. Uninstall its plugins and refresh before removing the source."
                : "Remove this local marketplace source from Cypheria’s Codex environment. App Server manages source cleanup. You can add the source again later."}
            </DialogDescription>
          </DialogHeader>
          {removeMarket.error && (
            <p role="alert" className="text-sm text-destructive">
              {removeMarket.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={removeMarket.isPending}
              onClick={() => setRemoveMarketOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removalBlocked || removeMarket.isPending}
              onClick={() => removeMarketName && removeMarket.mutate(removeMarketName)}
            >
              {removeMarket.isPending ? "Removing…" : "Remove marketplace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add marketplace</DialogTitle>
            <DialogDescription>
              Install a plugin directory from a Git repository or local folder.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm" htmlFor="marketplace-source">
            Source
            <Input
              id="marketplace-source"
              value={marketplaceSource}
              onChange={(e) => setMarketplaceSource(e.target.value)}
              placeholder="openai/plugins or /path/to/marketplace"
            />
          </label>
          <label className="grid gap-2 text-sm" htmlFor="marketplace-ref">
            Git ref (optional)
            <Input
              id="marketplace-ref"
              value={marketplaceRef}
              onChange={(e) => setMarketplaceRef(e.target.value)}
              placeholder="main"
            />
          </label>
          {addMarket.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(addMarket.error)}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMarketplaceOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!marketplaceSource.trim() || addMarket.isPending}
              onClick={() => addMarket.mutate()}
            >
              {addMarket.isPending ? "Adding…" : "Add marketplace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selectedSkill}
        onOpenChange={(open) => {
          if (!open) setSelectedSkill(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedSkill?.displayName}</DialogTitle>
            <DialogDescription>{selectedSkill?.description}</DialogDescription>
          </DialogHeader>
          {selectedSkill && (
            <>
              <dl className="grid grid-cols-[100px_1fr] gap-y-3 text-sm">
                <Info label="Source">{selectedSkill.scope}</Info>
                <Info label="Plugin">{selectedSkill.pluginId ?? "Standalone"}</Info>
                <Info label="Dependencies">{selectedSkill.dependencyCount}</Info>
              </dl>
              <div className="flex items-center justify-between border-t pt-4">
                <span className="text-sm">Enabled</span>
                <Switch
                  aria-label="Enable skill"
                  checked={skills.find((s) => s.path === selectedSkill.path)?.enabled ?? false}
                  disabled={skillMutation.isPending || selectedSkill.scope === "admin"}
                  onCheckedChange={() =>
                    skillMutation.mutate(
                      skills.find((s) => s.path === selectedSkill.path) ?? selectedSkill
                    )
                  }
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}
