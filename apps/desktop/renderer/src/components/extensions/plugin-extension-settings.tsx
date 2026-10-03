import {
  type ExtensionEntrypoint,
  type ExtensionSettingsProvider,
  type OpenAISetting,
  OpenAISettingSchema,
} from "@cypheria/protocol"
import { Button } from "@cypheria/ui/components/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@cypheria/ui/components/dialog"
import { Input } from "@cypheria/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Spinner } from "@cypheria/ui/components/spinner"
import { Switch } from "@cypheria/ui/components/switch"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Settings2 } from "lucide-react"
import { useEffect, useState } from "react"
import { z } from "zod"

import { ensureCypheriaClient } from "../../cypheria-client.js"
import { McpAppHost } from "../mcp-app-host.js"
import { useExtensionCatalog } from "./catalog.js"

type Value = string | number | boolean
type AppModal = { title: string; target: Parameters<typeof McpAppHost>[0]["target"] }

const GroupSchema = z.object({
  items: z.array(
    z.union([
      z.object({ kind: z.literal("property"), property: z.string() }),
      z.object({
        app: z.boolean().optional(),
        description: z.string().optional(),
        kind: z.literal("tool"),
        title: z.string(),
        tool: z.string(),
      }),
    ])
  ),
  title: z.string(),
})
type Group = z.infer<typeof GroupSchema>

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Whether a value satisfies its setting's constraints. */
const valid = (setting: OpenAISetting, value: Value): boolean => {
  if (setting.type === "boolean") return typeof value === "boolean"
  if (setting.type === "string") {
    if (typeof value !== "string") return false
    if (setting.enum && !setting.enum.includes(value)) return false
    if (setting.minLength !== undefined && value.length < setting.minLength) return false
    if (setting.maxLength !== undefined && value.length > setting.maxLength) return false
    if (setting.pattern) {
      try {
        if (!new RegExp(setting.pattern, "u").test(value)) return false
      } catch {
        return false
      }
    }
    return true
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false
  if (setting.type === "integer" && !Number.isInteger(value)) return false
  if (setting.minimum !== undefined && value < setting.minimum) return false
  if (setting.maximum !== undefined && value > setting.maximum) return false
  if (
    setting.multipleOf !== undefined &&
    Math.abs(value / setting.multipleOf - Math.round(value / setting.multipleOf)) > 1e-9
  ) {
    return false
  }
  return true
}

function SettingControl({
  disabled,
  onChange,
  property,
  setting,
  value,
}: Readonly<{
  disabled: boolean
  onChange: (value: Value) => void
  property: string
  setting: OpenAISetting
  value: unknown
}>) {
  const [draft, setDraft] = useState(String(value ?? ""))
  useEffect(() => setDraft(String(value ?? "")), [value])
  if (setting.type === "boolean") {
    return (
      <Switch
        aria-label={setting.title}
        checked={value === true}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(checked)}
      />
    )
  }
  if (setting.type === "string" && setting.enum) {
    return (
      <Select
        disabled={disabled}
        value={typeof value === "string" ? value : ""}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next)
        }}
      >
        <SelectTrigger aria-label={setting.title} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {setting.enum.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  const parse = (text: string): Value => (setting.type === "string" ? text : Number(text))
  const candidate = parse(draft)
  const invalid = draft !== String(value ?? "") && !valid(setting, candidate)
  const commit = () => {
    if (draft !== String(value ?? "") && valid(setting, candidate)) onChange(candidate)
  }
  return (
    <Input
      aria-invalid={invalid}
      aria-label={setting.title}
      className="w-48"
      disabled={disabled}
      id={`setting-${property}`}
      inputMode={setting.type === "string" ? undefined : "decimal"}
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit()
      }}
    />
  )
}

