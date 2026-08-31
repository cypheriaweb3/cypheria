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
import { Input } from "@cypheria/ui/components/input"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Monitor, Moon, Sun } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceRoute,
})

type ThemeMode = keyof CodexAppearanceThemeSettings
type AppearanceMode = "dark" | "light" | "system"
type DiffMarkerStyle = "color" | "symbols"
type ReducedMotionPreference = "off" | "on" | "system"

const appearanceModes = [
  { icon: Monitor, label: "System", value: "system" },
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
] as const

const fallbackAppearanceSettings = {
  appearanceTheme: "system",
  codeFontSize: 13,
  codeThemes: {
    dark: "codex",
    light: "codex",
  },
  configPath: "Browser preview",
  diffMarkerStyle: "color",
  reducedMotionPreference: "system",
  sansFontSize: 14,
  themes: defaultCodexAppearanceThemeSettings,
  useFontSmoothing: true,
  usePointerCursors: false,
} as const

function AppearanceRoute() {
  const queryClient = useQueryClient()
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
  const [reducedMotionPreference, setReducedMotionPreference] =
    useState<ReducedMotionPreference>("system")
  const [sansFontSize, setSansFontSize] = useState(14)
  const [useFontSmoothing, setUseFontSmoothing] = useState(true)
  const [usePointerCursors, setUsePointerCursors] = useState(false)

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
    setReducedMotionPreference(settings.reducedMotionPreference)
    setSansFontSize(settings.sansFontSize)
    setUseFontSmoothing(settings.useFontSmoothing)
    setUsePointerCursors(settings.usePointerCursors)
    setThemeState(mapCodexAppearanceToCypheriaThemeState(settings.themes, previewMode))
  }, [appearanceQuery.data, previewMode, setThemeState])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--cypheria-sans-font-size", `${sansFontSize}px`)
    root.style.setProperty("--cypheria-code-font-size", `${codeFontSize}px`)
    root.dataset.cypheriaFontSmoothing = String(useFontSmoothing)
    root.dataset.cypheriaPointerCursors = String(usePointerCursors)

    if (reducedMotionPreference === "system") {
      delete root.dataset.cypheriaReducedMotion
      return
    }

    root.dataset.cypheriaReducedMotion = reducedMotionPreference
  }, [codeFontSize, reducedMotionPreference, sansFontSize, useFontSmoothing, usePointerCursors])

  const writeMutation = useMutation({
    mutationFn: (settings: {
      appearanceTheme: AppearanceMode
      codeFontSize: number
      codeThemes: Record<ThemeMode, CodexCodeThemeId>
      diffMarkerStyle: DiffMarkerStyle
      reducedMotionPreference: ReducedMotionPreference
      sansFontSize: number
      themes: CodexAppearanceThemeSettings
      useFontSmoothing: boolean
      usePointerCursors: boolean
    }) =>
      window.cypheria?.settings.setAppearance(settings) ??
      Promise.reject(new Error("IPC unavailable")),
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings", "appearance"], settings)
      setAppearanceMode(settings.appearanceTheme)
      setCodeFontSize(settings.codeFontSize)
      setDiffMarkerStyle(settings.diffMarkerStyle)
      setDraftCodeThemes(settings.codeThemes)
      setDraftThemes(settings.themes)
      setReducedMotionPreference(settings.reducedMotionPreference)
      setSansFontSize(settings.sansFontSize)
      setUseFontSmoothing(settings.useFontSmoothing)
      setUsePointerCursors(settings.usePointerCursors)
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
        reducedMotionPreference,
        sansFontSize,
        themes: draftThemes,
        useFontSmoothing,
        usePointerCursors,
      }) !==
      JSON.stringify({
        appearanceTheme: appearanceQuery.data.appearanceTheme,
        codeFontSize: appearanceQuery.data.codeFontSize,
        codeThemes: appearanceQuery.data.codeThemes,
        diffMarkerStyle: appearanceQuery.data.diffMarkerStyle,
        reducedMotionPreference: appearanceQuery.data.reducedMotionPreference,
        sansFontSize: appearanceQuery.data.sansFontSize,
        themes: appearanceQuery.data.themes,
        useFontSmoothing: appearanceQuery.data.useFontSmoothing,
        usePointerCursors: appearanceQuery.data.usePointerCursors,
      })
    )
  }, [
    appearanceMode,
    appearanceQuery.data,
    codeFontSize,
    diffMarkerStyle,
    draftCodeThemes,
    draftThemes,
    reducedMotionPreference,
    sansFontSize,
    useFontSmoothing,
    usePointerCursors,
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

  useEffect(() => {
    if (!draftCodeThemes || !draftThemes) {
      return
    }
    if (!appearanceQuery.data || !isDirty || writeMutation.isPending) {
      return
    }

    const timeout = window.setTimeout(() => {
      writeMutation.mutate({
        appearanceTheme: appearanceMode,
        codeFontSize,
        codeThemes: draftCodeThemes,
        diffMarkerStyle,
        reducedMotionPreference,
        sansFontSize,
        themes: draftThemes,
        useFontSmoothing,
        usePointerCursors,
      })
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [
    appearanceMode,
    appearanceQuery.data,
    codeFontSize,
    diffMarkerStyle,
    draftCodeThemes,
    draftThemes,
    isDirty,
    reducedMotionPreference,
    sansFontSize,
    useFontSmoothing,
    usePointerCursors,
    writeMutation,
  ])

  return (
    <main className="mx-auto grid h-full min-h-0 w-full max-w-[872px] content-start gap-6 overflow-y-auto px-5 py-12 pb-20 text-foreground">
      <header className="min-w-0">
        <h1 className="text-[25px] font-semibold leading-8 text-foreground">Appearance</h1>
      </header>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold text-foreground">Theme</h2>
        <ThemeModeCards value={appearanceMode} onChange={handleAppearanceModeChange} />
        <DiffPreview markerStyle={diffMarkerStyle} />
      </section>

      {draftThemes && draftCodeThemes ? (
        <section className="grid gap-5">
          <ChromeThemeCard
            codeTheme={draftCodeThemes.light}
            mode="light"
            onCodeThemeChange={(value) => updateCodeTheme("light", value)}
            onCopy={() => copyTheme("light")}
            onImport={() => importTheme("light")}
            onPreview={() => previewTheme("light")}
            onThemeChange={(patch) => updateTheme("light", patch)}
            previewing={previewMode === "light"}
            theme={draftThemes.light}
            title="Light theme"
          />
          <ChromeThemeCard
            codeTheme={draftCodeThemes.dark}
            mode="dark"
            onCodeThemeChange={(value) => updateCodeTheme("dark", value)}
            onCopy={() => copyTheme("dark")}
            onImport={() => importTheme("dark")}
            onPreview={() => previewTheme("dark")}
            onThemeChange={(patch) => updateTheme("dark", patch)}
            previewing={previewMode === "dark"}
            theme={draftThemes.dark}
            title="Dark theme"
          />
        </section>
      ) : null}

      <section className="mt-6 grid gap-4">
        <h2 className="text-sm font-semibold text-foreground">Preferences</h2>
        <SettingsGroup>
          <SettingsRow
            control={<ToggleControl checked={usePointerCursors} onChange={setUsePointerCursors} />}
            description="Change the cursor to a pointer when hovering over interactive elements"
            label="Use pointer cursors"
          />
          <SettingsRow
            control={
              <SegmentedControl
                items={[
                  { label: "System", value: "system" },
                  { label: "On", value: "on" },
                  { label: "Off", value: "off" },
                ]}
                onChange={(value) => setReducedMotionPreference(value as ReducedMotionPreference)}
                value={reducedMotionPreference}
              />
            }
            description="Reduce animations or match your system"
            label="Reduce motion"
          />
          <SettingsRow
            control={
              <FontSizeInput max={16} min={11} onChange={setSansFontSize} value={sansFontSize} />
            }
            description="Adjust the base size used for the Cypheria UI"
            label="UI font size"
          />
          <SettingsRow
            control={
              <FontSizeInput max={24} min={8} onChange={setCodeFontSize} value={codeFontSize} />
            }
            description="Adjust the base size used for code across chats and diffs"
            label="Code font size"
          />
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
            description="Show changes using colors or +/- markers"
            label="Diff markers"
          />
          <SettingsRow
            control={<ToggleControl checked={useFontSmoothing} onChange={setUseFontSmoothing} />}
            description="Use native macOS font anti-aliasing"
            label="Font smoothing"
          />
        </SettingsGroup>
      </section>

      {writeMutation.isError ? (
        <p className="text-[13px] text-destructive">{String(writeMutation.error.message)}</p>
      ) : null}
    </main>
  )
}

function ChromeThemeCard({
  codeTheme,
  mode,
  onCodeThemeChange,
  onCopy,
  onImport,
  onPreview,
  onThemeChange,
  previewing,
  theme,
  title,
}: Readonly<{
  codeTheme: CodexCodeThemeId
  mode: ThemeMode
  onCodeThemeChange: (value: CodexCodeThemeId) => void
  onCopy: () => void
  onImport: () => void
  onPreview: () => void
  onThemeChange: (patch: Partial<CodexChromeTheme>) => void
  previewing: boolean
  theme: CodexChromeTheme
  title: string
}>) {
  const accentSource = theme.accentSource ?? "custom"

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs">
      <div className="flex min-h-[58px] items-center justify-between gap-3 border-b border-border px-4 py-2.5 max-sm:flex-col max-sm:items-stretch">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
          <button
            aria-label={`Import ${mode} theme`}
            className="h-8 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
            onClick={onImport}
            type="button"
          >
            Import
          </button>
          <button
            aria-label={`Copy ${mode} theme`}
            className="h-8 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
            onClick={onCopy}
            type="button"
          >
            Copy theme
          </button>
          <button
            aria-pressed={previewing}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-xs font-semibold"
            onClick={onPreview}
            style={{
              backgroundColor: mode === "dark" ? theme.surface : "#ffffff",
              color: theme.accent,
            }}
            type="button"
          >
            Aa
          </button>
          <CodeThemePicker mode={mode} onChange={onCodeThemeChange} value={codeTheme} />
        </div>
      </div>

      <div className="grid">
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
            <FontFamilyControl
              systemDefault={defaultCodexAppearanceThemeSettings[mode].fonts.ui}
              onChange={(ui) => onThemeChange({ fonts: { ...theme.fonts, ui } })}
              value={theme.fonts.ui}
            />
          }
          label="UI font"
        />
        <CompactSetting
          control={
            <FontFamilyControl
              systemDefault={defaultCodexAppearanceThemeSettings[mode].fonts.code}
              onChange={(code) => onThemeChange({ fonts: { ...theme.fonts, code } })}
              value={theme.fonts.code}
            />
          }
          label="Code font"
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
            <ContrastControl onChange={(contrast) => onThemeChange({ contrast })} theme={theme} />
          }
          label="Contrast"
        />
      </div>
    </section>
  )
}

