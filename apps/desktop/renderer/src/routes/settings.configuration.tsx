import { Button } from "@cypheria/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { Switch } from "@cypheria/ui/components/switch"
import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ExternalLink } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import type {
  CodexPermissionDefaults,
  CodexPermissionDefaultsWrite,
} from "../../../ipc/src/index.js"
import { SettingsFrame } from "../components/settings-frame"

export const Route = createFileRoute("/settings/configuration")({
  component: ConfigurationSettingsRoute,
})

const fallbackPermissionDefaults: CodexPermissionDefaults = {
  allowedApprovalPolicies: null,
  allowedSandboxModes: null,
  allowedWebSearchModes: null,
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  configPath: "Browser preview",
  modelReasoningSummary: "auto",
  modelVerbosity: null,
  networkAccess: true,
  sandboxMode: "workspace-write",
  webSearch: "cached",
}

function ConfigurationSettingsRoute() {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryFn: () => window.cypheria?.codex.getPermissionDefaults() ?? fallbackPermissionDefaults,
    queryKey: ["codex", "permission-defaults"],
  })
  const [draft, setDraft] = useState<CodexPermissionDefaults | null>(null)
  useEffect(() => {
    if (settingsQuery.data) setDraft(settingsQuery.data)
  }, [settingsQuery.data])
  const save = useMutation({
    mutationFn: async (settings: CodexPermissionDefaultsWrite) => {
      if (!window.cypheria)
        throw new Error("Codex configuration is only available in the desktop app.")
      return window.cypheria.codex.setPermissionDefaults(settings)
    },
    onSuccess: (settings) => {
      setDraft(settings)
      queryClient.setQueryData(["codex", "permission-defaults"], settings)
      void queryClient.invalidateQueries({ queryKey: ["codex", "permissions"] })
    },
  })
  const update = <K extends keyof CodexPermissionDefaultsWrite>(
    key: K,
    value: CodexPermissionDefaultsWrite[K]
  ) => {
    if (!draft) return
    const next = { ...draft, [key]: value }
    setDraft(next)
    const { configPath: _configPath, ...write } = next
    save.mutate(write)
  }

  if (!draft)
    return (
      <SettingsFrame wide>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </SettingsFrame>
    )

  return (
    <SettingsFrame wide>
      <div className="grid w-full content-start gap-10 pb-10">
        <header>
          <h1 className="text-[28px] font-semibold leading-9">
            <Trans id="settings.configuration.title">Configuration</Trans>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans id="settings.configuration.description">
              Configure permissions, web access, and agent responses for new chats.
            </Trans>
          </p>
        </header>
        <section className="grid gap-4">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-base font-semibold">
              <Trans id="settings.configuration.defaults">Agent defaults</Trans>
            </h2>
            <Button
              onClick={() => void window.cypheria?.codex.openPermissionsConfig()}
              size="sm"
              variant="ghost"
            >
              <Trans id="settings.configuration.openConfig">Open config.toml</Trans>
              <ExternalLink className="size-3.5" />
            </Button>
          </div>
          <div className="rounded-2xl border border-border bg-card px-5 shadow-xs">
            <ConfigRow
              title={<Trans id="settings.configuration.approval.title">Approval policy</Trans>}
              description={
                <Trans id="settings.configuration.approval.description">
                  Choose when ChatGPT asks for approval
                </Trans>
              }
            >
              <ValueSelect
                value={draft.approvalPolicy}
                onChange={(value) =>
                  update("approvalPolicy", value as CodexPermissionDefaultsWrite["approvalPolicy"])
                }
                options={
                  [
                    [
                      "untrusted",
                      i18n._(
                        msg({
                          id: "settings.configuration.option.untrusted",
                          message: "Untrusted commands",
                        })
                      ),
                    ],
                    [
                      "on-request",
                      i18n._(
                        msg({
                          id: "settings.configuration.option.onRequest",
                          message: "On request",
                        })
                      ),
                    ],
                    [
                      "never",
                      i18n._(msg({ id: "settings.configuration.option.never", message: "Never" })),
                    ],
                  ].filter(
                    ([value]) =>
                      !draft.allowedApprovalPolicies ||
                      draft.allowedApprovalPolicies.includes(
                        value as CodexPermissionDefaultsWrite["approvalPolicy"]
                      )
                  ) as Array<[string, string]>
                }
              />
            </ConfigRow>
            <ConfigRow
              title={<Trans id="settings.configuration.sandbox.title">Sandbox settings</Trans>}
              description={
                <Trans id="settings.configuration.sandbox.description">
                  Choose the permission scope when ChatGPT runs commands
                </Trans>
              }
            >
              <ValueSelect
                value={draft.sandboxMode}
                onChange={(value) =>
                  update("sandboxMode", value as CodexPermissionDefaultsWrite["sandboxMode"])
                }
                options={
                  [
                    [
                      "read-only",
                      i18n._(
                        msg({ id: "settings.configuration.option.readOnly", message: "Read only" })
                      ),
                    ],
                    [
                      "workspace-write",
                      i18n._(
                        msg({
                          id: "settings.configuration.option.workspaceWrite",
                          message: "Workspace write",
                        })
                      ),
                    ],
                    [
                      "danger-full-access",
                      i18n._(
                        msg({
                          id: "settings.configuration.option.dangerFullAccess",
                          message: "Danger full access",
                        })
                      ),
                    ],
                  ].filter(
                    ([value]) =>
                      !draft.allowedSandboxModes ||
                      draft.allowedSandboxModes.includes(
                        value as CodexPermissionDefaultsWrite["sandboxMode"]
                      )
                  ) as Array<[string, string]>
                }
              />
            </ConfigRow>
            <ConfigRow
              title={<Trans id="settings.configuration.network.title">Allow network access</Trans>}
              description={
                <Trans id="settings.configuration.network.description">
                  Allow network access when the sandbox is set to Workspace write
                </Trans>
              }
            >
              <Switch
                checked={draft.networkAccess}
                disabled={save.isPending}
                onCheckedChange={(value) => update("networkAccess", value)}
              />
            </ConfigRow>
            <ConfigRow
              title={<Trans id="settings.configuration.webSearch.title">Web search</Trans>}
              description={
                <Trans id="settings.configuration.webSearch.description">
                  Choose how ChatGPT accesses the web
                </Trans>
              }
            >
              <ValueSelect
                value={draft.webSearch ?? "model-default"}
                onChange={(value) =>
                  update(
                    "webSearch",
                    value === "model-default"
                      ? null
                      : (value as CodexPermissionDefaultsWrite["webSearch"])
                  )
                }
                options={
                  [
                    [
                      "model-default",
                      i18n._(
                        msg({
                          id: "settings.configuration.option.modelDefault",
                          message: "Model default",
                        })
                      ),
                    ],
                    [
                      "disabled",
                      i18n._(
                        msg({ id: "settings.configuration.option.disabled", message: "Disabled" })
                      ),
                    ],
                    [
                      "cached",
                      i18n._(
                        msg({ id: "settings.configuration.option.cached", message: "Cached" })
                      ),
                    ],
                    [
                      "indexed",
                      i18n._(
                        msg({ id: "settings.configuration.option.indexed", message: "Indexed" })
                      ),
                    ],
                    [
                      "live",
                      i18n._(msg({ id: "settings.configuration.option.live", message: "Live" })),
                    ],
                  ].filter(
                    ([value]) =>
                      value === "model-default" ||
                      !draft.allowedWebSearchModes ||
                      draft.allowedWebSearchModes.includes(
                        value as Exclude<CodexPermissionDefaultsWrite["webSearch"], null>
                      )
                  ) as Array<[string, string]>
                }
              />
            </ConfigRow>
            <ConfigRow
              title={<Trans id="settings.configuration.verbosity.title">Output detail</Trans>}
              description={
                <Trans id="settings.configuration.verbosity.description">
                  Choose the level of detail in ChatGPT responses
                </Trans>
              }
            >
              <ValueSelect
                value={draft.modelVerbosity ?? "model-default"}
                onChange={(value) =>
                  update(
                    "modelVerbosity",
                    value === "model-default"
                      ? null
                      : (value as CodexPermissionDefaultsWrite["modelVerbosity"])
                  )
                }
                options={[
                  [
                    "model-default",
                    i18n._(
                      msg({
                        id: "settings.configuration.option.modelDefault",
                        message: "Model default",
                      })
                    ),
                  ],
                  ["low", i18n._(msg({ id: "settings.configuration.option.low", message: "Low" }))],
                  [
                    "medium",
                    i18n._(msg({ id: "settings.configuration.option.medium", message: "Medium" })),
                  ],
                  [
                    "high",
                    i18n._(msg({ id: "settings.configuration.option.high", message: "High" })),
                  ],
                ]}
              />
            </ConfigRow>
            <ConfigRow
              title={<Trans id="settings.configuration.summary.title">Reasoning summary</Trans>}
              description={
                <Trans id="settings.configuration.summary.description">
                  Choose how ChatGPT summarizes its reasoning
                </Trans>
              }
            >
              <ValueSelect
                value={draft.modelReasoningSummary ?? "auto"}
                onChange={(value) =>
                  update(
                    "modelReasoningSummary",
                    value as CodexPermissionDefaultsWrite["modelReasoningSummary"]
                  )
                }
                options={[
                  [
                    "auto",
                    i18n._(msg({ id: "settings.configuration.option.auto", message: "Auto" })),
                  ],
                  [
                    "concise",
                    i18n._(
                      msg({ id: "settings.configuration.option.concise", message: "Concise" })
                    ),
                  ],
                  [
                    "detailed",
                    i18n._(
                      msg({ id: "settings.configuration.option.detailed", message: "Detailed" })
                    ),
                  ],
                  [
                    "none",
                    i18n._(msg({ id: "settings.configuration.option.none", message: "None" })),
                  ],
                ]}
              />
            </ConfigRow>
          </div>
          {save.isError ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
        </section>
      </div>
    </SettingsFrame>
  )
}

function ConfigRow({
  children,
  description,
  title,
}: Readonly<{ children: ReactNode; description: ReactNode; title: ReactNode }>) {
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-6 border-b border-border py-3 last:border-b-0 max-sm:items-start">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function ValueSelect({
  onChange,
  options,
  value,
}: Readonly<{
  onChange: (value: string) => void
  options: ReadonlyArray<readonly [string, string]>
  value: string
}>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(String(next))}>
      <SelectTrigger className="min-w-40">
        <SelectValue>{options.find(([key]) => key === value)?.[1] ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
