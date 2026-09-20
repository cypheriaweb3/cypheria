import { useLingui } from "@lingui/react"
import { useLocation } from "@tanstack/react-router"
import { copy } from "@/lib/copy"
import { localeFromPathname } from "@/lib/i18n"
import { GitHubLogo } from "./brand"
import { LanguageSelect } from "./language-select"
import { ThemeMenu } from "./theme-toggle"

const githubUrl = "https://github.com/cypheriaweb3/cypheria"

function DocsGitHubButton({ className }: { className?: string }) {
  return (
    <a
      aria-label="GitHub"
      className={["docs-github-button", className].filter(Boolean).join(" ")}
      href={githubUrl}
      rel="noreferrer"
      target="_blank"
    >
      <GitHubLogo />
    </a>
  )
}

const useDocsControls = () => {
  const { i18n } = useLingui()
  const location = useLocation()
  const locale = localeFromPathname(location.pathname)
  return {
    labels: {
      dark: i18n._(copy.themeDark),
      light: i18n._(copy.themeLight),
      system: i18n._(copy.themeSystem),
      theme: i18n._(copy.theme),
    },
    languageLabel: i18n._(copy.language),
    locale,
    pathname: location.pathname,
  }
}

export function DocsNavActions() {
  const { labels, languageLabel, locale, pathname } = useDocsControls()
  return (
    <div className="docs-nav-actions">
      <DocsGitHubButton />
      <LanguageSelect label={languageLabel} locale={locale} pathname={pathname} />
      <ThemeMenu labels={labels} />
    </div>
  )
}

export function DocsDrawerLanguageSelect() {
  const { languageLabel, locale, pathname } = useDocsControls()
  return (
    <>
      <DocsGitHubButton className="docs-drawer-github-button" />
      <LanguageSelect
        className="docs-drawer-language-select"
        label={languageLabel}
        locale={locale}
        pathname={pathname}
      />
    </>
  )
}

export function DocsDrawerThemeSwitch({ className }: { className?: string }) {
  const { labels } = useDocsControls()
  return (
    <div className={["docs-drawer-theme-switch", className].filter(Boolean).join(" ")}>
      <ThemeMenu labels={labels} />
    </div>
  )
}

export function DocsDrawerLanguageText() {
  return null
}
