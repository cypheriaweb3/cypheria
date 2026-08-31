import {
  type CodexAppearanceThemeSettings,
  type CodexChromeTheme,
  type CodexCodeThemeId,
  cn,
  codexCodeThemePresets,
  defaultCodexAppearanceThemeSettings,
  getCodexCodeThemeOptionsForMode,
  getCodexCodeThemePresetVariant,
  mapCodexAppearanceToCypheriaThemeState,
  useCypheriaTheme,
} from "@cypheria/ui"
import { Button } from "@cypheria/ui/components/button"
import { Input } from "@cypheria/ui/components/input"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check, ChevronDown, Copy, Import, Monitor, Moon, RotateCcw, Save, Sun } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"

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
  const [expandedTheme, setExpandedTheme] = useState<ThemeMode | null>("light")
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

  const updateTheme = (mode: ThemeMode, patch: Partial<CodexChromeTheme>) => {
    setDraftThemes((current) => {
      if (!current) {
        return current
      }

      const next = {
        ...current,
        [mode]: {
          ...current[mode],
          ...patch,
          fonts: patch.fonts ?? current[mode].fonts,
          semanticColors: patch.semanticColors ?? current[mode].semanticColors,
        },
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
    updateTheme(mode, cloneTheme(preset.theme))
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
    updateTheme(mode, cloneTheme(parsed.theme))
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

  const previewTheme = (mode: ThemeMode) => {
    setPreviewMode(mode)
    setMode(mode)
    if (draftThemes) {
      setThemeState(mapCodexAppearanceToCypheriaThemeState(draftThemes, mode))
    }
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
    <main className="mx-auto grid w-full max-w-3xl content-start gap-6 px-5 py-8 text-foreground">
      <header className="flex min-w-0 items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-7 text-foreground">Appearance</h1>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {appearanceQuery.data?.configPath ?? "Loading config"}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
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

      <SettingsGroup>
        <SettingsRow
          control={
            <SegmentedControl
              items={appearanceModes.map(({ icon, label, value }) => ({ icon, label, value }))}
              onChange={(value) => handleAppearanceModeChange(value as AppearanceMode)}
              value={appearanceMode}
            />
          }
          label="Theme"
        />
        {draftThemes && draftCodeThemes ? (
          <>
            <ChromeThemeRow
              codeTheme={draftCodeThemes.light}
              expanded={expandedTheme === "light"}
              mode="light"
              onCodeThemeChange={(value) => updateCodeTheme("light", value)}
              onCopy={() => copyTheme("light")}
              onExpand={() => setExpandedTheme((current) => (current === "light" ? null : "light"))}
              onImport={() => importTheme("light")}
              onPreview={() => previewTheme("light")}
              onThemeChange={(patch) => updateTheme("light", patch)}
              previewing={previewMode === "light"}
              theme={draftThemes.light}
              title="Light theme"
            />
            <ChromeThemeRow
              codeTheme={draftCodeThemes.dark}
              expanded={expandedTheme === "dark"}
              mode="dark"
              onCodeThemeChange={(value) => updateCodeTheme("dark", value)}
              onCopy={() => copyTheme("dark")}
              onExpand={() => setExpandedTheme((current) => (current === "dark" ? null : "dark"))}
              onImport={() => importTheme("dark")}
              onPreview={() => previewTheme("dark")}
              onThemeChange={(patch) => updateTheme("dark", patch)}
              previewing={previewMode === "dark"}
              theme={draftThemes.dark}
              title="Dark theme"
            />
          </>
        ) : null}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          control={
            <SegmentedControl
              items={[
                { label: "Color", value: "color" },
                { label: "+/-", value: "symbols" },
              ]}
              onChange={(value) => setDiffMarkerStyle(value as DiffMarkerStyle)}
              value={diffMarkerStyle}
            />
          }
          label="Diff markers"
        />
        <SettingsRow
          control={
            <FontSizeControl max={16} min={11} onChange={setSansFontSize} value={sansFontSize} />
          }
          description="Sans"
          label="UI font size"
        />
        <SettingsRow
          control={
            <FontSizeControl max={24} min={8} onChange={setCodeFontSize} value={codeFontSize} />
          }
          label="Code font size"
        />
      </SettingsGroup>

      {writeMutation.isError ? (
        <p className="text-[13px] text-destructive">{String(writeMutation.error.message)}</p>
      ) : null}
    </main>
  )
}

function ChromeThemeRow({
  codeTheme,
  expanded,
  mode,
  onCodeThemeChange,
  onCopy,
  onExpand,
  onImport,
  onPreview,
  onThemeChange,
  previewing,
  theme,
  title,
}: Readonly<{
  codeTheme: CodexCodeThemeId
  expanded: boolean
  mode: ThemeMode
  onCodeThemeChange: (value: CodexCodeThemeId) => void
  onCopy: () => void
  onExpand: () => void
  onImport: () => void
  onPreview: () => void
  onThemeChange: (patch: Partial<CodexChromeTheme>) => void
  previewing: boolean
  theme: CodexChromeTheme
  title: string
}>) {
  const accentSource = theme.accentSource ?? "custom"

  return (
    <div className="border-t border-border first:border-t-0">
      <div className="flex min-h-[52px] items-center justify-between gap-4 py-2.5">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={onExpand}
          type="button"
        >
          <ThemeSwatch theme={theme} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {labelForCodeTheme(codeTheme)}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("text-muted-foreground transition-transform", expanded && "rotate-180")}
            size={16}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            aria-label={`Import ${mode} theme`}
            onClick={onImport}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Import aria-hidden="true" size={14} strokeWidth={1.9} />
            Import
          </Button>
          <Button
            aria-label={`Copy ${mode} theme`}
            onClick={onCopy}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Copy aria-hidden="true" size={14} strokeWidth={1.9} />
            Copy theme
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="grid gap-3 pb-4 pl-9 max-sm:pl-0">
          <div className="flex flex-wrap items-center gap-2">
            <CodeThemePicker
              mode={mode}
              onChange={onCodeThemeChange}
              theme={theme}
              value={codeTheme}
            />
            <Button
              onClick={onPreview}
              size="sm"
              type="button"
              variant={previewing ? "secondary" : "outline"}
            >
              {previewing ? "Previewing" : "Preview"}
            </Button>
          </div>

          <div className="grid gap-2 rounded-lg bg-muted/45 p-2.5">
            <CompactSetting
              control={
                <AccentControl
                  accent={theme.accent}
                  accentSource={accentSource}
                  mode={mode}
                  onAccentChange={(accent) => onThemeChange({ accent, accentSource: "custom" })}
                  onSourceChange={(source) => onThemeChange({ accentSource: source })}
                />
              }
              label="Accent"
            />
            <CompactSetting
              control={
                <ColorTextControl
                  ariaLabel={`${mode} background`}
                  onChange={(surface) => onThemeChange({ surface })}
                  value={theme.surface}
                />
              }
              label="Background"
            />
            <CompactSetting
              control={
                <ColorTextControl
                  ariaLabel={`${mode} foreground`}
                  onChange={(ink) => onThemeChange({ ink })}
                  value={theme.ink}
                />
              }
              label="Foreground"
            />
            <CompactSetting
              control={
                <ToggleControl
                  checked={!theme.opaqueWindows}
                  onChange={(checked) => onThemeChange({ opaqueWindows: !checked })}
                />
              }
              label="Translucent sidebar"
            />
            <CompactSetting
              control={
                <ContrastControl
                  onChange={(contrast) => onThemeChange({ contrast })}
                  theme={theme}
                />
              }
              label="Contrast"
            />
            <CompactSetting
              control={
                <FontFamilyControl
                  onChange={(ui) => onThemeChange({ fonts: { ...theme.fonts, ui } })}
                  value={theme.fonts.ui}
                />
              }
              label="UI font"
            />
            <CompactSetting
              control={
                <FontFamilyControl
                  onChange={(code) => onThemeChange({ fonts: { ...theme.fonts, code } })}
                  value={theme.fonts.code}
                />
              }
              label="Code font"
            />
            <CompactSetting
              control={
                <ColorTextControl
                  ariaLabel={`${mode} diff added`}
                  onChange={(diffAdded) =>
                    onThemeChange({
                      semanticColors: { ...theme.semanticColors, diffAdded },
                    })
                  }
                  value={theme.semanticColors.diffAdded}
                />
              }
              label="Diff added"
            />
            <CompactSetting
              control={
                <ColorTextControl
                  ariaLabel={`${mode} diff removed`}
                  onChange={(diffRemoved) =>
                    onThemeChange({
                      semanticColors: { ...theme.semanticColors, diffRemoved },
                    })
                  }
                  value={theme.semanticColors.diffRemoved}
                />
              }
              label="Diff removed"
            />
            <CompactSetting
              control={
                <ColorTextControl
                  ariaLabel={`${mode} skill`}
                  onChange={(skill) =>
                    onThemeChange({
                      semanticColors: { ...theme.semanticColors, skill },
                    })
                  }
                  value={theme.semanticColors.skill}
                />
              }
              label="Skill"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SettingsGroup({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <section className="rounded-xl border border-border bg-card px-4 text-card-foreground shadow-xs">
      {children}
    </section>
  )
}

function SettingsRow({
  control,
  description,
  label,
}: Readonly<{ control: ReactNode; description?: string; label: string }>) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 border-t border-border py-2.5 first:border-t-0 max-sm:flex-col max-sm:items-stretch">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {control}
    </div>
  )
}

function CompactSetting({ control, label }: Readonly<{ control: ReactNode; label: string }>) {
  return (
    <div className="grid min-h-9 grid-cols-[minmax(120px,1fr)_minmax(180px,auto)] items-center gap-3 max-sm:grid-cols-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="justify-self-end max-sm:justify-self-stretch">{control}</div>
    </div>
  )
}

function SegmentedControl({
  items,
  onChange,
  value,
}: Readonly<{
  items: readonly {
    readonly icon?: typeof Monitor
    readonly label: string
    readonly value: string
  }[]
  onChange: (value: string) => void
  value: string
}>) {
  return (
    <div className="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted p-[3px]">
      {items.map(({ icon: Icon, label, value: itemValue }) => (
        <button
          aria-pressed={value === itemValue}
          className={cn(
            "inline-flex h-[30px] min-w-[68px] items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-[13px] font-medium text-muted-foreground",
            value === itemValue && "bg-background text-foreground shadow-sm"
          )}
          key={itemValue}
          onClick={() => onChange(itemValue)}
          type="button"
        >
          {Icon ? <Icon aria-hidden="true" size={14} strokeWidth={1.9} /> : null}
          {label}
        </button>
      ))}
    </div>
  )
}

function CodeThemePicker({
  mode,
  onChange,
  theme,
  value,
}: Readonly<{
  mode: ThemeMode
  onChange: (value: CodexCodeThemeId) => void
  theme: CodexChromeTheme
  value: CodexCodeThemeId
}>) {
  const options = getCodexCodeThemeOptionsForMode(mode)
  const selectedValue = options.some((option) => option.id === value) ? value : options[0]?.id

  return (
    <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2 text-xs shadow-xs">
      <span className="sr-only">{mode} code theme</span>
      <ThemeSwatch theme={theme} />
      <select
        aria-label={`${mode} code theme`}
        className="min-w-[9rem] bg-transparent text-sm outline-none"
        onChange={(event) => onChange(event.currentTarget.value as CodexCodeThemeId)}
        value={selectedValue}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function AccentControl({
  accent,
  accentSource,
  mode,
  onAccentChange,
  onSourceChange,
}: Readonly<{
  accent: string
  accentSource: "chatgpt" | "custom"
  mode: ThemeMode
  onAccentChange: (accent: string) => void
  onSourceChange: (source: "chatgpt" | "custom") => void
}>) {
  return (
    <div className="flex items-center justify-end gap-2 max-sm:justify-start">
      <SegmentedControl
        items={[
          { label: "Default", value: "chatgpt" },
          { label: "Custom", value: "custom" },
        ]}
        onChange={(value) => onSourceChange(value as "chatgpt" | "custom")}
        value={accentSource}
      />
      <ColorTextControl
        ariaLabel={`${mode} accent`}
        disabled={accentSource === "chatgpt"}
        onChange={onAccentChange}
        value={accent}
      />
    </div>
  )
}

function ColorTextControl({
  ariaLabel,
  disabled,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string
  disabled?: boolean
  onChange: (value: string) => void
  value: string
}>) {
  const foreground = getReadableTextColor(value)

  return (
    <label
      className="flex h-7 w-[8.5rem] items-center gap-2 rounded-lg px-2 text-xs shadow-xs max-sm:w-full"
      style={{ backgroundColor: value, color: foreground }}
    >
      <input
        aria-label={`${ariaLabel} color`}
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-current bg-transparent p-0 disabled:opacity-55"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        type="color"
        value={value}
      />
      <input
        aria-label={ariaLabel}
        className="min-w-0 flex-1 bg-transparent uppercase tabular-nums outline-none disabled:cursor-default"
        disabled={disabled}
        onChange={(event) => {
          const next = normalizeHexInput(event.currentTarget.value)
          if (isHexColor(next)) {
            onChange(next.toLowerCase())
          }
        }}
        spellCheck={false}
        value={value.toUpperCase()}
      />
    </label>
  )
}

function ContrastControl({
  onChange,
  theme,
}: Readonly<{ onChange: (value: number) => void; theme: CodexChromeTheme }>) {
  return (
    <div className="flex h-9 min-w-[12rem] items-center gap-2.5 max-sm:min-w-0">
      <input
        aria-label="Contrast"
        className="h-0.5 flex-1 accent-primary"
        max={100}
        min={0}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{
          background: `linear-gradient(90deg, color-mix(in srgb, ${theme.accent} 35%, ${theme.surface}) 0%, ${theme.accent} 32%, ${theme.accent} 100%)`,
        }}
        type="range"
        value={theme.contrast}
      />
      <span className="w-9 text-end text-sm tabular-nums">{theme.contrast}</span>
    </div>
  )
}

function FontSizeControl({
  max,
  min,
  onChange,
  value,
}: Readonly<{ max: number; min: number; onChange: (value: number) => void; value: number }>) {
  return (
    <div className="flex h-8 items-center gap-2">
      <input
        className="h-0.5 w-36 accent-primary max-sm:w-full"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        type="range"
        value={value}
      />
      <Input
        aria-label="Font size"
        className="h-8 w-16 text-center text-sm tabular-nums"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        type="number"
        value={value}
      />
      <span className="text-xs text-muted-foreground">px</span>
    </div>
  )
}

function FontFamilyControl({
  onChange,
  value,
}: Readonly<{ onChange: (value: string) => void; value: string }>) {
  return (
    <Input
      className="h-8 w-[16rem] max-sm:w-full"
      onChange={(event) => onChange(event.currentTarget.value)}
      value={value}
    />
  )
}

function ToggleControl({
  checked,
  onChange,
}: Readonly<{ checked: boolean; onChange: (value: boolean) => void }>) {
  return (
    <button
      aria-pressed={checked}
      className={cn(
        "relative h-5 w-9 rounded-full border border-border bg-muted transition-colors",
        checked && "border-primary bg-primary"
      )}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
          checked && "translate-x-4"
        )}
      />
    </button>
  )
}

function ThemeSwatch({
  theme,
}: Readonly<{ theme: Pick<CodexChromeTheme, "accent" | "ink" | "surface"> }>) {
  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 grid-cols-2 overflow-hidden rounded-full border border-border shadow-xs"
      style={{ backgroundColor: theme.surface }}
    >
      <span style={{ backgroundColor: theme.accent }} />
      <span style={{ backgroundColor: theme.ink }} />
      <span className="col-span-2" style={{ backgroundColor: theme.surface }} />
    </span>
  )
}

const cloneTheme = (theme: CodexChromeTheme): CodexChromeTheme => ({
  ...theme,
  fonts: { ...theme.fonts },
  semanticColors: { ...theme.semanticColors },
})

const labelForCodeTheme = (id: CodexCodeThemeId): string =>
  codexCodeThemePresets.find((preset) => preset.id === id)?.label ?? id

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
      !getCodexCodeThemePresetVariant(parsed.codeThemeId, parsed.variant) ||
      !isCodexChromeTheme(parsed.theme)
    ) {
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

const isHexColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value)

const normalizeHexInput = (value: string): string => {
  const hex = value
    .toUpperCase()
    .replace(/[^0-9A-F#]/g, "")
    .replaceAll("#", "")
  return hex.length === 0 ? "#" : `#${hex.slice(0, 6)}`
}

function getReadableTextColor(value: string): string {
  if (!isHexColor(value)) {
    return "#101010"
  }

  const red = Number.parseInt(value.slice(1, 3), 16)
  const green = Number.parseInt(value.slice(3, 5), 16)
  const blue = Number.parseInt(value.slice(5, 7), 16)
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255 > 0.62 ? "#101010" : "#ffffff"
}
