import { buttonVariants } from "@cypheria/ui/components/button"
import { Link, useLocation } from "@tanstack/react-router"
import { localeFromPathname } from "@/lib/i18n"
import { SiteFooter } from "./site-footer"
import { SiteHeader } from "./site-header"

export function NotFound() {
  const locale = localeFromPathname(useLocation().pathname)
  const prefix = locale === "zh-CN" ? "/zh-CN" : ""
  return (
    <div className="website-shell">
      <SiteHeader />
      <main className="not-found-page">
        <p className="eyebrow">404</p>
        <h1>{locale === "zh-CN" ? "这里没有这个页面。" : "This page is not here."}</h1>
        <p>
          {locale === "zh-CN"
            ? "链接可能已经变化，也可能仍在未来路线图中。"
            : "The link may have changed, or the feature may still be on the roadmap."}
        </p>
        <Link className={buttonVariants({ size: "lg" })} to={prefix || "/"}>
          {locale === "zh-CN" ? "返回首页" : "Return home"}
        </Link>
      </main>
      <SiteFooter />
    </div>
  )
}
