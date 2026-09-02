# Theme System

Cypheria follows the Codex Desktop appearance model as the user-facing source of
truth, then projects that smaller configuration surface onto Tailwind v4 and
shadcn CSS variables at runtime. Users do not edit every shadcn token directly.
They edit Codex-compatible appearance fields in the Cypheria-managed Codex config
at `$CYPHERIA_HOME/codex/config.toml`, and the renderer derives the wider shadcn
token set from those fields.

## Configuration Source

The `[desktop]` section stores appearance-level preferences:

- `appearanceTheme`: `system`, `light`, or `dark`.
- `appearanceLightCodeThemeId` and `appearanceDarkCodeThemeId`: the selected
  code theme preset IDs for light and dark.
- `appearanceDiffMarkerStyle`: `color` or `symbols`.
- `reduced-motion-preference`: `system`, `on`, or `off`.
- `sansFontSize` and `codeFontSize`.
- `useFontSmoothing` and `usePointerCursors`.

The `desktop.appearanceLightChromeTheme` and
`desktop.appearanceDarkChromeTheme` sections store the editable light and dark
chrome themes:

- `surface`: the main background surface.
- `ink`: the main foreground text color.
- `accent`: the primary accent color.
- `accentSource`: `chatgpt` or `custom`.
- `contrast`: a numeric contrast control used to derive secondary surfaces,
  borders, and washes.
- `opaqueWindows`: the inverse of the UI's translucent-sidebar preference.
- `fonts`: UI and code font family strings, plus optional structured
  `uiFace`/`codeFace` metadata.
- `semanticColors`: `diffAdded`, `diffRemoved`, and `skill`.

Electron main owns reading and writing these TOML keys through typed IPC. It
preserves unrelated config and replaces only the managed `[desktop]` appearance
keys and managed chrome theme sections.

Cypheria's `AppearanceSettings` deliberately uses concise application-facing
names while the TOML adapter preserves the original Codex names:

| `AppearanceSettings` | Codex config |
| --- | --- |
| `theme` | `appearanceTheme` |
| `lightThemeId` | `appearanceLightCodeThemeId` |
| `darkThemeId` | `appearanceDarkCodeThemeId` |
| `lightTheme` | `desktop.appearanceLightChromeTheme` |
| `darkTheme` | `desktop.appearanceDarkChromeTheme` |
| `uiFontSize` | `sansFontSize` |

## Runtime Flow

Before creating the main window, Electron main reads the appearance config and
uses it to configure native theme integration, the initial window background,
title-bar colors, and Chromium's default UI/code font sizes. The serialized
appearance is passed to preload as a bootstrap argument and exposed through the
typed preload API. The renderer applies that bootstrap value before React
hydration and uses it as the initial value of an in-memory Jotai atom. It then
refreshes the same atom over IPC. Theme and preference hooks are derived from
this single appearance state; localStorage is not used.

`appearanceTheme = "system"` is resolved in the renderer with
`prefers-color-scheme`; the active mode is updated when the system preference
changes. Tailwind and shadcn only receive the resolved mode through the root
`.dark` class, `color-scheme`, CSS variables, and a small set of data attributes.

Codex-compatible preset themes are immutable built-in `codex-theme-v1` payloads.
Choosing a preset copies the preset chrome theme into the editable light or dark
TOML section and records the matching code theme ID in `[desktop]`. Later user
edits mutate the TOML-backed editable theme, not the preset definition.

## shadcn Token Mapping

The renderer maps each Codex chrome theme into shadcn-compatible CSS variables:

| Codex field | shadcn / Cypheria target |
| --- | --- |
| `surface` | `--background`, `--card`, `--popover` |
| `ink` | `--foreground`, `--card-foreground`, `--popover-foreground` |
| `accent` | `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring` |
| `contrast` | derived `--border`, `--input`, `--muted`, `--secondary`, `--sidebar`, `--sidebar-border` |
| `accent` + `contrast` | derived `--accent`, `--sidebar-accent` accent washes |
| `semanticColors.diffAdded` | `--diff-added` |
| `semanticColors.diffRemoved` | `--diff-removed`, `--destructive` |
| `semanticColors.skill` | `--skill` |
| `fonts.ui` | `--font-sans` |
| `fonts.code` | `--font-mono` |

This mapping intentionally narrows shadcn customization. shadcn exposes many
independent tokens, but Cypheria derives them from Codex's smaller theme model so
the UI remains predictable and compatible with Codex theme import/export.

`opaqueWindows` is currently persisted and represented in the Appearance UI as
the translucent-sidebar toggle. Full native window material changes require
Electron chrome support and are not implemented by shadcn tokens alone.

## Preferences Mapping

Appearance preferences that are not color tokens are applied separately:

- `sansFontSize` becomes `--font-sans-size`.
- `codeFontSize` becomes `--font-mono-size`.
- `useFontSmoothing` becomes `data-cypheria-font-smoothing`.
- `usePointerCursors` becomes `data-cypheria-pointer-cursors`.
- `reduced-motion-preference` becomes `data-cypheria-reduced-motion` when set to
  `on` or `off`; `system` removes the override.
- `appearanceDiffMarkerStyle` is consumed by diff UI to choose color-only markers
  or `+/-` symbols.

## Font Mapping

Font handling stays aligned with Tailwind's default text-size scale. The
configured UI font is exposed through `--font-sans`, with `text-sm` anchored to
`--font-sans-size`; the rest of `text-xs` through `text-9xl` scales from that
anchor and keeps Tailwind's matching default line-height ratios.

The configured code font is exposed through `--font-mono`, with
`font-mono text-xs` anchored to `--font-mono-size`; `font-mono text-sm` through
`font-mono text-9xl` scale from that code anchor using the same Tailwind size and
line-height ratios.

`font-sans` and `font-mono` only apply family, style, weight, and stretch, so
component code continues to use normal Tailwind `text-*` and `leading-*`
utilities. Explicit `leading-*` utilities must keep precedence over the default
mono line-height.

When a user selects a concrete font face, TOML should preserve Codex-compatible
structured face metadata under `fonts.uiFace` or `fonts.codeFace` in addition to
the family string. Code font choices should be limited to monospace families in
the UI, while UI font choices may use proportional families.
