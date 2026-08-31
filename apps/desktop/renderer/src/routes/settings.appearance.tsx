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
import { Check, CheckCircle2, ChevronDown, Monitor, Moon, Sun, X } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceRoute,
})

type ThemeMode = keyof CodexAppearanceThemeSettings
type AppearanceMode = "dark" | "light" | "system"
type DiffMarkerStyle = "color" | "symbols"
type ReducedMotionPreference = "off" | "on" | "system"

type ToastState = {
  readonly message: string
  readonly id: number
}

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
  const [importDialogMode, setImportDialogMode] = useState<ThemeMode | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
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

  const applyImportedTheme = (mode: ThemeMode, rawTheme: string): boolean => {
    const parsed = parseCodexThemeShare(rawTheme)
    if (!parsed || parsed.variant !== mode) {
      return false
    }

    setDraftCodeThemes((current) =>
      current ? { ...current, [mode]: parsed.codeThemeId } : current
    )
    updateTheme(mode, cloneTheme(parsed.theme))
    setImportDialogMode(null)
    return true
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
    setToast({
      id: Date.now(),
      message: `${mode === "light" ? "Light" : "Dark"} theme copied`,
    })
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

  useEffect(() => {
    if (!toast) {
      return
    }

    const timeout = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timeout)
  }, [toast])

  return (
    <main className="mx-auto grid h-full min-h-0 w-full max-w-[872px] content-start gap-6 overflow-y-auto px-5 py-12 pb-20 text-foreground">
      {toast ? <Toast message={toast.message} onClose={() => setToast(null)} /> : null}
      {importDialogMode ? (
        <ImportThemeDialog
          mode={importDialogMode}
          onClose={() => setImportDialogMode(null)}
          onImport={(rawTheme) => applyImportedTheme(importDialogMode, rawTheme)}
        />
      ) : null}
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
            onImport={() => setImportDialogMode("light")}
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
            onImport={() => setImportDialogMode("dark")}
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

function Toast({ message, onClose }: Readonly<{ message: string; onClose: () => void }>) {
  return (
    <div className="fixed right-8 top-6 z-50 flex h-14 items-center gap-3 rounded-2xl border border-green-200 bg-green-50/95 px-5 text-lg text-green-300 shadow-lg backdrop-blur">
      <CheckCircle2 aria-hidden="true" size={20} strokeWidth={1.8} />
      <span>{message}</span>
      <button
        aria-label="Close toast"
        className="ml-1 text-green-300 hover:text-green-500"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={20} strokeWidth={1.8} />
      </button>
    </div>
  )
}

function ImportThemeDialog({
  mode,
  onClose,
  onImport,
}: Readonly<{
  mode: ThemeMode
  onClose: () => void
  onImport: (rawTheme: string) => boolean
}>) {
  const [rawTheme, setRawTheme] = useState("")
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!onImport(rawTheme)) {
      setError(`Paste a valid codex-theme-v1 ${mode} theme.`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/10 px-5 backdrop-blur-[1px]">
      <section className="w-full max-w-[560px] rounded-[28px] border border-border bg-popover p-6 text-popover-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[28px] font-semibold leading-9">Import theme</h2>
          <button
            aria-label="Close import theme"
            className="mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={22} strokeWidth={1.9} />
          </button>
        </div>
        <Input
          aria-label="Codex theme payload"
          autoFocus
          className="mt-8 h-10 rounded-xl px-4 text-base"
          onChange={(event) => {
            setRawTheme(event.currentTarget.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submit()
            }
            if (event.key === "Escape") {
              onClose()
            }
          }}
          placeholder='codex-theme-v1:{"codeThemeId":"codex","theme":{"accent":"#...'
          value={rawTheme}
        />
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-5">
          <button
            className="h-10 rounded-xl px-3 text-lg text-muted-foreground hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-xl bg-muted-foreground px-4 text-lg text-background disabled:opacity-45"
            disabled={!rawTheme.trim()}
            onClick={submit}
            type="button"
          >
            Import theme
          </button>
        </div>
      </section>
    </div>
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
    <section className="rounded-xl border border-border bg-card text-card-foreground shadow-xs">
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
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-lg border border-border text-xs font-semibold shadow-xs",
              previewing && "ring-2 ring-foreground/20"
            )}
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
    <div className="grid overflow-hidden rounded-xl border border-border bg-card font-mono text-[14px] leading-7 shadow-xs">
      <div className="grid grid-cols-2">
        <div>
          <CodeLine line="1">
            <CodePreviewSource />
          </CodeLine>
          <CodeLine changed color="removed" line="2" marker={removed}>
            <span className="pl-8">
              <CodeKey>surface</CodeKey>
              <CodePunctuation>: </CodePunctuation>
              <CodeString>"sidebar"</CodeString>
              <CodePunctuation>,</CodePunctuation>
            </span>
          </CodeLine>
          <CodeLine changed color="removed" line="3" marker={removed}>
            <span className="pl-8">
              <CodeKey>accent</CodeKey>
              <CodePunctuation>: </CodePunctuation>
              <CodeString>"#2563eb"</CodeString>
              <CodePunctuation>,</CodePunctuation>
            </span>
          </CodeLine>
          <CodeLine changed color="removed" line="4" marker={removed}>
            <span className="pl-8">
              <CodeKey>contrast</CodeKey>
              <CodePunctuation>: </CodePunctuation>
              <CodeNumber>42</CodeNumber>
              <CodePunctuation>,</CodePunctuation>
            </span>
          </CodeLine>
          <CodeLine line="5">
            <CodePunctuation>{"};"}</CodePunctuation>
          </CodeLine>
        </div>
        <div>
          <CodeLine line="1">
            <CodePreviewSource />
          </CodeLine>
          <CodeLine changed color="added" line="2" marker={added}>
            <span className="pl-8">
              <CodeKey>surface</CodeKey>
              <CodePunctuation>: </CodePunctuation>
              <CodeString>"sidebar-elevated"</CodeString>
              <CodePunctuation>,</CodePunctuation>
            </span>
          </CodeLine>
          <CodeLine changed color="added" line="3" marker={added}>
            <span className="pl-8">
              <CodeKey>accent</CodeKey>
              <CodePunctuation>: </CodePunctuation>
              <CodeString>"#0ea5e9"</CodeString>
              <CodePunctuation>,</CodePunctuation>
            </span>
          </CodeLine>
          <CodeLine changed color="added" line="4" marker={added}>
            <span className="pl-8">
              <CodeKey>contrast</CodeKey>
              <CodePunctuation>: </CodePunctuation>
              <CodeNumber>68</CodeNumber>
              <CodePunctuation>,</CodePunctuation>
            </span>
          </CodeLine>
          <CodeLine line="5">
            <CodePunctuation>{"};"}</CodePunctuation>
          </CodeLine>
        </div>
      </div>
    </div>
  )
}

