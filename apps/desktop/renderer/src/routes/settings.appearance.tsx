import {
  type CodexAppearanceThemeSettings,
  type CodexChromeTheme,
  cn,
  defaultCodexAppearanceThemeSettings,
  mapCodexAppearanceToCypheriaThemeState,
  useCypheriaTheme,
} from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { Separator } from "@cypheria/ui/components/separator"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check, Code2, Moon, Palette, RotateCcw, Save, Sun } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceRoute,
})

type ThemeMode = keyof CodexAppearanceThemeSettings

const themeModes = [
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
] as const

function AppearanceRoute() {
  const { setMode, setThemeState, themeState } = useCypheriaTheme()
  const [selectedMode, setSelectedMode] = useState<ThemeMode>(themeState.currentMode)
  const [draftThemes, setDraftThemes] = useState<CodexAppearanceThemeSettings | null>(null)

  const appearanceQuery = useQuery({
    queryFn: () =>
      window.cypheria?.settings.getAppearance() ??
      ({
        configPath: "Browser preview",
        themes: defaultCodexAppearanceThemeSettings,
      } as const),
    queryKey: ["settings", "appearance"],
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    if (!appearanceQuery.data) {
      return
    }

    const themes = appearanceQuery.data.themes
    setDraftThemes(themes)
    setThemeState(mapCodexAppearanceToCypheriaThemeState(themes, selectedMode))
  }, [appearanceQuery.data, selectedMode, setThemeState])

  const writeMutation = useMutation({
    mutationFn: (themes: CodexAppearanceThemeSettings) =>
      window.cypheria?.settings.setAppearance({ themes }) ??
      Promise.reject(new Error("IPC unavailable")),
    onSuccess: (settings) => {
      setDraftThemes(settings.themes)
      setThemeState(mapCodexAppearanceToCypheriaThemeState(settings.themes, selectedMode))
    },
  })

  const savedThemes = appearanceQuery.data?.themes
  const isDirty = useMemo(() => {
    if (!draftThemes || !savedThemes) {
      return false
    }
    return JSON.stringify(draftThemes) !== JSON.stringify(savedThemes)
  }, [draftThemes, savedThemes])

  const currentTheme = draftThemes?.[selectedMode]

  const updateTheme = (updater: (theme: CodexChromeTheme) => CodexChromeTheme) => {
    setDraftThemes((current) => {
      if (!current) {
        return current
      }

      const next = {
        ...current,
        [selectedMode]: updater(current[selectedMode]),
      }
      setThemeState(mapCodexAppearanceToCypheriaThemeState(next, selectedMode))
      return next
    })
  }

  const handleModeChange = (mode: ThemeMode) => {
    setSelectedMode(mode)
    setMode(mode)
    if (draftThemes) {
      setThemeState(mapCodexAppearanceToCypheriaThemeState(draftThemes, mode))
    }
  }

  const handleReset = () => {
    if (!savedThemes) {
      return
    }
    setDraftThemes(savedThemes)
    setThemeState(mapCodexAppearanceToCypheriaThemeState(savedThemes, selectedMode))
  }

  return (
    <section
      className="grid min-h-screen grid-cols-[260px_minmax(0,1fr)] bg-background text-foreground max-[860px]:grid-cols-[minmax(0,1fr)]"
      aria-label="Appearance settings"
    >
      <aside
        className="grid content-start gap-2.5 border-r border-border bg-sidebar px-3.5 pb-[18px] pt-[54px] max-[860px]:hidden"
        aria-label="Settings sections"
      >
        <div className="grid gap-1 px-2 pb-3.5">
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
          <span className="truncate text-xs text-muted-foreground">Cypheria Desktop</span>
        </div>
        <a
          aria-current="page"
          className="flex min-h-[34px] items-center gap-2 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground no-underline hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
          href="/settings/appearance"
        >
          <Palette aria-hidden="true" size={16} strokeWidth={1.9} />
          Appearance
        </a>
      </aside>

      <main className="grid min-h-0 min-w-0 content-start gap-[18px] overflow-auto p-[30px] max-[860px]:p-[18px]">
        <header className="flex min-w-0 items-center justify-between gap-4 max-[860px]:flex-col max-[860px]:items-stretch">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">Appearance</h1>
            <span className="block truncate text-xs text-muted-foreground">
              {appearanceQuery.data?.configPath ?? "Loading config"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!isDirty || writeMutation.isPending}
              onClick={handleReset}
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" size={15} strokeWidth={1.9} />
              Reset
            </Button>
            <Button
              disabled={!draftThemes || !isDirty || writeMutation.isPending}
              onClick={() => draftThemes && writeMutation.mutate(draftThemes)}
            >
              {writeMutation.isSuccess && !isDirty ? (
                <Check aria-hidden="true" size={15} strokeWidth={1.9} />
              ) : (
                <Save aria-hidden="true" size={15} strokeWidth={1.9} />
              )}
              Save
            </Button>
          </div>
        </header>

        <fieldset className="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted p-[3px]">
          <legend className="sr-only">Theme mode</legend>
          {themeModes.map(({ icon: Icon, label, value }) => (
            <button
              aria-pressed={selectedMode === value}
              className={cn(
                "inline-flex h-[30px] min-w-[86px] items-center justify-center gap-[7px] rounded-md border-0 bg-transparent text-[13px] font-semibold text-muted-foreground",
                selectedMode === value && "bg-background text-foreground shadow-sm"
              )}
              key={value}
              onClick={() => handleModeChange(value)}
              type="button"
            >
              <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
              {label}
            </button>
          ))}
        </fieldset>

        {currentTheme ? (
          <div className="grid grid-cols-[minmax(280px,380px)_minmax(280px,420px)_minmax(320px,1fr)] items-start gap-4 max-[1220px]:grid-cols-[minmax(0,1fr)]">
            <section className="grid gap-3.5 rounded-lg border border-border bg-card p-3.5 text-card-foreground">
              <SectionTitle icon={<Palette aria-hidden="true" size={16} />}>Chrome</SectionTitle>
              <ColorField
                label="Surface"
                value={currentTheme.surface}
                onChange={(surface) => updateTheme((theme) => ({ ...theme, surface }))}
              />
              <ColorField
                label="Ink"
                value={currentTheme.ink}
                onChange={(ink) => updateTheme((theme) => ({ ...theme, ink }))}
              />
              <ColorField
                label="Accent"
                value={currentTheme.accent}
                onChange={(accent) => updateTheme((theme) => ({ ...theme, accent }))}
              />
              <div className="grid gap-[7px]">
                <label
                  className="text-xs font-semibold text-muted-foreground"
                  htmlFor={`${selectedMode}-contrast`}
                >
                  Contrast
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_74px] items-center gap-2">
                  <input
                    className="w-full accent-primary"
                    id={`${selectedMode}-contrast`}
                    max={100}
                    min={0}
                    onChange={(event) =>
                      updateTheme((theme) => ({
                        ...theme,
                        contrast: Number(event.currentTarget.value),
                      }))
                    }
                    type="range"
                    value={currentTheme.contrast}
                  />
                  <Input
                    aria-label="Contrast value"
                    max={100}
                    min={0}
                    onChange={(event) =>
                      updateTheme((theme) => ({
                        ...theme,
                        contrast: Number(event.currentTarget.value),
                      }))
                    }
                    type="number"
                    value={currentTheme.contrast}
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <input
                  className="accent-primary"
                  checked={currentTheme.opaqueWindows}
                  onChange={(event) =>
                    updateTheme((theme) => ({
                      ...theme,
                      opaqueWindows: event.currentTarget.checked,
                    }))
                  }
                  type="checkbox"
                />
                Opaque windows
              </label>
            </section>

            <section className="grid gap-3.5 rounded-lg border border-border bg-card p-3.5 text-card-foreground">
              <SectionTitle icon={<Code2 aria-hidden="true" size={16} />}>Fonts</SectionTitle>
              <TextField
                label="UI"
                value={currentTheme.fonts.ui}
                onChange={(ui) =>
                  updateTheme((theme) => ({ ...theme, fonts: { ...theme.fonts, ui } }))
                }
              />
              <TextField
                label="Code"
                value={currentTheme.fonts.code}
                onChange={(code) =>
                  updateTheme((theme) => ({ ...theme, fonts: { ...theme.fonts, code } }))
                }
              />
              <Separator />
              <ColorField
                label="Diff added"
                value={currentTheme.semanticColors.diffAdded}
                onChange={(diffAdded) =>
                  updateTheme((theme) => ({
                    ...theme,
                    semanticColors: { ...theme.semanticColors, diffAdded },
                  }))
                }
              />
              <ColorField
                label="Diff removed"
                value={currentTheme.semanticColors.diffRemoved}
                onChange={(diffRemoved) =>
                  updateTheme((theme) => ({
                    ...theme,
                    semanticColors: { ...theme.semanticColors, diffRemoved },
                  }))
                }
              />
              <ColorField
                label="Skill"
                value={currentTheme.semanticColors.skill}
                onChange={(skill) =>
                  updateTheme((theme) => ({
                    ...theme,
                    semanticColors: { ...theme.semanticColors, skill },
                  }))
                }
              />
            </section>

            <section
              className="grid gap-3.5 rounded-lg border border-border bg-card p-3.5 text-card-foreground"
              aria-label="Theme preview"
            >
              <div className="flex gap-1.5 border-b border-border pb-2.5">
                <span className="size-2.5 rounded-full bg-muted-foreground opacity-45" />
                <span className="size-2.5 rounded-full bg-muted-foreground opacity-45" />
                <span className="size-2.5 rounded-full bg-muted-foreground opacity-45" />
              </div>
              <div className="grid gap-3.5">
                <div className="grid gap-1">
                  <strong className="text-[15px]">Cypheria</strong>
                  <span className="text-xs text-muted-foreground">Workspace theme preview</span>
                </div>
                <Button className="h-8 justify-self-start rounded-[7px] px-3 text-[13px] font-semibold">
                  Primary action
                </Button>
                <div className="grid gap-1 rounded-[7px] border border-border bg-muted p-2.5 font-mono text-xs">
                  <span className="text-diff-added">+ connected wallet context</span>
                  <span className="text-diff-removed">- stale transaction plan</span>
                  <span className="text-skill">@skill policy-inspector</span>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="text-[13px] text-muted-foreground">Loading appearance settings</div>
        )}

        {writeMutation.isError ? (
          <p className="text-[13px] text-destructive">{String(writeMutation.error.message)}</p>
        ) : null}
      </main>
    </section>
  )
}

