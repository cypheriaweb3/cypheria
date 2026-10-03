import type { LinguiConfig } from "@lingui/conf"
import { formatter } from "@lingui/format-po"

const config: LinguiConfig = {
  catalogs: [
    { include: ["<rootDir>/src/app"], path: "<rootDir>/src/app/locales/{locale}/messages" },
  ],
  format: formatter({ lineNumbers: false }),
  locales: ["en", "zh-CN"],
  sourceLocale: "en",
}

export default config