function CodeLine({
  children,
  changed,
  color,
  line,
  marker = "",
}: Readonly<{
  children: ReactNode
  changed?: boolean
  color?: "added" | "removed"
  line: string
  marker?: string
}>) {
  return (
    <div
      className={cn(
        "grid min-h-7 grid-cols-[64px_minmax(0,1fr)]",
        changed && color === "removed" && "border-l-4 border-[#ef2b2b] bg-[#fde8e4]",
        changed && color === "added" && "border-l-4 border-[#05a84f] bg-[#e6f4e8]"
      )}
    >
      <span
        className={cn(
          "text-center text-muted-foreground",
          changed && color === "removed" && "text-[#ef2b2b]",
          changed && color === "added" && "text-[#079b46]"
        )}
      >
        {marker ? `${line} ${marker}` : line}
      </span>
      <span className="truncate text-foreground">{children}</span>
    </div>
  )
}

function CodePreviewSource() {
  return (
    <>
      <CodeKeyword>const</CodeKeyword>
      <span> </span>
      <CodeKey>themePreview</CodeKey>
      <CodePunctuation>: </CodePunctuation>
      <CodeType>ThemeConfig</CodeType>
      <span> </span>
      <CodeOperator>=</CodeOperator>
      <span> </span>
      <CodePunctuation>{"{"}</CodePunctuation>
    </>
  )
}