function SectionTitle({ children, icon }: Readonly<{ children: string; icon: ReactNode }>) {
  return (
    <div className="flex min-h-6 items-center gap-2 text-foreground">
      {icon}
      <h2 className="text-sm font-semibold">{children}</h2>
    </div>
  )
}

function ColorField({
  label,
  onChange,
  value,
}: Readonly<{ label: string; onChange: (value: string) => void; value: string }>) {
  return (
    <div className="grid gap-[7px]">
      <label className="text-xs font-semibold text-muted-foreground" htmlFor={`color-${label}`}>
        {label}
      </label>
      <div className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-2">
        <input
          aria-label={`${label} swatch`}
          className="h-8 w-[38px] rounded-[7px] border border-border bg-background p-0.5"
          id={`color-${label}`}
          onChange={(event) => onChange(event.currentTarget.value)}
          type="color"
          value={value}
        />
        <Input onChange={(event) => onChange(event.currentTarget.value)} value={value} />
      </div>
    </div>
  )
}

function TextField({
  label,
  onChange,
  value,
}: Readonly<{ label: string; onChange: (value: string) => void; value: string }>) {
  return (
    <div className="grid gap-[7px]">
      <label className="text-xs font-semibold text-muted-foreground" htmlFor={`text-${label}`}>
        {label}
      </label>
      <Input
        id={`text-${label}`}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </div>
  )
}
