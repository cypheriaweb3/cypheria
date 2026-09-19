# Cypheria Brand

Cypheria uses one geometric mark across the desktop product, browser surfaces, and project communication. The mark combines an open circular **C** with a four-point spark: the ring represents a continuous agent workflow, while the spark represents a user-authorized action at its center.

## Core Assets

- `apps/desktop/renderer/src/assets/brand/cypheria-mark.svg` is the canonical transparent, monochrome mark. Use it in product UI, loading states, and layouts where the surrounding surface already supplies contrast.
- `apps/desktop/renderer/src/assets/brand/cypheria-app-icon.svg` is the generated SVG application-icon and favicon master consumed by the product. It places the mark on the approved rounded-square background.
- `apps/desktop/resources/icons/` contains generated platform assets. PNG, ICO, and ICNS files are compatibility derivatives only; they are not editable masters.

SVG is the source format. Edit the monochrome mark or the application-icon rules in `generate-brand-icons.mjs`, then regenerate; never trace a generated PNG or edit a platform derivative to create a new brand asset.

## Color

| Token | Value | Use |
| --- | --- | --- |
| Cypheria Ink | `#121117` | App-icon background and primary dark brand surface |
| Cypheria Paper | `#F7F7F8` | Primary mark on Ink |
| Cypheria Violet | `#8B72FF` | Spark accent and restrained brand emphasis |
| Monochrome Ink | `#000000` | Transparent mark master; UI may lower opacity or invert it for dark surfaces |

The app icon always uses Ink, Paper, and Violet together. Product UI should continue to use the shared semantic theme tokens; Violet is a brand accent, not a replacement for state colors such as destructive, warning, or success.

## Geometry And Clear Space

- Preserve the mark's original proportions. Do not rotate, skew, outline, crop, or rearrange the ring and spark.
- Keep clear space around the standalone mark equal to at least one eighth of its rendered width.
- The application icon's `276/1254` carrier radius is part of the SVG asset. Generated operating-system icons add a transparent optical perimeter and render the carrier at about 84% of the platform canvas so it aligns with native Dock and taskbar icons. Do not remove that perimeter or add another border or badge.
- Use the standalone mark at 24 CSS pixels or larger. The app-icon master is approved down to 16 pixels because its contrast and spacing are tuned for favicon use.

## Product Usage

- Loading and quiet product states use the monochrome mark with low opacity. The mark is decorative when a localized accessible status label is present.
- App windows, Dock/taskbar surfaces, launchers, and browser favicons use the application icon.
- On light surfaces, use the black monochrome mark. On dark surfaces, use the Paper/white treatment or invert the monochrome asset. Maintain at least 3:1 contrast for meaningful UI graphics.
- The product name is written **Cypheria**. Do not use all caps in interface copy or create an unapproved wordmark by pairing the mark with arbitrary display type.

## Generation And Integration

Regenerate the application-icon SVG and platform assets after changing the mark or approved icon rules:

```sh
pnpm --filter @cypheria/desktop brand:generate
```

The generator assembles the application-icon SVG and derives an optically inset 1024px PNG, common Linux PNG sizes, Windows ICO, and macOS ICNS. Electron main uses the PNG during development and for the window/Dock icon. TanStack Start publishes the full-canvas SVG as the document favicon, where the extra operating-system perimeter is not needed. When desktop packaging is enabled, the matching ICNS, ICO, and PNG files in `apps/desktop/resources/icons/` are the packaging inputs.

On macOS, start the development application through `pnpm --filter @cypheria/desktop dev` (or `dev:launch` after building). The launcher creates a cached, ignored `Cypheria.app` development shell with bundle identifier `dev.cypheria.desktop.dev`, the Cypheria bundle and executable names, and the approved ICNS. Production packages use `dev.cypheria.desktop`. Running `electron .` directly bypasses that shell and macOS will correctly identify the process as the generic **Electron** host.