/** One server's structured settings, drawn with native controls. */
function StructuredSettings({
  onOpenApp,
  provider,
}: Readonly<{ onOpenApp: (modal: AppModal) => void; provider: ExtensionSettingsProvider }>) {
  const queryClient = useQueryClient()
  const key = ["extensions", "settings", provider.id]
  const settings = useQuery({
    queryFn: async () => (await ensureCypheriaClient()).extensions.settings.read(provider.id),
    queryKey: key,
    retry: false,
  })
  const [toolResults, setToolResults] = useState<Record<string, string>>({})
  const update = useMutation({
    mutationFn: async (set: Record<string, Value>) =>
      (await ensureCypheriaClient()).extensions.settings.update(provider.id, set),
    onSuccess: (values) => {
      queryClient.setQueryData(key, (current: typeof settings.data) =>
        current ? { ...current, values: { ...current.values, ...values } } : current
      )
    },
  })
  const runTool = useMutation({
    mutationFn: async (tool: string) =>
      (await ensureCypheriaClient()).extensions.settings.runTool(provider.id, tool),
    onSuccess: (result, tool) =>
      setToolResults((current) => ({ ...current, [tool]: result.text || "Done" })),
  })

  if (settings.isPending) return <Spinner />
  if (settings.error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {errorText(settings.error)}
      </p>
    )
  }
  const properties =
    z
      .record(z.string(), OpenAISettingSchema)
      .safeParse((settings.data.schema as { properties?: unknown }).properties).data ?? {}
  const groups = settings.data.layout.flatMap((group) => {
    const parsed = GroupSchema.safeParse(group)
    return parsed.success ? [parsed.data] : []
  })
  const listed = new Set(
    groups.flatMap((group) =>
      group.items.flatMap((item) => (item.kind === "property" ? [item.property] : []))
    )
  )
  const others = Object.keys(properties).filter((property) => !listed.has(property))
  const allGroups: Group[] = [
    ...groups,
    ...(others.length > 0
      ? [
          {
            items: others.map((property) => ({ kind: "property" as const, property })),
            title: "Other settings",
          },
        ]
      : []),
  ]
  return (
    <div className="grid gap-5">
      {allGroups.map((group) => (
        <div key={group.title} className="grid gap-1">
          <h4 className="px-2 font-medium text-muted-foreground text-xs">{group.title}</h4>
          {group.items.map((item) => {
            if (item.kind === "tool") {
              return (
                <div key={`tool:${item.tool}`} className="flex items-center gap-3 px-2 py-2">
                  <div className="min-w-0 flex-1">
                    {item.description ? (
                      <p className="text-muted-foreground text-sm">{item.description}</p>
                    ) : null}
                    {toolResults[item.tool] ? (
                      <p role="status" className="text-muted-foreground text-xs">
                        {toolResults[item.tool]}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    disabled={runTool.isPending}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      item.app
                        ? onOpenApp({
                            target: { kind: "tool", server: provider.server, tool: item.tool },
                            title: item.title,
                          })
                        : runTool.mutate(item.tool)
                    }
                  >
                    {runTool.isPending && runTool.variables === item.tool ? <Spinner /> : null}
                    {item.title}
                  </Button>
                </div>
              )
            }
            const setting = properties[item.property]
            if (!setting) return null
            return (
              <div key={item.property} className="flex items-center gap-3 px-2 py-2">
                <label className="min-w-0 flex-1" htmlFor={`setting-${item.property}`}>
                  <span className="text-sm">{setting.title}</span>
                  {setting.description ? (
                    <span className="block text-muted-foreground text-xs">
                      {setting.description}
                    </span>
                  ) : null}
                </label>
                <SettingControl
                  disabled={update.isPending}
                  property={item.property}
                  setting={setting}
                  value={settings.data.values[item.property]}
                  onChange={(value) => update.mutate({ [item.property]: value })}
                />
              </div>
            )
          })}
        </div>
      ))}
      {update.error || runTool.error ? (
        <p role="alert" className="text-destructive text-sm">
          {errorText(update.error ?? runTool.error)}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A plugin's settings from its MCP servers: structured settings drawn natively, and settings
 * entry points, which open the plugin's own settings App.
 */
export function PluginExtensionSettings({ pluginId }: Readonly<{ pluginId: string }>) {
  const catalog = useExtensionCatalog()
  const [modal, setModal] = useState<AppModal | null>(null)
  const providers = catalog?.settings.filter((provider) => provider.pluginId === pluginId) ?? []
  const views: ExtensionEntrypoint[] =
    catalog?.entrypoints.filter(
      (entry) => entry.type === "settings" && entry.pluginId === pluginId
    ) ?? []
  if (providers.length === 0 && views.length === 0) return null
  return (
    <section className="mt-8 grid gap-4">
      <h3 className="font-medium text-sm">
        <Trans id="extension.settings.title">Settings</Trans>
      </h3>
      {providers.map((provider) => (
        <StructuredSettings key={provider.id} provider={provider} onOpenApp={setModal} />
      ))}
      {views.map((view) => (
        <Button
          key={view.id}
          className="justify-self-start"
          variant="outline"
          onClick={() =>
            setModal({ target: { entrypointId: view.id, kind: "entrypoint" }, title: view.title })
          }
        >
          <Settings2 className="size-4" />
          {view.title}
          <ExternalLink className="size-3" />
        </Button>
      ))}
      <Dialog open={modal !== null} onOpenChange={(open) => (open ? undefined : setModal(null))}>
        <DialogContent className="h-[80vh] max-w-4xl p-0 sm:max-w-4xl">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>{modal?.title}</DialogTitle>
          </DialogHeader>
          {modal ? <McpAppHost className="min-h-0 flex-1" target={modal.target} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
