import { createFileRoute } from "@tanstack/react-router"
import { DetailPage } from "@/components/marketing"
import { localizedHead } from "@/lib/metadata"

export const Route = createFileRoute("/zh-CN/developers")({
  component: () => <DetailPage kind="developers" locale="zh-CN" />,
  head: () =>
    localizedHead({
      description: "Cypheria 架构、代码仓库、开发命令与文档入口。",
      locale: "zh-CN",
      path: "/developers",
      title: "开发者 — Cypheria",
    }),
})
