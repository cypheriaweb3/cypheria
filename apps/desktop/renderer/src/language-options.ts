import type { LanguageLocale } from "../../ipc/src/index.js"

export type LanguageOption = {
  readonly label: string
  readonly locale: LanguageLocale
  readonly searchAliases?: readonly string[]
  readonly zhLabel?: string
}

export const languageOptions: readonly LanguageOption[] = [
  { label: "Shqip", locale: "sq", searchAliases: ["Albanian"], zhLabel: "阿尔巴尼亚语" },
  { label: "íslenska", locale: "is", searchAliases: ["Icelandic"], zhLabel: "冰岛语" },
  {
    label: "繁體中文（台灣）",
    locale: "zh-TW",
    searchAliases: ["Traditional Chinese Taiwan"],
  },
  {
    label: "繁體中文（香港）",
    locale: "zh-HK",
    searchAliases: ["Traditional Chinese Hong Kong"],
  },
  { label: "ქართული", locale: "ka", searchAliases: ["Georgian"], zhLabel: "格鲁吉亚语" },
  {
    label: "简体中文",
    locale: "zh-CN",
    searchAliases: ["Simplified Chinese"],
  },
  { label: "македонски", locale: "mk", searchAliases: ["Macedonian"], zhLabel: "马其顿语" },
  { label: "Монгол", locale: "mn", searchAliases: ["Mongolian"], zhLabel: "蒙古语" },
  { label: "မြန်မာ", locale: "my", searchAliases: ["Burmese Myanmar"], zhLabel: "缅甸语" },
  { label: "日本語", locale: "ja", searchAliases: ["Japanese"] },
  { label: "Soomaali", locale: "so", searchAliases: ["Somali"], zhLabel: "索马里语" },
  { label: "Հայերեն", locale: "hy", searchAliases: ["Armenian"], zhLabel: "亚美尼亚语" },
  { label: "Bahasa Melayu", locale: "ms", searchAliases: ["Malay"] },
  { label: "bosanski", locale: "bs", searchAliases: ["Bosnian"] },
  { label: "català", locale: "ca", searchAliases: ["Catalan"] },
  { label: "čeština", locale: "cs", searchAliases: ["Czech"] },
  { label: "dansk", locale: "da", searchAliases: ["Danish"] },
  { label: "Deutsch", locale: "de", searchAliases: ["German"] },
  { label: "eesti", locale: "et", searchAliases: ["Estonian"] },
  { label: "English", locale: "en" },
  { label: "español (España)", locale: "es-ES", searchAliases: ["Spanish Spain"] },
  {
    label: "español (Latinoamérica)",
    locale: "es-419",
    searchAliases: ["Latin American Spanish"],
  },
  { label: "Filipino", locale: "fil" },
  { label: "français (Canada)", locale: "fr-CA", searchAliases: ["French Canada"] },
  { label: "français (France)", locale: "fr-FR", searchAliases: ["French France"] },
  { label: "hrvatski", locale: "hr", searchAliases: ["Croatian"] },
  { label: "Indonesia", locale: "id", searchAliases: ["Indonesian Bahasa Indonesia"] },
  { label: "italiano", locale: "it", searchAliases: ["Italian"] },
  { label: "Kiswahili", locale: "sw", searchAliases: ["Swahili"] },
  { label: "latviešu", locale: "lv", searchAliases: ["Latvian"] },
  { label: "lietuvių", locale: "lt", searchAliases: ["Lithuanian"] },
  { label: "magyar", locale: "hu", searchAliases: ["Hungarian"] },
  { label: "Nederlands", locale: "nl", searchAliases: ["Dutch"] },
  { label: "norsk bokmål", locale: "nb", searchAliases: ["Norwegian Bokmal"] },
  { label: "polski", locale: "pl", searchAliases: ["Polish"] },
  { label: "português (Brasil)", locale: "pt-BR", searchAliases: ["Portuguese Brazil"] },
  {
    label: "português (Portugal)",
    locale: "pt-PT",
    searchAliases: ["Portuguese Portugal"],
  },
  { label: "română", locale: "ro", searchAliases: ["Romanian"] },
  { label: "slovenčina", locale: "sk", searchAliases: ["Slovak"] },
  { label: "slovenščina", locale: "sl", searchAliases: ["Slovenian"] },
  { label: "suomi", locale: "fi", searchAliases: ["Finnish"] },
  { label: "svenska", locale: "sv", searchAliases: ["Swedish"] },
  { label: "Tiếng Việt", locale: "vi", searchAliases: ["Vietnamese"] },
  { label: "Türkçe", locale: "tr", searchAliases: ["Turkish"] },
  { label: "Ελληνικά", locale: "el", searchAliases: ["Greek"] },
  { label: "български", locale: "bg", searchAliases: ["Bulgarian"] },
  { label: "қазақ тілі", locale: "kk", searchAliases: ["Kazakh"] },
  { label: "русский", locale: "ru", searchAliases: ["Russian"] },
  { label: "српски", locale: "sr", searchAliases: ["Serbian"] },
  { label: "українська", locale: "uk", searchAliases: ["Ukrainian"] },
  { label: "اردو", locale: "ur", searchAliases: ["Urdu"] },
  { label: "العربية", locale: "ar", searchAliases: ["Arabic"] },
  { label: "فارسی", locale: "fa", searchAliases: ["Persian Farsi"] },
  { label: "አማርኛ", locale: "am", searchAliases: ["Amharic"] },
  { label: "मराठी", locale: "mr", searchAliases: ["Marathi"] },
  { label: "हिन्दी", locale: "hi", searchAliases: ["Hindi"] },
  { label: "বাংলা", locale: "bn", searchAliases: ["Bangla Bengali"] },
  { label: "ਪੰਜਾਬੀ", locale: "pa", searchAliases: ["Punjabi"] },
  { label: "ગુજરાતી", locale: "gu", searchAliases: ["Gujarati"] },
  { label: "தமிழ்", locale: "ta", searchAliases: ["Tamil"] },
  { label: "తెలుగు", locale: "te", searchAliases: ["Telugu"] },
  { label: "ಕನ್ನಡ", locale: "kn", searchAliases: ["Kannada"] },
  { label: "മലയാളം", locale: "ml", searchAliases: ["Malayalam"] },
  { label: "ไทย", locale: "th", searchAliases: ["Thai"] },
  { label: "한국어", locale: "ko", searchAliases: ["Korean"] },
]

export const getLanguageOptionLabel = (option: LanguageOption, displayLocale: string): string =>
  displayLocale === "zh-CN" ? (option.zhLabel ?? option.label) : option.label
