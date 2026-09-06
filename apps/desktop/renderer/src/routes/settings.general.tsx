import { msg } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Trans } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { LanguagePreference, LanguageSettings } from "../../../ipc/src/index.js"
import { LanguageSelector } from "../components/language-selector.js"
import { SettingsFrame } from "../components/settings-frame"
import { activateLanguage } from "../i18n.js"

export const Route = createFileRoute("/settings/general")({
  component: GeneralSettingsRoute,
})

const fallbackLanguageSettings: LanguageSettings = {
  configPath: "Browser preview",
  locale: "en",
  preference: "system",
}

function GeneralSettingsRoute() {
  const { i18n } = useLingui()
  const queryClient = useQueryClient()
  const languageQuery = useQuery({
    queryFn: () => window.cypheria?.settings.getLanguage() ?? fallbackLanguageSettings,
    queryKey: ["settings", "language"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  const languageMutation = useMutation({
    mutationFn: (preference: LanguagePreference) =>
      window.cypheria?.settings.setLanguage({ preference }) ??
      Promise.resolve<LanguageSettings>({
        ...fallbackLanguageSettings,
        locale: preference === "zh-CN" ? "zh-CN" : "en",
        preference,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings", "language"], settings)
      activateLanguage(settings)
    },
  })

  return (
    <SettingsFrame>
      <div className="grid w-full content-start gap-6 pb-10 text-foreground">
        <header className="min-w-0">
          <h1 className="text-[25px] font-semibold leading-8 text-foreground">
            <Trans id="settings.general.title">General</Trans>
          </h1>
        </header>

        <section className="grid gap-4">
          <h2 className="text-sm font-semibold text-foreground">
            <Trans id="settings.general.section">General</Trans>
          </h2>
          <section className="rounded-xl border border-border bg-card px-4 text-card-foreground shadow-xs">
            <div className="flex min-h-[52px] items-center justify-between gap-4 py-2.5 max-sm:flex-col max-sm:items-stretch">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {i18n._(msg({ id: "settings.language.label", message: "Display language" }))}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {i18n._(
                    msg({
                      id: "settings.language.description",
                      message: "Language for the app UI",
                    })
                  )}
                </div>
              </div>
              <LanguageSelector
                disabled={languageMutation.isPending}
                onChange={(value) => languageMutation.mutate(value)}
                value={languageQuery.data?.preference ?? "system"}
              />
            </div>
          </section>
        </section>

        {languageMutation.isError ? (
          <p className="text-[13px] text-destructive">{String(languageMutation.error.message)}</p>
        ) : null}
      </div>
    </SettingsFrame>
  )
}
