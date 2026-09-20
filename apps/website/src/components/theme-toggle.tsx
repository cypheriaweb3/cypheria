import { Button } from "@cypheria/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@cypheria/ui/components/dropdown-menu"
import { Monitor, Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"

const storageKey = "cypheria.website.theme"

type WebsiteTheme = "dark" | "light"
type WebsiteThemePreference = WebsiteTheme | "system"

const isThemePreference = (value: string | undefined): value is WebsiteThemePreference =>
  value === "system" || value === "light" || value === "dark"

const resolveTheme = (preference: WebsiteThemePreference): WebsiteTheme =>
  preference === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : preference

const applyTheme = (preference: WebsiteThemePreference) => {
  const theme = resolveTheme(preference)
  document.documentElement.classList.toggle("dark", theme === "dark")
  document.documentElement.dataset.websiteTheme = theme
  document.documentElement.dataset.websiteThemePreference = preference
  document.documentElement.style.colorScheme = theme
}

const themeOptions = [
  ["system", Monitor],
  ["light", Sun],
  ["dark", Moon],
] as const

export function ThemeMenu({
  labels,
}: {
  labels: { dark: string; light: string; system: string; theme: string }
}) {
  const [preference, setPreference] = useState<WebsiteThemePreference>("system")

  useEffect(() => {
    const initial = document.documentElement.dataset.websiteThemePreference
    const nextPreference = isThemePreference(initial) ? initial : "system"
    setPreference(nextPreference)

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const syncSystemTheme = () => {
      if (document.documentElement.dataset.websiteThemePreference === "system") {
        applyTheme("system")
      }
    }
    media.addEventListener("change", syncSystemTheme)
    return () => media.removeEventListener("change", syncSystemTheme)
  }, [])

  const selectTheme = (value: unknown) => {
    const nextPreference = String(value)
    if (!isThemePreference(nextPreference)) return
    setPreference(nextPreference)
    applyTheme(nextPreference)
    localStorage.setItem(storageKey, nextPreference)
  }

  const CurrentIcon = themeOptions.find(([value]) => value === preference)?.[1] ?? Monitor

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={labels.theme}
            className="theme-menu-trigger"
            size="icon"
            variant="ghost"
          />
        }
      >
        <CurrentIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="theme-menu-content">
        <DropdownMenuRadioGroup onValueChange={selectTheme} value={preference}>
          {themeOptions.map(([value, Icon]) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {labels[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const themeBootstrapScript = `(() => {
  const key = ${JSON.stringify(storageKey)};
  const stored = localStorage.getItem(key);
  const preference = stored === "system" || stored === "dark" || stored === "light"
    ? stored
    : "system";
  const theme = preference === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.websiteTheme = theme;
  document.documentElement.dataset.websiteThemePreference = preference;
  document.documentElement.style.colorScheme = theme;
})();`
