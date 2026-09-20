import { createFileRoute } from "@tanstack/react-router"
import { DetailPage } from "@/components/marketing"
import { localizedHead } from "@/lib/metadata"

export const Route = createFileRoute("/zh-CN/product")({
  component: () => <DetailPage kind="product" locale="zh-CN" />,
  head: () =>
    localizedHead({
      description: "了解 Cypheria 工作区、Agent 生命周期、工具、Schedules 与客户端。",
      locale: "zh-CN",
      path: "/product",
      title: "产品 — Cypheria",
    }),
})
