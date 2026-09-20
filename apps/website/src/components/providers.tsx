import { I18nProvider } from "@lingui/react"
import { useLocation } from "@tanstack/react-router"
import { i18nProvider } from "fumadocs-ui/i18n"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import { type ReactNode, useEffect, useMemo } from "react"
import { docsTranslations } from "@/lib/fumadocs-i18n"
import { createWebsiteI18n, localeFromPathname } from "@/lib/i18n"
import StaticSearchDialog from "./search-dialog"

export function WebsiteProviders({ children }: { children: ReactNode }) {
  const pathname = useLocation().pathname
  const locale = localeFromPathname(pathname)
  const i18n = useMemo(() => createWebsiteI18n(locale), [locale])

  useEffect(() => {
    document.documentElement.dataset.hydrated = "true"
  }, [])

  return (
    <I18nProvider i18n={i18n}>
      <RootProvider
        i18n={i18nProvider(docsTranslations, locale)}
        search={{ SearchDialog: StaticSearchDialog }}
        theme={{ enabled: false }}
      >
        {children}
      </RootProvider>
    </I18nProvider>
  )
}