function CodeKeyword({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-[#7c3cff]">{children}</span>
}

function CodeKey({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-[#c45a00]">{children}</span>
}

function CodeType({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-[#8b2cff]">{children}</span>
}

function CodeOperator({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-[#0a6fff]">{children}</span>
}

function CodeString({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-[#008a14]">{children}</span>
}

function CodeNumber({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-[#006fff]">{children}</span>
}

function CodePunctuation({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-[#666666]">{children}</span>
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
  const [open, setOpen] = useState(false)
  const options = getCodexCodeThemeOptionsForMode(mode)
  const selectedValue = options.some((option) => option.id === value) ? value : options[0]?.id
  const selectedOption = options.find((option) => option.id === selectedValue)

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={`${mode} code theme`}
        className="inline-flex h-8 min-w-[10rem] items-center justify-between gap-3 rounded-lg border border-border bg-muted/55 px-3 text-sm shadow-xs outline-none hover:bg-muted"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selectedOption?.label ?? "Codex"}</span>
        <ChevronDown aria-hidden="true" className="text-muted-foreground" size={16} />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-9 z-30 max-h-[420px] w-[300px] overflow-y-auto rounded-[22px] border border-border bg-popover p-3 text-popover-foreground shadow-2xl"
          role="menu"
        >
          {options.map((option) => {
            const preset = getCodexCodeThemePresetVariant(option.id, mode)
            if (!preset) {
              return null
            }

            return (
              <button
                className="flex h-[54px] w-full items-center gap-3 rounded-xl px-2 text-left text-lg hover:bg-muted/70"
                key={option.id}
                onClick={() => {
                  onChange(option.id)
                  setOpen(false)
                }}
                role="menuitem"
                type="button"
              >
                <ThemeSampleBadge mode={mode} theme={preset.theme} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.id === selectedValue ? (
                  <Check aria-hidden="true" className="text-foreground" size={22} />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const selectedLabel = accentSource === "chatgpt" ? "Blue" : "Custom"

  return (
    <div className="flex items-center justify-end gap-2 max-sm:justify-start">
      <div className="relative">
        <button
          aria-expanded={menuOpen}
          aria-label={`${mode} accent source`}
          className="inline-flex h-9 min-w-[102px] items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 text-sm shadow-xs hover:bg-muted/50"
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          {selectedLabel}
          <ChevronDown aria-hidden="true" className="text-muted-foreground" size={16} />
        </button>
        {menuOpen ? (
          <div
            className="absolute right-0 top-10 z-40 w-[250px] rounded-[22px] border border-border bg-popover p-3 text-popover-foreground shadow-2xl"
            role="menu"
          >
            {accentOptions.map((option) => {
              const selected =
                (option.id === "blue" && accentSource === "chatgpt") ||
                (option.id === "custom" && accentSource === "custom")

              return (
                <button
                  className="flex h-[42px] w-full items-center gap-3 rounded-xl px-2 text-left text-lg hover:bg-muted/70"
                  key={option.id}
                  onClick={() => {
                    if (option.id === "blue") {
                      onSourceChange("chatgpt")
                    } else if (option.id === "custom") {
                      onSourceChange("custom")
                      setPickerOpen(true)
                    } else if (option.color) {
                      onSourceChange("custom")
                      onAccentChange(option.color)
                    }
                    setMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {option.color ? (
                    <span
                      className="size-4 rounded-full border border-black/10"
                      style={{ backgroundColor: option.color }}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1">{option.label}</span>
                  {selected ? <Check aria-hidden="true" size={19} /> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      {accentSource === "custom" ? (
        <div className="relative">
          <button
            aria-expanded={pickerOpen}
            className="flex h-9 w-[142px] items-center gap-2 rounded-xl px-3 text-sm shadow-xs"
            onClick={() => setPickerOpen((current) => !current)}
            style={{ backgroundColor: accent, color: getReadableTextColor(accent) }}
            type="button"
          >
            <span className="size-4 rounded-full border border-current opacity-40" />
            <span className="uppercase tabular-nums">{accent}</span>
          </button>
          {pickerOpen ? (
            <ColorPickerPopover
              onChange={onAccentChange}
              onClose={() => setPickerOpen(false)}
              value={accent}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

type AccentOption = {
  readonly color?: string
  readonly id: string
  readonly label: string
}

const accentOptions: readonly AccentOption[] = [
  { color: "#000000", id: "default", label: "Default" },
  { color: "#3a83f7", id: "blue", label: "Blue" },
  { color: "#4bb35f", id: "green", label: "Green" },
  { color: "#f3bd35", id: "yellow", label: "Yellow" },
  { color: "#e75d9e", id: "pink", label: "Pink" },
  { color: "#ed7434", id: "orange", label: "Orange" },
  { color: "#8147e8", id: "purple", label: "Purple" },
  { color: "#000000", id: "black", label: "Black" },
  { id: "custom", label: "Custom" },
]

function ColorTextControl({
  ariaLabel,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string
  onChange: (value: string) => void
  value: string
}>) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const foreground = getReadableTextColor(value)

  return (
    <div className="relative">
      <button
        aria-expanded={pickerOpen}
        aria-label={`${ariaLabel} color picker`}
        className="flex h-7 w-[8.5rem] items-center gap-2 rounded-lg px-2 text-xs shadow-xs max-sm:w-full"
        onClick={() => setPickerOpen((current) => !current)}
        style={{ backgroundColor: value, color: foreground }}
        type="button"
      >
        <span className="size-3.5 shrink-0 rounded-full border border-current opacity-40" />
        <span className="uppercase tabular-nums">{value}</span>
      </button>
      {pickerOpen ? (
        <ColorPickerPopover
          onChange={onChange}
          onClose={() => setPickerOpen(false)}
          value={value}
        />
      ) : null}
    </div>
  )
}

function ColorPickerPopover({
  onChange,
  onClose,
  value,
}: Readonly<{ onChange: (value: string) => void; onClose: () => void; value: string }>) {
  return (
    <div className="absolute right-0 top-10 z-40 w-[238px] rounded-xl border border-border bg-popover p-1.5 shadow-2xl">
      <button aria-label="Close color picker" className="sr-only" onClick={onClose} type="button" />
      <label className="relative block h-[205px] overflow-hidden rounded-lg">
        <span
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, #ffffff 0%, transparent 48%), linear-gradient(180deg, transparent 0%, #000000 100%), linear-gradient(90deg, #ccd7ea 0%, #1465f2 100%)",
          }}
        />
        <input
          aria-label="Custom color"
          className="absolute inset-0 size-full cursor-crosshair opacity-0"
          onChange={(event) => onChange(event.currentTarget.value)}
          type="color"
          value={value}
        />
        <span className="absolute right-[42px] top-0 size-7 rounded-full border-[3px] border-white shadow-md" />
      </label>
      <label className="relative mt-1.5 block h-8 overflow-hidden rounded-b-lg">
        <span
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
          }}
        />
        <input
          aria-label="Custom hue"
          className="absolute inset-0 size-full opacity-0"
          onChange={(event) => onChange(event.currentTarget.value)}
          type="color"
          value={value}
        />
        <span className="absolute left-[145px] top-0 size-8 rounded-full border-[3px] border-white shadow-md" />
      </label>
    </div>
  )
}

function ThemeSampleBadge({ mode, theme }: Readonly<{ mode: ThemeMode; theme: CodexChromeTheme }>) {
  return (
    <span
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-base font-semibold shadow-xs"
      style={{
        backgroundColor: mode === "dark" ? theme.surface : "#ffffff",
        color: theme.accent,
      }}
    >
      Aa
    </span>
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

function getReadableTextColor(value: string): string {
  if (!isHexColor(value)) {
    return "#101010"
  }

  const red = Number.parseInt(value.slice(1, 3), 16)
  const green = Number.parseInt(value.slice(3, 5), 16)
  const blue = Number.parseInt(value.slice(5, 7), 16)
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255 > 0.62 ? "#101010" : "#ffffff"
}