function SettingsGroup({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <section className="rounded-xl border border-border bg-card px-4 text-card-foreground shadow-xs">
      {children}
    </section>
  )
}

function ThemeModeCards({
  onChange,
  value,
}: Readonly<{ onChange: (mode: AppearanceMode) => void; value: AppearanceMode }>) {
  return (
    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
      {appearanceModes.map(({ label, value: mode }) => (
        <button
          className="grid gap-2 text-center text-sm text-muted-foreground"
          key={mode}
          onClick={() => onChange(mode)}
          type="button"
        >
          <span
            className={cn(
              "relative h-[112px] overflow-hidden rounded-xl border border-border bg-muted transition",
              value === mode && "border-foreground shadow-[0_0_0_1px_var(--foreground)]"
            )}
          >
            <ThemeModePreview mode={mode} />
          </span>
          <span className={cn(value === mode && "font-medium text-foreground")}>{label}</span>
        </button>
      ))}
    </div>
  )
}

function ThemeModePreview({ mode }: Readonly<{ mode: AppearanceMode }>) {
  if (mode === "system") {
    return (
      <span className="absolute inset-0 grid grid-cols-2">
        <ThemeModePreview mode="light" />
        <ThemeModePreview mode="dark" />
      </span>
    )
  }

  const dark = mode === "dark"
  return (
    <span className={cn("absolute inset-0 block", dark ? "bg-[#5f5f5d]" : "bg-[#f4f4f3]")}>
      <span
        className={cn(
          "absolute inset-x-7 top-12 h-16 rounded-t-xl",
          dark ? "bg-[#f8f8f5]" : "bg-white"
        )}
      />
      <span className="absolute left-11 right-11 top-[58px] h-1.5 rounded-full bg-black/15" />
      <span className="absolute left-11 top-[78px] h-2 w-16 rounded-full bg-black/15" />
      <span className="absolute left-11 top-[96px] h-2 w-20 rounded-full bg-black/12" />
      <span className="absolute left-11 top-[105px] h-0.5 w-24 rounded-full bg-black/10" />
      <span className="absolute left-1/2 top-[22px] h-2 w-20 -translate-x-1/2 rounded-full bg-black/20" />
      <span className="absolute left-1/2 top-[32px] h-1 w-28 -translate-x-1/2 rounded-full bg-black/15" />
    </span>
  )
}

