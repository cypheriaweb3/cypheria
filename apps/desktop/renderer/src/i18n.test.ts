import { afterEach, describe, expect, it } from "vitest"

import { activateLanguage, i18n } from "./i18n.js"

afterEach(() => {
  activateLanguage({ locale: "en", preference: "en" })
})

describe("desktop renderer internationalization", () => {
  it("activates the Simplified Chinese catalog without reloading", () => {
    activateLanguage({ locale: "zh-CN", preference: "zh-CN" })

    expect(i18n.locale).toBe("zh-CN")
    expect(i18n._("navigation.newTask")).toBe("新建任务")
    expect(i18n._("settings.language.label")).toBe("显示语言")
  })
})
