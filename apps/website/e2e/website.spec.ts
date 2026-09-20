import { expect, test } from "@playwright/test"

test("home navigation, locale, theme menu, and GitHub CTA work", async ({ page }, testInfo) => {
  await page.goto("/")
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Local agents")
  await expect(page.locator("a.primary-cta").first()).toBeVisible()

  if (testInfo.project.name === "mobile") {
    await page.locator("summary[aria-label='Open navigation']").click()
    await expect(page.locator(".mobile-navigation-panel a[href='/docs']")).toBeVisible()
  } else {
    await page.getByRole("button", { name: "Theme" }).click()
    await page.getByRole("menuitemradio", { name: "Dark" }).click()
    await expect(page.locator("html")).toHaveAttribute("data-website-theme", "dark")
    await expect(page.locator("html")).toHaveAttribute("data-website-theme-preference", "dark")
    await page.getByRole("combobox", { name: "Language" }).click()
    await page.getByRole("option", { name: "简体中文" }).click()
    await expect(page).toHaveURL(/\/zh-CN$/u)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("本地 Agent")
  }
})

test("documentation and static search are usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop docs shell is covered here")
  await page.goto("/docs")
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true")
  await expect(page.getByRole("heading", { name: "Cypheria Documentation" })).toBeVisible()
  const sidebarControls = page.locator("#nd-sidebar .docs-nav-actions")
  await expect(sidebarControls).toBeVisible()
  await expect(page.locator("#nd-subnav .docs-nav-actions")).toHaveCount(0)
  const languageSelect = sidebarControls.getByRole("combobox", { name: "Language" })
  const themeMenu = sidebarControls.getByRole("button", { name: "Theme" })
  await expect(sidebarControls.getByRole("link", { name: "GitHub" })).toBeVisible()
  await expect(page.locator("#nd-sidebar").getByRole("link", { name: "GitHub" })).toHaveCount(1)
  await expect(languageSelect).toBeVisible()
  await expect(themeMenu).toBeVisible()
  const [languageBox, themeBox, sidebarBox] = await Promise.all([
    languageSelect.boundingBox(),
    themeMenu.boundingBox(),
    page.locator("#nd-sidebar").boundingBox(),
  ])
  expect(languageBox?.y).toBe(themeBox?.y)
  expect(languageBox?.y ?? 0).toBeGreaterThan((sidebarBox?.y ?? 0) + (sidebarBox?.height ?? 0) / 2)
  await page.locator("button[data-search-full]").click()
  await page.locator("input[data-fd-search-dialog-input]").fill("trust boundaries")
  await expect(
    page
      .getByRole("dialog")
      .getByText(/Architecture/u)
      .first()
  ).toBeVisible()
})

test("documentation actions move into the mobile drawer header", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "mobile navigation header is covered here")
  await page.goto("/zh-CN/docs")
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true")
  await expect(page.locator("#nd-subnav .docs-nav-actions")).toHaveCount(0)
  await page.getByRole("button", { name: "开启侧边栏" }).click()
  const navigation = page.locator("#nd-sidebar-mobile")
  const brand = navigation.getByRole("link", { name: "Cypheria home" })
  const github = navigation.getByRole("link", { name: "GitHub" })
  const language = navigation.getByRole("combobox", { name: "语言" })
  const theme = navigation.getByRole("button", { name: "主题" })
  await expect(brand).toBeVisible()
  await expect(github).toBeVisible()
  await expect(language).toBeVisible()
  await expect(theme).toBeVisible()
  const [brandBox, githubBox, languageBox] = await Promise.all([
    brand.boundingBox(),
    github.boundingBox(),
    language.boundingBox(),
  ])
  const brandToGitHub = (githubBox?.x ?? 0) - ((brandBox?.x ?? 0) + (brandBox?.width ?? 0))
  const githubToLanguage = (languageBox?.x ?? 0) - ((githubBox?.x ?? 0) + (githubBox?.width ?? 0))
  expect(githubToLanguage).toBeLessThanOrEqual(4)
  expect(githubToLanguage).toBeLessThan(brandToGitHub)
  await expect(navigation.getByText("Cypheria", { exact: true })).toHaveCount(0)
  await expect(page.locator(".docs-nav-actions")).toBeHidden()
  await navigation.getByRole("button", { name: "关闭侧边栏" }).click()
  await expect(navigation).toHaveAttribute("data-state", "closed")
  await expect(language).toBeHidden()
})

test("unknown paths use the bilingual 404 and Marketplace is not implemented", async ({ page }) => {
  const response = await page.goto("/marketplace")
  expect(response?.status()).toBe(404)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("This page is not here")

  const chineseResponse = await page.goto("/zh-CN/not-a-page")
  expect(chineseResponse?.status()).toBe(404)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("这里没有这个页面")
})