function DiffPreview({ markerStyle }: Readonly<{ markerStyle: DiffMarkerStyle }>) {
  const removed = markerStyle === "symbols" ? "-" : ""
  const added = markerStyle === "symbols" ? "+" : ""

  return (
    <div className="grid overflow-hidden rounded-xl border border-border bg-card font-mono text-[13px] leading-7 shadow-xs">
      <div className="grid grid-cols-2">
        <div className="border-r border-border">
          <CodeLine line="1" text="const themePreview: ThemeConfig = {" />
          <CodeLine changed color="removed" line="2" marker={removed} text='surface: "sidebar",' />
          <CodeLine changed color="removed" line="3" marker={removed} text='accent: "#2563eb",' />
          <CodeLine changed color="removed" line="4" marker={removed} text="contrast: 42," />
          <CodeLine line="5" text="};" />
        </div>
        <div>
          <CodeLine line="1" text="const themePreview: ThemeConfig = {" />
          <CodeLine
            changed
            color="added"
            line="2"
            marker={added}
            text='surface: "sidebar-elevated",'
          />
          <CodeLine changed color="added" line="3" marker={added} text='accent: "#0ea5e9",' />
          <CodeLine changed color="added" line="4" marker={added} text="contrast: 68," />
          <CodeLine line="5" text="};" />
        </div>
      </div>
    </div>
  )
}

