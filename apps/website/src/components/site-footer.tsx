import { useLocation } from "@tanstack/react-router"
import { localeFromPathname } from "@/lib/i18n"
import { Brand } from "./brand"

export function SiteFooter() {
  const location = useLocation()
  const isChinese = localeFromPathname(location.pathname) === "zh-CN"
  const prefix = isChinese ? "/zh-CN" : ""
  return (
    <footer className="site-footer">
      <Brand href={prefix || "/"} />
      <p>
        {prefix
          ? "开源。本地优先。控制权属于你。"
          : "Open source. Local first. You stay in control."}
      </p>
      <nav aria-label="Footer">
        <a href={`${prefix}/product`}>{isChinese ? "产品" : "Product"}</a>
        <a href={`${prefix}/security`}>{isChinese ? "安全" : "Security"}</a>
        <a href={`${prefix}/developers`}>{isChinese ? "开发者" : "Developers"}</a>
        <a href={`${prefix}/docs`}>{isChinese ? "文档" : "Docs"}</a>
      </nav>
    </footer>
  )
}
