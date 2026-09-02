import {
  type CodexAppearanceThemeSettings,
  type CodexChromeTheme,
  type CodexCodeThemeId,
  type CodexFontFace,
  cn,
  defaultCodexAppearanceThemeSettings,
  getCodexCodeThemeOptionsForMode,
  getCodexCodeThemePresetVariant,
} from "@cypheria/ui"
import { Input } from "@cypheria/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check, CheckCircle2, ChevronDown, Monitor, Moon, Sun, X } from "lucide-react"
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useAppearance } from "../appearance.js"

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

type LocalFontFace = {
  readonly family: string
  readonly fullName?: string
  readonly postscriptName?: string
  readonly style?: string
}

type LocalFontOption = {
  readonly faces: readonly LocalFontFace[]
  readonly family: string
  readonly styles: readonly string[]
}

const appearanceModes = [
  { icon: Monitor, label: "System", value: "system" },
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
] as const

const fallbackAppearanceSettings = {
  theme: "system",
  lightThemeId: "codex",
  darkThemeId: "codex",
  lightTheme: defaultCodexAppearanceThemeSettings.light,
  darkTheme: defaultCodexAppearanceThemeSettings.dark,
  uiFontSize: 14,
  codeFontSize: 13,
  configPath: "Browser preview",
  diffMarkerStyle: "color",
  reducedMotionPreference: "system",
  useFontSmoothing: true,
  usePointerCursors: false,
} as const

const uiFontFaceClass =
  "[font-stretch:var(--font-sans-stretch)] [font-style:var(--font-sans-style)]"
const uiFontMediumClass = cn(uiFontFaceClass, "[font-weight:max(500,var(--font-sans-weight))]")
const uiFontSemiboldClass = cn(uiFontFaceClass, "[font-weight:max(600,var(--font-sans-weight))]")

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontFace[]>
  }
}