function CodeLine({
  changed,
  color,
  line,
  marker = "",
  text,
}: Readonly<{
  changed?: boolean
  color?: "added" | "removed"
  line: string
  marker?: string
  text: string
}>) {
  return (
    <div
      className={cn(
        "grid grid-cols-[48px_24px_minmax(0,1fr)]",
        changed && color === "removed" && "bg-red-500/12",
        changed && color === "added" && "bg-green-500/12"
      )}
    >
      <span className="text-center text-muted-foreground">{line}</span>
      <span
        className={cn(
          color === "removed" && "text-diff-removed",
          color === "added" && "text-diff-added"
        )}
      >
        {marker}
      </span>
      <span className="truncate text-foreground">{text}</span>
    </div>
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
    <div className="grid min-h-[56px] grid-cols-[minmax(120px,1fr)_minmax(180px,auto)] items-center gap-3 border-t border-border px-4 py-2 first:border-t-0 max-sm:grid-cols-1">
      <div className="text-sm font-medium">{label}</div>
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
  value,
}: Readonly<{
  mode: ThemeMode
  onChange: (value: CodexCodeThemeId) => void
  value: CodexCodeThemeId
}>) {
  const options = getCodexCodeThemeOptionsForMode(mode)
  const selectedValue = options.some((option) => option.id === value) ? value : options[0]?.id

  return (
    <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-muted/55 px-2 text-xs shadow-xs">
      <span className="sr-only">{mode} code theme</span>
      <select
        aria-label={`${mode} code theme`}
        className="min-w-[10rem] bg-transparent text-sm outline-none"
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
      <select
        aria-label={`${mode} accent source`}
        className="h-8 rounded-lg border border-border bg-background px-3 text-sm outline-none"
        onChange={(event) => onSourceChange(event.currentTarget.value as "chatgpt" | "custom")}
        value={accentSource}
      >
        <option value="chatgpt">Blue</option>
        <option value="custom">Custom</option>
      </select>
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

function FontSizeInput({
  max,
  min,
  onChange,
  value,
}: Readonly<{ max: number; min: number; onChange: (value: number) => void; value: number }>) {
  return (
    <div className="flex h-8 items-center gap-2">
      <Input
        aria-label="Font size"
        className="h-8 w-[68px] rounded-lg text-center text-sm tabular-nums"
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.currentTarget.value)
          if (Number.isFinite(next)) {
            onChange(Math.min(max, Math.max(min, next)))
          }
        }}
        type="number"
        value={value}
      />
      <span className="text-xs text-muted-foreground">px</span>
    </div>
  )
}

function FontFamilyControl({
  onChange,
  systemDefault,
  value,
}: Readonly<{ onChange: (value: string) => void; systemDefault: string; value: string }>) {
  const isSystemDefault = value === systemDefault

  return (
    <div className="flex items-center justify-end gap-2 max-sm:justify-start">
      <select
        aria-label="Font family"
        className="h-8 w-36 rounded-lg border border-border bg-background px-3 text-sm outline-none"
        onChange={(event) => {
          if (event.currentTarget.value === "system") {
            onChange(systemDefault)
            return
          }
          const custom = window.prompt("Custom font family", value)
          if (custom?.trim()) {
            onChange(custom.trim())
          }
        }}
        value={isSystemDefault ? "system" : "custom"}
      >
        <option value="system">System default</option>
        <option value="custom">Custom</option>
      </select>
      <select
        aria-label="Font style"
        className="h-8 w-28 rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground outline-none"
        disabled
        value="regular"
      >
        <option value="regular">Regular</option>
      </select>
    </div>
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
