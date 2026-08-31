import {
  type CodexAppearanceThemeSettings,
  type CodexChromeTheme,
  type CodexCodeThemeId,
  cn,
  defaultCodexAppearanceThemeSettings,
  getCodexCodeThemeOptionsForMode,
  getCodexCodeThemePresetVariant,
  mapCodexAppearanceToCypheriaThemeState,
  useCypheriaTheme,
} from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { Separator } from "@cypheria/ui/components/separator"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check, Copy, Import, Monitor, Moon, Palette, RotateCcw, Save, Sun } from "lucide-react"
import { type ReactNode, useEffect, useId, useMemo, useState } from "react"

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceRoute,
})

type ThemeMode = keyof CodexAppearanceThemeSettings
type AppearanceMode = "dark" | "light" | "system"
type DiffMarkerStyle = "color" | "symbols"

const appearanceModes = [
  { icon: Monitor, label: "System", value: "system" },
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
] as const

const fallbackAppearanceSettings = {
  appearanceTheme: "system",
  codeFontSize: 12,
  codeThemes: {
    dark: "codex",
    light: "catppuccin",
  },
  configPath: "Browser preview",
  diffMarkerStyle: "color",
  sansFontSize: 14,
  themes: defaultCodexAppearanceThemeSettings,
} as const