function AppearanceRoute() {
  const queryClient = useQueryClient()
  const { syncAppearance } = useAppearance()
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>("system")
  const [codeFontSize, setCodeFontSize] = useState(13)
  const [diffMarkerStyle, setDiffMarkerStyle] = useState<DiffMarkerStyle>("color")
  const [draftCodeThemes, setDraftCodeThemes] = useState<Record<
    ThemeMode,
    CodexCodeThemeId
  > | null>(null)
  const [draftThemes, setDraftThemes] = useState<CodexAppearanceThemeSettings | null>(null)
  const [reducedMotionPreference, setReducedMotionPreference] =
    useState<ReducedMotionPreference>("system")
  const [uiFontSize, setUiFontSize] = useState(14)
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
    setAppearanceMode(settings.theme)
    setCodeFontSize(settings.codeFontSize)
    setDiffMarkerStyle(settings.diffMarkerStyle)
    setDraftCodeThemes({ dark: settings.darkThemeId, light: settings.lightThemeId })
    setDraftThemes({ dark: settings.darkTheme, light: settings.lightTheme })
    setReducedMotionPreference(settings.reducedMotionPreference)
    setUiFontSize(settings.uiFontSize)
    setUseFontSmoothing(settings.useFontSmoothing)
    setUsePointerCursors(settings.usePointerCursors)
    syncAppearance(settings)
  }, [appearanceQuery.data, syncAppearance])

  const writeMutation = useMutation({
    mutationFn: (settings: {
      theme: AppearanceMode
      lightThemeId: CodexCodeThemeId
      darkThemeId: CodexCodeThemeId
      lightTheme: CodexChromeTheme
      darkTheme: CodexChromeTheme
      uiFontSize: number
      codeFontSize: number
      diffMarkerStyle: DiffMarkerStyle
      reducedMotionPreference: ReducedMotionPreference
      useFontSmoothing: boolean
      usePointerCursors: boolean
    }) =>
      window.cypheria?.settings.setAppearance(settings) ??
      Promise.resolve({
        ...settings,
        configPath: fallbackAppearanceSettings.configPath,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings", "appearance"], settings)
      setAppearanceMode(settings.theme)
      setCodeFontSize(settings.codeFontSize)
      setDiffMarkerStyle(settings.diffMarkerStyle)
      setDraftCodeThemes({ dark: settings.darkThemeId, light: settings.lightThemeId })
      setDraftThemes({ dark: settings.darkTheme, light: settings.lightTheme })
      setReducedMotionPreference(settings.reducedMotionPreference)
      setUiFontSize(settings.uiFontSize)
      setUseFontSmoothing(settings.useFontSmoothing)
      setUsePointerCursors(settings.usePointerCursors)
      syncAppearance(settings)
    },
  })

  const isDirty = useMemo(() => {
    if (!appearanceQuery.data || !draftCodeThemes || !draftThemes) {
      return false
    }

    return (
      JSON.stringify({
        theme: appearanceMode,
        lightThemeId: draftCodeThemes.light,
        darkThemeId: draftCodeThemes.dark,
        lightTheme: draftThemes.light,
        darkTheme: draftThemes.dark,
        uiFontSize,
        codeFontSize,
        diffMarkerStyle,
        reducedMotionPreference,
        useFontSmoothing,
        usePointerCursors,
      }) !==
      JSON.stringify({
        theme: appearanceQuery.data.theme,
        lightThemeId: appearanceQuery.data.lightThemeId,
        darkThemeId: appearanceQuery.data.darkThemeId,
        lightTheme: appearanceQuery.data.lightTheme,
        darkTheme: appearanceQuery.data.darkTheme,
        uiFontSize: appearanceQuery.data.uiFontSize,
        codeFontSize: appearanceQuery.data.codeFontSize,
        diffMarkerStyle: appearanceQuery.data.diffMarkerStyle,
        reducedMotionPreference: appearanceQuery.data.reducedMotionPreference,
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
    uiFontSize,
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
      return next
    })
  }

  const handleAppearanceModeChange = (mode: AppearanceMode) => {
    setAppearanceMode(mode)
  }

  const updateCodeTheme = (mode: ThemeMode, codeTheme: CodexCodeThemeId) => {
    const preset = getCodexCodeThemePresetVariant(codeTheme, mode)
    if (!preset) {
      return
    }

    setDraftCodeThemes((current) => (current ? { ...current, [mode]: codeTheme } : current))
    setDraftThemes((current) => {
      if (!current) {
        return current
      }

      const currentTheme = current[mode]
      const nextTheme = cloneTheme(preset.theme)
      return {
        ...current,
        [mode]: {
          ...nextTheme,
          accent: currentTheme.accentSource === "custom" ? currentTheme.accent : nextTheme.accent,
          accentSource: currentTheme.accentSource ?? nextTheme.accentSource,
        },
      }
    })
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

  useEffect(() => {
    if (!draftCodeThemes || !draftThemes) {
      return
    }
    if (!appearanceQuery.data || !isDirty || writeMutation.isPending) {
      return
    }

    const timeout = window.setTimeout(() => {
      writeMutation.mutate({
        theme: appearanceMode,
        lightThemeId: draftCodeThemes.light,
        darkThemeId: draftCodeThemes.dark,
        lightTheme: draftThemes.light,
        darkTheme: draftThemes.dark,
        uiFontSize,
        codeFontSize,
        diffMarkerStyle,
        reducedMotionPreference,
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
    uiFontSize,
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
        <h1 className={cn("text-[25px] leading-8 text-foreground", uiFontSemiboldClass)}>
          Appearance
        </h1>
      </header>

      <section className="grid gap-4">
        <h2 className={cn("text-sm text-foreground", uiFontSemiboldClass)}>Theme</h2>
        <ThemeModeCards value={appearanceMode} onChange={handleAppearanceModeChange} />
        <DiffPreview markerStyle={diffMarkerStyle} />
      </section>

      {draftThemes && draftCodeThemes ? (
        <section className="grid gap-5">
          {appearanceMode !== "dark" ? (
            <ChromeThemeCard
              codeTheme={draftCodeThemes.light}
              defaultAccent={getDefaultCodeThemeAccent(draftCodeThemes.light, "light")}
              mode="light"
              onCodeThemeChange={(value) => updateCodeTheme("light", value)}
              onCopy={() => copyTheme("light")}
              onImport={() => setImportDialogMode("light")}
              onThemeChange={(patch) => updateTheme("light", patch)}
              theme={draftThemes.light}
              title="Light theme"
            />
          ) : null}
          {appearanceMode !== "light" ? (
            <ChromeThemeCard
              codeTheme={draftCodeThemes.dark}
              defaultAccent={getDefaultCodeThemeAccent(draftCodeThemes.dark, "dark")}
              mode="dark"
              onCodeThemeChange={(value) => updateCodeTheme("dark", value)}
              onCopy={() => copyTheme("dark")}
              onImport={() => setImportDialogMode("dark")}
              onThemeChange={(patch) => updateTheme("dark", patch)}
              theme={draftThemes.dark}
              title="Dark theme"
            />
          ) : null}
        </section>
      ) : null}

      <section className="mt-6 grid gap-4">
        <h2 className={cn("text-sm text-foreground", uiFontSemiboldClass)}>Preferences</h2>
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
              <FontSizeInput max={16} min={11} onChange={setUiFontSize} value={uiFontSize} />
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
          <h2 className={cn("text-[28px] leading-9", uiFontSemiboldClass)}>Import theme</h2>
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
  defaultAccent,
  mode,
  onCodeThemeChange,
  onCopy,
  onImport,
  onThemeChange,
  theme,
  title,
}: Readonly<{
  codeTheme: CodexCodeThemeId
  defaultAccent: string
  mode: ThemeMode
  onCodeThemeChange: (value: CodexCodeThemeId) => void
  onCopy: () => void
  onImport: () => void
  onThemeChange: (patch: Partial<CodexChromeTheme>) => void
  theme: CodexChromeTheme
  title: string
}>) {
  const accentSource = theme.accentSource ?? "custom"

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground shadow-xs">
      <div className="flex min-h-[58px] items-center justify-between gap-3 border-b border-border px-4 py-2.5 max-sm:flex-col max-sm:items-stretch">
        <h2 className={cn("text-sm", uiFontSemiboldClass)}>{title}</h2>
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
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-lg border border-border text-xs font-semibold shadow-xs"
            )}
            style={{
              backgroundColor: mode === "dark" ? theme.surface : "#ffffff",
              color: theme.accent,
            }}
          >
            Aa
          </span>
          <CodeThemePicker mode={mode} onChange={onCodeThemeChange} value={codeTheme} />
        </div>
      </div>

      <div className="grid">
        <CompactSetting
          control={
            <AccentControl
              accent={theme.accent}
              accentSource={accentSource}
              defaultAccent={defaultAccent}
              mode={mode}
              onAccentChange={(accent) => onThemeChange({ accent, accentSource: "custom" })}
              onSourceChange={(source, accent) =>
                onThemeChange(accent ? { accent, accentSource: source } : { accentSource: source })
              }
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
              face={theme.fonts.uiFace}
              systemDefault={defaultCodexAppearanceThemeSettings[mode].fonts.ui}
              onChange={(ui, uiFace) => {
                const fonts = { ...theme.fonts, ui }
                if (uiFace) {
                  fonts.uiFace = uiFace
                } else {
                  delete fonts.uiFace
                }
                onThemeChange({ fonts })
              }}
              value={theme.fonts.ui}
            />
          }
          label="UI font"
        />
        <CompactSetting
          control={
            <FontFamilyControl
              face={theme.fonts.codeFace}
              monoOnly
              systemDefault={defaultCodexAppearanceThemeSettings[mode].fonts.code}
              onChange={(code, codeFace) => {
                const fonts = { ...theme.fonts, code }
                if (codeFace) {
                  fonts.codeFace = codeFace
                } else {
                  delete fonts.codeFace
                }
                onThemeChange({ fonts })
              }}
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

function useOutsidePointerDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void
) {
  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && ref.current?.contains(target)) {
        return
      }
      onDismiss()
    }

    document.addEventListener("pointerdown", handlePointerDown, true)
    return () => document.removeEventListener("pointerdown", handlePointerDown, true)
  }, [onDismiss, open, ref])
}

function ThemeModeCards({
  onChange,
  value,
}: Readonly<{ onChange: (mode: AppearanceMode) => void; value: AppearanceMode }>) {
  return (
    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
      {appearanceModes.map(({ label, value: mode }) => (
        <button
          aria-label={`Theme mode ${label}`}
          aria-pressed={value === mode}
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
          <span className={cn(value === mode && "text-foreground", uiFontMediumClass)}>
            {label}
          </span>
        </button>
      ))}
    </div>
  )
}

function ThemeModePreview({ mode }: Readonly<{ mode: AppearanceMode }>) {
  if (mode === "system") {
    return (
      <span className="absolute inset-0 block">
        <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-[200%]">
            <SingleThemeModePreview mode="light" />
          </span>
        </span>
        <span className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
          <span className="absolute inset-y-0 right-0 w-[200%]">
            <SingleThemeModePreview mode="dark" />
          </span>
        </span>
      </span>
    )
  }

  return <SingleThemeModePreview mode={mode} />
}

function SingleThemeModePreview({ mode }: Readonly<{ mode: ThemeMode }>) {
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
    <div className="grid overflow-hidden rounded-xl border border-border bg-card font-mono text-xs leading-[calc(var(--font-mono-size)*2)] shadow-xs">
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
        "grid min-h-7 grid-cols-[4px_34px_20px_minmax(0,1fr)] items-center",
        changed && color === "removed" && "bg-[#fde8e4]",
        changed && color === "added" && "bg-[#e6f4e8]"
      )}
    >
      <span
        className={cn(
          "h-full",
          changed && color === "removed" && "bg-[#ef2b2b]",
          changed && color === "added" && "bg-[#05a84f]"
        )}
      />
      <span
        className={cn(
          "text-right text-muted-foreground tabular-nums",
          changed && color === "removed" && "text-[#ef2b2b]",
          changed && color === "added" && "text-[#079b46]"
        )}
      >
        {line}
      </span>
      <span
        className={cn(
          "text-center text-muted-foreground",
          changed && color === "removed" && "text-[#ef2b2b]",
          changed && color === "added" && "text-[#079b46]"
        )}
      >
        {marker}
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
        <div className={cn("text-sm", uiFontMediumClass)}>{label}</div>
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
      <div className={cn("text-sm", uiFontMediumClass)}>{label}</div>
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
            "inline-flex h-[30px] min-w-[68px] items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-[13px] text-muted-foreground",
            uiFontMediumClass,
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
  const containerRef = useRef<HTMLDivElement>(null)
  const options = getCodexCodeThemeOptionsForMode(mode)
  const selectedValue = options.some((option) => option.id === value) ? value : options[0]?.id
  const selectedOption = options.find((option) => option.id === selectedValue)
  useOutsidePointerDismiss(containerRef, open, () => setOpen(false))

  return (
    <div className="relative" ref={containerRef}>
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
  defaultAccent,
  mode,
  onAccentChange,
  onSourceChange,
}: Readonly<{
  accent: string
  accentSource: "chatgpt" | "custom"
  defaultAccent: string
  mode: ThemeMode
  onAccentChange: (accent: string) => void
  onSourceChange: (source: "chatgpt" | "custom", accent?: string) => void
}>) {
  const options = getAccentOptions(mode, defaultAccent)
  const selectedPreset = options.find(
    (option) =>
      option.id !== "custom" && option.color && option.color.toLowerCase() === accent.toLowerCase()
  )
  const selectedLabel = accentSource === "custom" ? "Custom" : (selectedPreset?.label ?? "Default")
  const selectedValue = accentSource === "custom" ? "custom" : (selectedPreset?.id ?? "default")

  return (
    <div className="flex items-center justify-end gap-2 max-sm:justify-start">
      <Select
        onValueChange={(value) => {
          if (!value) {
            return
          }
          const option = options.find((item) => item.id === value)
          if (option?.id === "custom") {
            onSourceChange("custom")
            return
          }
          if (option?.color) {
            onSourceChange("chatgpt", option.color)
          }
        }}
        value={selectedValue}
      >
        <SelectTrigger
          aria-label={`${mode} accent source`}
          className="h-9 min-w-[102px] rounded-xl bg-background px-3 text-sm"
        >
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent
          align="end"
          alignItemWithTrigger={false}
          className="w-[250px] rounded-[22px] p-3"
        >
          {options.map((option) => (
            <SelectItem
              className="min-h-[42px] rounded-xl px-2 text-lg leading-none"
              key={option.id}
              value={option.id}
            >
              {option.color ? (
                <span
                  className="size-4 shrink-0 self-center rounded-full border border-black/10"
                  style={{ backgroundColor: option.color }}
                />
              ) : (
                <span className="size-4 shrink-0 self-center" />
              )}
              <span className="inline-flex min-h-5 items-center">{option.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {accentSource === "custom" ? (
        <ColorTextControl
          accent
          ariaLabel={`${mode} accent`}
          onChange={onAccentChange}
          value={accent}
        />
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
  { color: "#3a83f7", id: "blue", label: "Blue" },
  { color: "#4bb35f", id: "green", label: "Green" },
  { color: "#f3bd35", id: "yellow", label: "Yellow" },
  { color: "#e75d9e", id: "pink", label: "Pink" },
  { color: "#ed7434", id: "orange", label: "Orange" },
  { color: "#8147e8", id: "purple", label: "Purple" },
  { id: "custom", label: "Custom" },
]

const getAccentOptions = (mode: ThemeMode, defaultAccent: string): readonly AccentOption[] => [
  { color: defaultAccent, id: "default", label: "Default" },
  ...accentOptions.slice(0, -1),
  mode === "dark"
    ? { color: "#ffffff", id: "white", label: "White" }
    : { color: "#000000", id: "black", label: "Black" },
  accentOptions.at(-1) ?? { id: "custom", label: "Custom" },
]

const getDefaultCodeThemeAccent = (codeTheme: CodexCodeThemeId, mode: ThemeMode): string =>
  getCodexCodeThemePresetVariant(codeTheme, mode)?.theme.accent ??
  defaultCodexAppearanceThemeSettings[mode].accent

function ColorTextControl({
  accent = false,
  ariaLabel,
  onChange,
  value,
}: Readonly<{
  accent?: boolean
  ariaLabel: string
  onChange: (value: string) => void
  value: string
}>) {
  const [draft, setDraft] = useState(value.toUpperCase())
  const normalizedValue = isHexColor(value) ? value : "#000000"
  const foreground = getReadableTextColor(normalizedValue)

  useEffect(() => {
    setDraft(value.toUpperCase())
  }, [value])

  const commit = () => {
    const normalized = normalizeHexInput(draft)
    if (isHexColor(normalized)) {
      onChange(normalized.toLowerCase())
      return
    }
    setDraft(value.toUpperCase())
  }

  return (
    <div className="relative">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-2 shadow-xs max-sm:w-full",
          accent ? "h-9 w-[142px]" : "h-7 w-[8.5rem]"
        )}
        style={{ backgroundColor: normalizedValue, color: foreground }}
      >
        <label
          className={cn(
            "relative shrink-0 rounded-full border border-current opacity-40 outline-none focus-within:ring-2 focus-within:ring-ring",
            accent ? "size-4" : "size-3.5"
          )}
        >
          <span className="sr-only">{`${ariaLabel} color picker`}</span>
          <input
            aria-label={`${ariaLabel} color picker`}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            onChange={(event) => onChange(event.currentTarget.value.toLowerCase())}
            type="color"
            value={normalizedValue}
          />
        </label>
        <input
          aria-label={ariaLabel}
          className={cn(
            "min-w-0 flex-1 bg-transparent uppercase tabular-nums outline-none placeholder:text-current/50",
            accent ? "text-sm" : "text-xs"
          )}
          onBlur={commit}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur()
            }
            if (event.key === "Escape") {
              setDraft(value.toUpperCase())
              event.currentTarget.blur()
            }
          }}
          spellCheck={false}
          value={draft}
        />
      </div>
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
  face,
  monoOnly = false,
  onChange,
  systemDefault,
  value,
}: Readonly<{
  face?: CodexFontFace
  monoOnly?: boolean
  onChange: (value: string, face?: CodexFontFace) => void
  systemDefault: string
  value: string
}>) {
  const [fontOptions, loadFontOptions] = useLocalFontOptions()
  const [familyOpen, setFamilyOpen] = useState(false)
  const familyContainerRef = useRef<HTMLDivElement>(null)
  const options = useMemo(
    () => (monoOnly ? fontOptions.filter(isLikelyMonospaceFontOption) : fontOptions),
    [fontOptions, monoOnly]
  )
  const isSystemDefault = value === systemDefault && !face
  const selectedOption = isSystemDefault ? undefined : findSelectedFontOption(options, value, face)
  const selectedFamily = isSystemDefault
    ? "System default"
    : selectedOption?.family || face?.family || formatFontFamilyLabel(value)
  const selectedStyle = selectedOption
    ? getSelectedFontStyle(selectedOption, value, face)
    : "Regular"
  const styles = selectedOption?.styles ?? ["Regular"]
  useOutsidePointerDismiss(familyContainerRef, familyOpen, () => setFamilyOpen(false))

  return (
    <div className="flex items-center justify-end gap-2 max-sm:justify-start">
      <div className="relative" ref={familyContainerRef}>
        <button
          aria-expanded={familyOpen}
          aria-label="Font family"
          className="inline-flex h-8 w-40 items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm shadow-xs outline-none hover:bg-muted/50"
          onClick={() => {
            void loadFontOptions()
            setFamilyOpen((current) => !current)
          }}
          type="button"
        >
          <span className="min-w-0 truncate">{selectedFamily}</span>
          <ChevronDown aria-hidden="true" className="shrink-0 text-muted-foreground" size={15} />
        </button>
        {familyOpen ? (
          <div
            className="absolute right-0 top-9 z-40 max-h-[420px] w-[280px] overflow-y-auto rounded-[22px] border border-border bg-popover p-3 text-popover-foreground shadow-2xl"
            role="menu"
          >
            <button
              className="flex h-11 w-full items-center justify-between gap-3 rounded-xl px-2 text-left text-lg hover:bg-muted/70"
              onClick={() => {
                onChange(systemDefault)
                setFamilyOpen(false)
              }}
              role="menuitem"
              type="button"
            >
              <span className="min-w-0 truncate">System default</span>
              {isSystemDefault ? <Check aria-hidden="true" size={22} /> : null}
            </button>
            <div className="my-2 h-px bg-border" />
            {options.map((option) => (
              <button
                className="flex h-11 w-full items-center justify-between gap-3 rounded-xl px-2 text-left text-lg hover:bg-muted/70"
                key={option.family}
                onClick={() => {
                  const selection = getFontSelectionForStyle(
                    option,
                    getPreferredFontStyle(option.styles)
                  )
                  onChange(selection.family, selection.face)
                  setFamilyOpen(false)
                }}
                role="menuitem"
                type="button"
              >
                <span className="min-w-0 truncate">{option.family}</span>
                {!isSystemDefault && option.family === selectedFamily ? (
                  <Check aria-hidden="true" size={22} />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Select
        disabled={isSystemDefault || styles.length <= 1 || !selectedOption}
        onValueChange={(style) => {
          if (selectedOption && style) {
            const selection = getFontSelectionForStyle(selectedOption, style)
            onChange(selection.family, selection.face)
          }
        }}
        value={selectedStyle}
      >
        <SelectTrigger
          aria-label="Font style"
          className="h-8 w-28 rounded-lg bg-background px-3 text-sm disabled:bg-muted/35 disabled:text-muted-foreground"
        >
          <SelectValue>{selectedStyle}</SelectValue>
        </SelectTrigger>
        <SelectContent
          align="end"
          alignItemWithTrigger={false}
          className="w-[180px] rounded-[18px] p-2"
        >
          {styles.map((style) => (
            <SelectItem className="min-h-9 rounded-xl px-2 text-sm" key={style} value={style}>
              {style}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

const fallbackFontOptions: readonly LocalFontOption[] = [
  createFallbackFontOption("Academy Engraved LET", ["Regular"]),
  createFallbackFontOption("American Typewriter", [
    "Regular",
    "Light",
    "Semibold",
    "Bold",
    "Condensed",
  ]),
  createFallbackFontOption("Arial", ["Regular", "Bold", "Italic", "Bold Italic"]),
  createFallbackFontOption("Avenir", ["Book", "Roman", "Medium", "Heavy", "Black"]),
  createFallbackFontOption("Avenir Next", ["Regular", "Medium", "Demi Bold", "Bold", "Heavy"]),
  createFallbackFontOption("Baskerville", ["Regular", "Italic", "Semibold", "Bold"]),
  createFallbackFontOption("Big Caslon", ["Medium"]),
  createFallbackFontOption("Chalkboard SE", ["Regular", "Light", "Bold"]),
  createFallbackFontOption("Charter", ["Roman", "Italic", "Bold", "Black"]),
  createFallbackFontOption("Cochin", ["Regular", "Italic", "Bold", "Bold Italic"]),
  createFallbackFontOption("Copperplate", ["Regular", "Light", "Bold"]),
  createFallbackFontOption("Courier New", ["Regular", "Bold", "Italic", "Bold Italic"]),
  createFallbackFontOption("DIN Alternate", ["Bold"]),
  createFallbackFontOption("DIN Condensed", ["Bold"]),
  createFallbackFontOption("Didot", ["Regular", "Italic", "Bold"]),
  createFallbackFontOption("Futura", ["Medium", "Condensed Medium", "Condensed Extra Bold"]),
  createFallbackFontOption("Georgia", ["Regular", "Bold", "Italic", "Bold Italic"]),
  createFallbackFontOption("Gill Sans", ["Regular", "Light", "SemiBold", "Bold", "UltraBold"]),
  createFallbackFontOption("Helvetica Neue", ["Regular", "Bold", "Italic", "Bold Italic"]),
  createFallbackFontOption("Hoefler Text", ["Regular", "Italic", "Black"]),
  createFallbackFontOption("Iowan Old Style", ["Roman", "Italic", "Bold", "Black"]),
  createFallbackFontOption("Kohinoor Devanagari", ["Regular", "Medium", "Semibold"]),
  createFallbackFontOption("Menlo", ["Regular", "Bold", "Italic", "Bold Italic"]),
  createFallbackFontOption("Monaco", ["Regular"]),
  createFallbackFontOption("New York", ["Regular", "Medium", "Semibold", "Bold"]),
  createFallbackFontOption("Optima", ["Regular", "Italic", "Bold", "ExtraBlack"]),
  createFallbackFontOption("Palatino", ["Roman", "Italic", "Bold", "Bold Italic"]),
  createFallbackFontOption("Rockwell", ["Regular", "Italic", "Bold", "Bold Italic"]),
  createFallbackFontOption("SF Mono", ["Regular", "Medium", "Semibold", "Bold"]),
  createFallbackFontOption("SF Pro", ["Regular", "Medium", "Semibold", "Bold"]),
  createFallbackFontOption("SF Pro Display", ["Regular", "Medium", "Semibold", "Bold"]),
  createFallbackFontOption("SF Pro Text", ["Regular", "Medium", "Semibold", "Bold"]),
  createFallbackFontOption("SF UI Display", ["Regular", "Medium", "Semibold", "Bold"]),
  createFallbackFontOption("SF UI Text", ["Regular", "Medium", "Semibold", "Bold"]),
  createFallbackFontOption("Snell Roundhand", ["Regular", "Bold", "Black"]),
  createFallbackFontOption("Times New Roman", ["Regular", "Bold", "Italic", "Bold Italic"]),
  createFallbackFontOption("Verdana", ["Regular", "Bold", "Italic", "Bold Italic"]),
]

function useLocalFontOptions(): readonly [readonly LocalFontOption[], () => Promise<void>] {
  const [options, setOptions] = useState(fallbackFontOptions)
  const [hasLoaded, setHasLoaded] = useState(false)

  const loadFontOptions = useCallback(async () => {
    if (hasLoaded) {
      return
    }

    try {
      const ipcFonts = await window.cypheria?.settings.listAppearanceFonts()
      if (ipcFonts && ipcFonts.length > 0) {
        setOptions(ipcFonts)
        setHasLoaded(true)
        return
      }

      if (!window.queryLocalFonts) {
        setHasLoaded(true)
        return
      }

      const fonts = await window.queryLocalFonts()
      const byFamily = new Map<string, LocalFontFace[]>()
      for (const font of fonts) {
        const family = font.family?.trim()
        if (!family) {
          continue
        }
        const faces = byFamily.get(family) ?? []
        faces.push({
          family,
          fullName: font.fullName?.trim(),
          postscriptName: font.postscriptName?.trim(),
          style: font.style?.trim() || "Regular",
        })
        byFamily.set(family, faces)
      }

      const next = Array.from(byFamily.entries())
        .map(([family, faces]) => ({
          faces: faces.sort((first, second) =>
            compareFontStyles(normalizeFontStyle(first.style), normalizeFontStyle(second.style))
          ),
          family,
          styles: uniqueFontStyles(faces),
        }))
        .sort((first, second) => first.family.localeCompare(second.family))

      if (next.length > 0) {
        setOptions(next)
        setHasLoaded(true)
      }
    } catch {
      setOptions(fallbackFontOptions)
      setHasLoaded(true)
    }
  }, [hasLoaded])

  return [options, loadFontOptions]
}

function createFallbackFontOption(family: string, styles: readonly string[]): LocalFontOption {
  return {
    faces: styles.map((style) => ({
      family,
      fullName: style === "Regular" ? family : `${family} ${style}`,
      style,
    })),
    family,
    styles,
  }
}

function uniqueFontStyles(faces: readonly LocalFontFace[]): readonly string[] {
  const styles = Array.from(new Set(faces.map((face) => normalizeFontStyle(face.style))))
  return styles.sort(compareFontStyles)
}

function normalizeFontStyle(style: string | undefined): string {
  const normalized = style?.trim()
  return normalized ? normalized : "Regular"
}

function compareFontStyles(first: string, second: string): number {
  const preferredOrder = ["Regular", "Medium", "Semibold", "Bold", "Italic", "Bold Italic"]
  const firstIndex = preferredOrder.indexOf(first)
  const secondIndex = preferredOrder.indexOf(second)
  if (firstIndex !== -1 || secondIndex !== -1) {
    return (
      (firstIndex === -1 ? Number.MAX_SAFE_INTEGER : firstIndex) -
      (secondIndex === -1 ? Number.MAX_SAFE_INTEGER : secondIndex)
    )
  }
  return first.localeCompare(second)
}

function getPreferredFontStyle(styles: readonly string[]): string {
  if (styles.includes("Regular")) {
    return "Regular"
  }
  return styles[0] ?? "Regular"
}

function getSelectedFontStyle(
  option: LocalFontOption,
  value: string,
  face?: CodexFontFace
): string {
  const normalizedValue = face?.fullName ?? face?.postscriptName ?? formatFontFamilyLabel(value)
  const selected =
    option.faces.find((face) =>
      [face.fullName, face.postscriptName].some((name) => name && normalizedValue === name)
    ) ?? option.faces.find((face) => face.family === normalizedValue)
  if (selected) {
    return normalizeFontStyle(selected.style)
  }
  return getPreferredFontStyle(option.styles)
}

function findSelectedFontOption(
  options: readonly LocalFontOption[],
  value: string,
  face?: CodexFontFace
): LocalFontOption | undefined {
  const normalizedValue = face?.family ?? formatFontFamilyLabel(value)
  return options.find(
    (option) =>
      option.family === normalizedValue ||
      option.faces.some((face) =>
        [face.fullName, face.postscriptName].some((name) => name && name === normalizedValue)
      )
  )
}

function getFontSelectionForStyle(
  option: LocalFontOption,
  style: string
): { family: string; face?: CodexFontFace } {
  const face =
    option.faces.find((candidate) => normalizeFontStyle(candidate.style) === style) ??
    option.faces[0]
  const family = face?.family || option.family
  const selectedStyle = normalizeFontStyle(face?.style)
  if (face && selectedStyle !== "Regular") {
    return {
      face: {
        family,
        ...(face.fullName ? { fullName: face.fullName } : {}),
        ...(face.postscriptName ? { postscriptName: face.postscriptName } : {}),
      },
      family: quoteFontFamily(family),
    }
  }
  return { family: quoteFontFamily(family) }
}

function quoteFontFamily(family: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(family) ? family : JSON.stringify(family)
}

function formatFontFamilyLabel(value: string): string {
  const [firstFamily] = value.split(",")
  return firstFamily?.trim().replace(/^["']|["']$/g, "") || "Custom"
}

const monospaceFontNamePattern =
  /\b(mono|monospace|code|console|terminal|typewriter|courier|menlo|monaco|consolas|sfmono|sf mono|cascadia|jetbrains|iosevka|hack|inconsolata|fira code|source code|roboto mono|space mono|ibm plex mono)\b/i

function isLikelyMonospaceFontOption(option: LocalFontOption): boolean {
  if (
    monospaceFontNamePattern.test(option.family) ||
    option.faces.some((face) =>
      [face.family, face.fullName, face.postscriptName].some(
        (name) => name && monospaceFontNamePattern.test(name)
      )
    )
  ) {
    return true
  }

  if (typeof document === "undefined") {
    return false
  }

  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) {
    return false
  }

  context.font = `16px ${quoteFontFamily(option.family)}`
  const narrow = context.measureText("iiiiiiii").width
  const wide = context.measureText("WWWWWWWW").width
  const digits = context.measureText("00000000").width
  return Math.abs(narrow - wide) < 0.5 && Math.abs(digits - wide) < 0.5
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

const isCodexFontFace = (face: unknown): face is CodexFontFace =>
  isRecord(face) &&
  typeof face.family === "string" &&
  (face.fullName === undefined || typeof face.fullName === "string") &&
  (face.postscriptName === undefined || typeof face.postscriptName === "string")

const isCodexChromeTheme = (theme: unknown): theme is CodexChromeTheme =>
  isRecord(theme) &&
  typeof theme.accent === "string" &&
  (theme.accentSource === undefined ||
    theme.accentSource === "chatgpt" ||
    theme.accentSource === "custom") &&
  typeof theme.contrast === "number" &&
  isRecord(theme.fonts) &&
  typeof theme.fonts.code === "string" &&
  (theme.fonts.codeFace === undefined || isCodexFontFace(theme.fonts.codeFace)) &&
  typeof theme.fonts.ui === "string" &&
  (theme.fonts.uiFace === undefined || isCodexFontFace(theme.fonts.uiFace)) &&
  typeof theme.ink === "string" &&
  typeof theme.opaqueWindows === "boolean" &&
  isRecord(theme.semanticColors) &&
  typeof theme.semanticColors.diffAdded === "string" &&
  typeof theme.semanticColors.diffRemoved === "string" &&
  typeof theme.semanticColors.skill === "string" &&
  typeof theme.surface === "string"

const isHexColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value)

const normalizeHexInput = (value: string): string => {
  const trimmed = value.trim()
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed}`
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`
  }
  return trimmed
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
