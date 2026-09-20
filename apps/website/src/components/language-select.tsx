import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cypheria/ui/components/select"
import type { WebsiteLocale } from "@/lib/i18n"
import { localizePath } from "@/lib/i18n"

const languageNames: Record<WebsiteLocale, string> = {
  en: "English",
  "zh-CN": "简体中文",
}

export function LanguageSelect({
  className,
  label,
  locale,
  pathname,
}: {
  className?: string
  label: string
  locale: WebsiteLocale
  pathname: string
}) {
  const selectLocale = (value: unknown) => {
    const nextLocale = String(value) as WebsiteLocale
    if (nextLocale === locale || !(nextLocale in languageNames)) return
    window.location.assign(localizePath(pathname, nextLocale))
  }

  return (
    <Select onValueChange={selectLocale} value={locale}>
      <SelectTrigger
        aria-label={label}
        className={["language-select", className].filter(Boolean).join(" ")}
        size="sm"
      >
        <SelectValue>{languageNames[locale]}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="en">{languageNames.en}</SelectItem>
        <SelectItem value="zh-CN">{languageNames["zh-CN"]}</SelectItem>
      </SelectContent>
    </Select>
  )
}
