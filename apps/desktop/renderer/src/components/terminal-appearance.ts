import type { ITheme } from "@xterm/xterm"

type TerminalComputedStyle = Pick<
  CSSStyleDeclaration,
  "backgroundColor" | "color" | "fontFamily" | "fontSize"
>

type TerminalRootComputedStyle = Pick<CSSStyleDeclaration, "getPropertyValue">

export type TerminalAppearance = {
  fontFamily: string
  fontSize: number
  theme: ITheme
}

export const terminalAppearanceFromStyles = (
  surfaceStyle: TerminalComputedStyle,
  rootStyle: TerminalRootComputedStyle
): TerminalAppearance => {
  const parsedFontSize = Number.parseFloat(surfaceStyle.fontSize)
  const selectionBackground = rootStyle.getPropertyValue("--scrollbar-thumb-strong").trim()
  return {
    fontFamily: surfaceStyle.fontFamily,
    fontSize: Number.isFinite(parsedFontSize) ? parsedFontSize : 12,
    theme: {
      background: surfaceStyle.backgroundColor,
      cursor: surfaceStyle.color,
      foreground: surfaceStyle.color,
      ...(selectionBackground ? { selectionBackground } : {}),
    },
  }
}

export const terminalAppearanceFromElement = (element: HTMLElement): TerminalAppearance =>
  terminalAppearanceFromStyles(
    getComputedStyle(element),
    getComputedStyle(document.documentElement)
  )
