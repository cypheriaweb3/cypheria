import { useLingui } from "@lingui/react"
import { useLocation } from "@tanstack/react-router"
import { Menu } from "lucide-react"
import { copy } from "@/lib/copy"
import { localeFromPathname } from "@/lib/i18n"
import { Brand } from "./brand"
import { LanguageSelect } from "./language-select"
import { ThemeMenu } from "./theme-toggle"

const githubUrl = "https://github.com/cypheriaweb3/cypheria"

export function SiteHeader() {
  const { i18n } = useLingui()
  const location = useLocation()
  const locale = localeFromPathname(location.pathname)
  const prefix = locale === "zh-CN" ? "/zh-CN" : ""

  const links = [
    [i18n._(copy.product), `${prefix}/product`],
    [i18n._(copy.security), `${prefix}/security`],
    [i18n._(copy.developers), `${prefix}/developers`],
    [i18n._(copy.docs), `${prefix}/docs`],
  ] as const

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand href={prefix || "/"} />
        <nav aria-label="Primary" className="desktop-navigation">
          {links.map(([label, href]) => (
            <a
              aria-current={location.pathname === href ? "page" : undefined}
              href={href}
              key={href}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <LanguageSelect
            label={i18n._(copy.language)}
            locale={locale}
            pathname={location.pathname}
          />
          <span aria-hidden="true" className="header-divider" />
          <ThemeMenu
            labels={{
              dark: i18n._(copy.themeDark),
              light: i18n._(copy.themeLight),
              system: i18n._(copy.themeSystem),
              theme: i18n._(copy.theme),
            }}
          />
          <details className="mobile-navigation">
            <summary aria-label="Open navigation">
              <Menu aria-hidden="true" />
            </summary>
            <div className="mobile-navigation-panel">
              {links.map(([label, href]) => (
                <a href={href} key={href}>
                  {label}
                </a>
              ))}
              <div className="mobile-navigation-actions">
                <LanguageSelect
                  label={i18n._(copy.language)}
                  locale={locale}
                  pathname={location.pathname}
                />
                <ThemeMenu
                  labels={{
                    dark: i18n._(copy.themeDark),
                    light: i18n._(copy.themeLight),
                    system: i18n._(copy.themeSystem),
                    theme: i18n._(copy.theme),
                  }}
                />
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  )
}

export { githubUrl }
