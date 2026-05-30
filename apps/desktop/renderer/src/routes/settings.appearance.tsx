import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { Separator } from "@cypheria/ui/components/separator"
import {
  defaultCodexAppearanceThemeSettings,
  mapCodexAppearanceToCypheriaThemeState,
  type CodexAppearanceThemeSettings,
  type CodexChromeTheme,
  useCypheriaTheme,
} from "@cypheria/ui"
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
    <section className="settings-screen" aria-label="Appearance settings">
      <aside className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-heading">
          <h1>Settings</h1>
          <span>Cypheria Desktop</span>
        </div>
        <a aria-current="page" href="/settings/appearance">
          <Palette aria-hidden="true" size={16} strokeWidth={1.9} />
          Appearance
        </a>
      </aside>

      <main className="appearance-panel">
        <header className="appearance-header">
          <div>
            <h1>Appearance</h1>
            <span>{appearanceQuery.data?.configPath ?? "Loading config"}</span>
          </div>
          <div className="appearance-actions">
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

        <fieldset className="appearance-mode-tabs">
          <legend className="sr-only">Theme mode</legend>
          {themeModes.map(({ icon: Icon, label, value }) => (
            <button
              aria-pressed={selectedMode === value}
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
          <div className="appearance-grid">
            <section className="appearance-section">
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
              <div className="field-row">
                <label htmlFor={`${selectedMode}-contrast`}>Contrast</label>
                <div className="range-field">
                  <input
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
              <label className="checkbox-row">
                <input
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

            <section className="appearance-section">
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

            <section className="appearance-preview" aria-label="Theme preview">
              <div className="preview-titlebar">
                <span />
                <span />
                <span />
              </div>
              <div className="preview-body">
                <div>
                  <strong>Cypheria</strong>
                  <span>Workspace theme preview</span>
                </div>
                <button type="button">Primary action</button>
                <div className="preview-code">
                  <span style={{ color: "var(--diff-added)" }}>+ connected wallet context</span>
                  <span style={{ color: "var(--diff-removed)" }}>- stale transaction plan</span>
                  <span style={{ color: "var(--skill)" }}>@skill policy-inspector</span>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="settings-loading">Loading appearance settings</div>
        )}

        {writeMutation.isError ? (
          <p className="settings-error">{String(writeMutation.error.message)}</p>
        ) : null}
      </main>
    </section>
  )
}

function SectionTitle({ children, icon }: Readonly<{ children: string; icon: ReactNode }>) {
  return (
    <div className="section-title">
      {icon}
      <h2>{children}</h2>
    </div>
  )
}

function ColorField({
  label,
  onChange,
  value,
}: Readonly<{ label: string; onChange: (value: string) => void; value: string }>) {
  return (
    <div className="field-row">
      <label htmlFor={`color-${label}`}>{label}</label>
      <div className="color-field">
        <input
          aria-label={`${label} swatch`}
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
    <div className="field-row">
      <label htmlFor={`text-${label}`}>{label}</label>
      <Input
        id={`text-${label}`}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </div>
  )
}
