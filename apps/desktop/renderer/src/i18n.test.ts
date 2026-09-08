import { afterEach, describe, expect, it } from "vitest"

import { activateLanguage, i18n } from "./i18n.js"

afterEach(() => {
  activateLanguage({ locale: "en", preference: "en" })
})

describe("desktop renderer internationalization", () => {
  it("activates the Simplified Chinese catalog without reloading", () => {
    activateLanguage({ locale: "zh-CN", preference: "zh-CN" })

    expect(i18n.locale).toBe("zh-CN")
    expect(i18n._("navigation.newChat")).toBe("新建对话")
    expect(i18n._("plugins.detail.loading", { pluginName: "GitHub" })).toBe(
      "正在加载 GitHub 插件详情"
    )
    expect(i18n._("settings.language.label")).toBe("显示语言")
  })
})