function AppearanceRoute() {
  const { setMode, setThemeState, themeState } = useCypheriaTheme()
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>("system")
  const [codeFontSize, setCodeFontSize] = useState(12)
  const [diffMarkerStyle, setDiffMarkerStyle] = useState<DiffMarkerStyle>("color")
  const [draftCodeThemes, setDraftCodeThemes] = useState<Record<
    ThemeMode,
    CodexCodeThemeId
  > | null>(null)
  const [draftThemes, setDraftThemes] = useState<CodexAppearanceThemeSettings | null>(null)
  const [previewMode, setPreviewMode] = useState<ThemeMode>(themeState.currentMode)
  const [sansFontSize, setSansFontSize] = useState(14)

  const appearanceQuery = useQuery({
    queryFn: () => window.cypheria?.settings.getAppearance() ?? fallbackAppearanceSettings,
    queryKey: ["settings", "appearance"],
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    if (!appearanceQuery.data) {
      return
    }

    const settings = appearanceQuery.data
    setAppearanceMode(settings.appearanceTheme)
    setCodeFontSize(settings.codeFontSize)
    setDiffMarkerStyle(settings.diffMarkerStyle)
    setDraftCodeThemes(settings.codeThemes)
    setDraftThemes(settings.themes)
    setSansFontSize(settings.sansFontSize)
    setThemeState(mapCodexAppearanceToCypheriaThemeState(settings.themes, previewMode))
  }, [appearanceQuery.data, previewMode, setThemeState])

  useEffect(() => {
    document.documentElement.style.setProperty("--cypheria-sans-font-size", `${sansFontSize}px`)
    document.documentElement.style.setProperty("--cypheria-code-font-size", `${codeFontSize}px`)
  }, [codeFontSize, sansFontSize])

  const writeMutation = useMutation({
    mutationFn: (settings: {
      appearanceTheme: AppearanceMode
      codeFontSize: number
      codeThemes: Record<ThemeMode, CodexCodeThemeId>
      diffMarkerStyle: DiffMarkerStyle
      sansFontSize: number
      themes: CodexAppearanceThemeSettings
    }) =>
      window.cypheria?.settings.setAppearance(settings) ??
      Promise.reject(new Error("IPC unavailable")),
    onSuccess: (settings) => {
      setAppearanceMode(settings.appearanceTheme)
      setCodeFontSize(settings.codeFontSize)
      setDiffMarkerStyle(settings.diffMarkerStyle)
      setDraftCodeThemes(settings.codeThemes)
      setDraftThemes(settings.themes)
      setSansFontSize(settings.sansFontSize)
      setThemeState(mapCodexAppearanceToCypheriaThemeState(settings.themes, previewMode))
    },
  })

  const isDirty = useMemo(() => {
    if (!appearanceQuery.data || !draftCodeThemes || !draftThemes) {
      return false
    }

    return (
      JSON.stringify({
        appearanceTheme: appearanceMode,
        codeFontSize,
        codeThemes: draftCodeThemes,
        diffMarkerStyle,
        sansFontSize,
        themes: draftThemes,
      }) !==
      JSON.stringify({
        appearanceTheme: appearanceQuery.data.appearanceTheme,
        codeFontSize: appearanceQuery.data.codeFontSize,
        codeThemes: appearanceQuery.data.codeThemes,
        diffMarkerStyle: appearanceQuery.data.diffMarkerStyle,
        sansFontSize: appearanceQuery.data.sansFontSize,
        themes: appearanceQuery.data.themes,
      })
    )
  }, [
    appearanceMode,
    appearanceQuery.data,
    codeFontSize,
    diffMarkerStyle,
    draftCodeThemes,
    draftThemes,
    sansFontSize,
  ])

  const updateTheme = (mode: ThemeMode, updater: (theme: CodexChromeTheme) => CodexChromeTheme) => {
    setDraftThemes((current) => {
      if (!current) {
        return current
      }

      const next = {
        ...current,
        [mode]: updater(current[mode]),
      }
      setThemeState(mapCodexAppearanceToCypheriaThemeState(next, previewMode))
      return next
    })
  }

  const handleAppearanceModeChange = (mode: AppearanceMode) => {
    setAppearanceMode(mode)
    if (mode !== "system") {
      setPreviewMode(mode)
      setMode(mode)
      if (draftThemes) {
        setThemeState(mapCodexAppearanceToCypheriaThemeState(draftThemes, mode))
      }
    }
  }

  const updateCodeTheme = (mode: ThemeMode, codeTheme: CodexCodeThemeId) => {
    const preset = getCodexCodeThemePresetVariant(codeTheme, mode)
    if (!preset) {
      return
    }

    setDraftCodeThemes((current) => (current ? { ...current, [mode]: codeTheme } : current))
    updateTheme(mode, () => cloneTheme(preset.theme))
  }

  const importTheme = (mode: ThemeMode) => {
    const rawTheme = window.prompt(`Paste Codex ${mode} theme`)
    if (!rawTheme) {
      return
    }

    const parsed = parseCodexThemeShare(rawTheme)
    if (!parsed || parsed.variant !== mode) {
      window.alert(`Expected a codex-theme-v1 ${mode} theme.`)
      return
    }

    setDraftCodeThemes((current) =>
      current ? { ...current, [mode]: parsed.codeThemeId } : current
    )
    updateTheme(mode, () => cloneTheme(parsed.theme))
  }

  const copyTheme = (mode: ThemeMode) => {
    if (!draftCodeThemes || !draftThemes) {
      return
    }

    const payload = `codex-theme-v1:${JSON.stringify({
      codeThemeId: draftCodeThemes[mode],
      theme: draftThemes[mode],
      variant: mode,
    })}`
    void navigator.clipboard?.writeText(payload)
  }

  const handleReset = () => {
    if (!appearanceQuery.data) {
      return
    }

    setAppearanceMode(appearanceQuery.data.appearanceTheme)
    setCodeFontSize(appearanceQuery.data.codeFontSize)
    setDiffMarkerStyle(appearanceQuery.data.diffMarkerStyle)
    setDraftCodeThemes(appearanceQuery.data.codeThemes)
    setDraftThemes(appearanceQuery.data.themes)
    setSansFontSize(appearanceQuery.data.sansFontSize)
    setThemeState(mapCodexAppearanceToCypheriaThemeState(appearanceQuery.data.themes, previewMode))
  }

  const save = () => {
    if (!draftCodeThemes || !draftThemes) {
      return
    }

    writeMutation.mutate({
      appearanceTheme: appearanceMode,
      codeFontSize,
      codeThemes: draftCodeThemes,
      diffMarkerStyle,
      sansFontSize,
      themes: draftThemes,
    })
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

      <main className="grid min-h-0 min-w-0 content-start gap-5 overflow-auto p-[30px] max-[860px]:p-[18px]">
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
              disabled={!draftCodeThemes || !draftThemes || !isDirty || writeMutation.isPending}
              onClick={save}
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

        <section className="grid gap-3.5 rounded-lg border border-border bg-card p-3.5 text-card-foreground">
          <SectionTitle icon={<Monitor aria-hidden="true" size={16} />}>Theme</SectionTitle>
          <fieldset className="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted p-[3px]">
            <legend className="sr-only">App theme</legend>
            {appearanceModes.map(({ icon: Icon, label, value }) => (
              <button
                aria-pressed={appearanceMode === value}
                className={cn(
                  "inline-flex h-[30px] min-w-[86px] items-center justify-center gap-[7px] rounded-md border-0 bg-transparent text-[13px] font-semibold text-muted-foreground",
                  appearanceMode === value && "bg-background text-foreground shadow-sm"
                )}
                key={value}
                onClick={() => handleAppearanceModeChange(value)}
                type="button"
              >
                <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
                {label}
              </button>
            ))}
          </fieldset>
          <div className="grid grid-cols-[repeat(3,minmax(180px,1fr))] gap-3 max-[960px]:grid-cols-[minmax(0,1fr)]">
            <NumberField
              label="UI font size"
              max={16}
              min={11}
              onChange={setSansFontSize}
              value={sansFontSize}
            />
            <NumberField
              label="Code font size"
              max={24}
              min={8}
              onChange={setCodeFontSize}
              value={codeFontSize}
            />
            <SelectField
              label="Diff marker style"
              onChange={(value) => setDiffMarkerStyle(value as DiffMarkerStyle)}
              options={[
                { label: "Color", value: "color" },
                { label: "Symbols", value: "symbols" },
              ]}
              value={diffMarkerStyle}
            />
          </div>
        </section>

        {draftThemes && draftCodeThemes ? (
          <div className="grid grid-cols-2 gap-4 max-[1220px]:grid-cols-[minmax(0,1fr)]">
            <ThemeCard
              codeFontSize={codeFontSize}
              codeTheme={draftCodeThemes.light}
              diffMarkerStyle={diffMarkerStyle}
              mode="light"
              onCodeThemeChange={(value) => updateCodeTheme("light", value)}
              onCopy={() => copyTheme("light")}
              onImport={() => importTheme("light")}
              onPreview={() => {
                setPreviewMode("light")
                setMode("light")
                setThemeState(mapCodexAppearanceToCypheriaThemeState(draftThemes, "light"))
              }}
              onThemeChange={(updater) => updateTheme("light", updater)}
              previewing={previewMode === "light"}
              sansFontSize={sansFontSize}
              theme={draftThemes.light}
              title="Light theme"
            />
            <ThemeCard
              codeFontSize={codeFontSize}
              codeTheme={draftCodeThemes.dark}
              diffMarkerStyle={diffMarkerStyle}
              mode="dark"
              onCodeThemeChange={(value) => updateCodeTheme("dark", value)}
              onCopy={() => copyTheme("dark")}
              onImport={() => importTheme("dark")}
              onPreview={() => {
                setPreviewMode("dark")
                setMode("dark")
                setThemeState(mapCodexAppearanceToCypheriaThemeState(draftThemes, "dark"))
              }}
              onThemeChange={(updater) => updateTheme("dark", updater)}
              previewing={previewMode === "dark"}
              sansFontSize={sansFontSize}
              theme={draftThemes.dark}
              title="Dark theme"
            />
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

function ThemeCard({
  codeFontSize,
  codeTheme,
  diffMarkerStyle,
  mode,
  onCodeThemeChange,
  onCopy,
  onImport,
  onPreview,
  onThemeChange,
  previewing,
  sansFontSize,
  theme,
  title,
}: Readonly<{
  codeFontSize: number
  codeTheme: CodexCodeThemeId
  diffMarkerStyle: DiffMarkerStyle
  mode: ThemeMode
  onCodeThemeChange: (value: CodexCodeThemeId) => void
  onCopy: () => void
  onImport: () => void
  onPreview: () => void
  onThemeChange: (updater: (theme: CodexChromeTheme) => CodexChromeTheme) => void
  previewing: boolean
  sansFontSize: number
  theme: CodexChromeTheme
  title: string
}>) {
  const accentSource = theme.accentSource ?? "custom"

  return (
    <section className="grid gap-3.5 rounded-lg border border-border bg-card p-3.5 text-card-foreground">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <SectionTitle
          icon={
            mode === "light" ? (
              <Sun aria-hidden="true" size={16} />
            ) : (
              <Moon aria-hidden="true" size={16} />
            )
          }
        >
          {title}
        </SectionTitle>
        <div className="flex items-center gap-2">
          <Button onClick={onImport} type="button" variant="ghost">
            <Import aria-hidden="true" size={14} strokeWidth={1.9} />
            Import
          </Button>
          <Button onClick={onCopy} type="button" variant="ghost">
            <Copy aria-hidden="true" size={14} strokeWidth={1.9} />
            Copy theme
          </Button>
          <Button onClick={onPreview} type="button" variant={previewing ? "secondary" : "outline"}>
            Preview
          </Button>
        </div>
      </div>

      <ThemePreview
        codeFontSize={codeFontSize}
        diffMarkerStyle={diffMarkerStyle}
        mode={mode}
        sansFontSize={sansFontSize}
        theme={theme}
      />

      <CodeThemeField mode={mode} value={codeTheme} onChange={onCodeThemeChange} />
      <SelectField
        label="Accent"
        onChange={(value) =>
          onThemeChange((current) => ({
            ...current,
            accentSource: value as "chatgpt" | "custom",
          }))
        }
        options={[
          { label: "Default", value: "chatgpt" },
          { label: "Custom", value: "custom" },
        ]}
        value={accentSource}
      />
      <ColorField
        disabled={accentSource === "chatgpt"}
        label="Accent color"
        value={theme.accent}
        onChange={(accent) =>
          onThemeChange((current) => ({ ...current, accent, accentSource: "custom" }))
        }
      />
      <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-[minmax(0,1fr)]">
        <ColorField
          label="Background"
          value={theme.surface}
          onChange={(surface) => onThemeChange((current) => ({ ...current, surface }))}
        />
        <ColorField
          label="Foreground"
          value={theme.ink}
          onChange={(ink) => onThemeChange((current) => ({ ...current, ink }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-[minmax(0,1fr)]">
        <TextField
          label="UI font"
          value={theme.fonts.ui}
          onChange={(ui) =>
            onThemeChange((current) => ({ ...current, fonts: { ...current.fonts, ui } }))
          }
        />
        <TextField
          label="Code font"
          value={theme.fonts.code}
          onChange={(code) =>
            onThemeChange((current) => ({ ...current, fonts: { ...current.fonts, code } }))
          }
        />
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-[minmax(0,1fr)]">
        <BooleanField
          checked={!theme.opaqueWindows}
          label="Translucent sidebar"
          onChange={(checked) =>
            onThemeChange((current) => ({ ...current, opaqueWindows: !checked }))
          }
        />
        <NumberField
          label="Contrast"
          max={100}
          min={0}
          onChange={(contrast) => onThemeChange((current) => ({ ...current, contrast }))}
          value={theme.contrast}
        />
      </div>
      <Separator />
      <div className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-[minmax(0,1fr)]">
        <ColorField
          label="Diff added"
          value={theme.semanticColors.diffAdded}
          onChange={(diffAdded) =>
            onThemeChange((current) => ({
              ...current,
              semanticColors: { ...current.semanticColors, diffAdded },
            }))
          }
        />
        <ColorField
          label="Diff removed"
          value={theme.semanticColors.diffRemoved}
          onChange={(diffRemoved) =>
            onThemeChange((current) => ({
              ...current,
              semanticColors: { ...current.semanticColors, diffRemoved },
            }))
          }
        />
        <ColorField
          label="Skill"
          value={theme.semanticColors.skill}
          onChange={(skill) =>
            onThemeChange((current) => ({
              ...current,
              semanticColors: { ...current.semanticColors, skill },
            }))
          }
        />
      </div>
    </section>
  )
}

function ThemePreview({
  codeFontSize,
  diffMarkerStyle,
  mode,
  sansFontSize,
  theme,
}: Readonly<{
  codeFontSize: number
  diffMarkerStyle: DiffMarkerStyle
  mode: ThemeMode
  sansFontSize: number
  theme: CodexChromeTheme
}>) {
  const markerAdded = diffMarkerStyle === "symbols" ? "++" : "+"
  const markerRemoved = diffMarkerStyle === "symbols" ? "--" : "-"

  return (
    <div
      className="grid gap-3 rounded-lg border p-3"
      style={{
        backgroundColor: theme.surface,
        borderColor: `color-mix(in srgb, ${theme.ink} 18%, ${theme.surface})`,
        color: theme.ink,
        fontSize: sansFontSize,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <strong className="font-semibold">Cypheria</strong>
          <span style={{ color: `color-mix(in srgb, ${theme.ink} 62%, ${theme.surface})` }}>
            {mode === "light" ? "Light" : "Dark"} workspace preview
          </span>
        </div>
        <span
          className="rounded-md px-2 py-1 text-xs font-semibold"
          style={{ backgroundColor: theme.accent, color: theme.surface }}
        >
          Aa
        </span>
      </div>
      <div
        className="grid gap-1 rounded-md border p-2 font-mono"
        style={{
          backgroundColor: `color-mix(in srgb, ${theme.ink} 7%, ${theme.surface})`,
          borderColor: `color-mix(in srgb, ${theme.ink} 16%, ${theme.surface})`,
          fontSize: codeFontSize,
        }}
      >
        <span style={{ color: theme.semanticColors.diffAdded }}>
          {markerAdded} connected wallet context
        </span>
        <span style={{ color: theme.semanticColors.diffRemoved }}>
          {markerRemoved} stale transaction plan
        </span>
        <span style={{ color: theme.semanticColors.skill }}>@skill policy-inspector</span>
      </div>
    </div>
  )
}

function CodeThemeField({
  mode,
  onChange,
  value,
}: Readonly<{
  mode: ThemeMode
  onChange: (value: CodexCodeThemeId) => void
  value: CodexCodeThemeId
}>) {
  const options = getCodexCodeThemeOptionsForMode(mode)
  const selectedValue = options.some((option) => option.id === value) ? value : options[0]?.id

  return (
    <SelectField
      label="Code theme"
      onChange={(value) => onChange(value as CodexCodeThemeId)}
      options={options.map((option) => ({ label: option.label, value: option.id }))}
      value={selectedValue}
    />
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

function SelectField({
  label,
  onChange,
  options,
  value,
}: Readonly<{
  label: string
  onChange: (value: string) => void
  options: readonly { readonly label: string; readonly value: string }[]
  value?: string
}>) {
  const id = useId()

  return (
    <div className="grid gap-[7px]">
      <label className="text-xs font-semibold text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function BooleanField({
  checked,
  label,
  onChange,
}: Readonly<{ checked: boolean; label: string; onChange: (value: boolean) => void }>) {
  return (
    <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold text-muted-foreground">
      <input
        checked={checked}
        className="accent-primary"
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      {label}
    </label>
  )
}

function NumberField({
  label,
  max,
  min,
  onChange,
  value,
}: Readonly<{
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}>) {
  const id = useId()

  return (
    <div className="grid gap-[7px]">
      <label className="text-xs font-semibold text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_74px] items-center gap-2">
        <input
          className="w-full accent-primary"
          id={id}
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          type="range"
          value={value}
        />
        <Input
          aria-label={`${label} value`}
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          type="number"
          value={value}
        />
      </div>
    </div>
  )
}

function ColorField({
  disabled,
  label,
  onChange,
  value,
}: Readonly<{
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  value: string
}>) {
  const id = useId()

  return (
    <div className="grid gap-[7px]">
      <label className="text-xs font-semibold text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-2">
        <input
          aria-label={`${label} swatch`}
          className="h-8 w-[38px] rounded-[7px] border border-border bg-background p-0.5 disabled:opacity-55"
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.currentTarget.value)}
          type="color"
          value={value}
        />
        <Input
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          value={value}
        />
      </div>
    </div>
  )
}

function TextField({
  label,
  onChange,
  value,
}: Readonly<{ label: string; onChange: (value: string) => void; value: string }>) {
  const id = useId()

  return (
    <div className="grid gap-[7px]">
      <label className="text-xs font-semibold text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <Input id={id} onChange={(event) => onChange(event.currentTarget.value)} value={value} />
    </div>
  )
}

const cloneTheme = (theme: CodexChromeTheme): CodexChromeTheme => ({
  ...theme,
  fonts: { ...theme.fonts },
  semanticColors: { ...theme.semanticColors },
})

const parseCodexThemeShare = (
  share: string
): { codeThemeId: CodexCodeThemeId; theme: CodexChromeTheme; variant: ThemeMode } | undefined => {
  const prefix = "codex-theme-v1:"
  const trimmed = share.trim()
  if (!trimmed.startsWith(prefix)) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed.slice(prefix.length))
    if (
      typeof parsed?.codeThemeId !== "string" ||
      (parsed.variant !== "light" && parsed.variant !== "dark") ||
      !getCodexCodeThemePresetVariant(parsed.codeThemeId, parsed.variant)
    ) {
      return undefined
    }
    if (!isCodexChromeTheme(parsed.theme)) {
      return undefined
    }
    return {
      codeThemeId: parsed.codeThemeId,
      theme: parsed.theme,
      variant: parsed.variant,
    }
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isCodexChromeTheme = (theme: unknown): theme is CodexChromeTheme =>
  isRecord(theme) &&
  typeof theme.accent === "string" &&
  (theme.accentSource === undefined ||
    theme.accentSource === "chatgpt" ||
    theme.accentSource === "custom") &&
  typeof theme.contrast === "number" &&
  isRecord(theme.fonts) &&
  typeof theme.fonts.code === "string" &&
  typeof theme.fonts.ui === "string" &&
  typeof theme.ink === "string" &&
  typeof theme.opaqueWindows === "boolean" &&
  isRecord(theme.semanticColors) &&
  typeof theme.semanticColors.diffAdded === "string" &&
  typeof theme.semanticColors.diffRemoved === "string" &&
  typeof theme.semanticColors.skill === "string" &&
  typeof theme.surface === "string"
