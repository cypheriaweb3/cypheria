import { createFileRoute } from "@tanstack/react-router"
import { DetailPage } from "@/components/marketing"
import { localizedHead } from "@/lib/metadata"

export const Route = createFileRoute("/zh-CN/security")({
  component: () => <DetailPage kind="security" locale="zh-CN" />,
  head: () =>
    localizedHead({
      description: "了解 Cypheria 的信任边界、签名策略、隔离、Relay 加密与审计。",
      locale: "zh-CN",
      path: "/security",
      title: "安全 — Cypheria",
    }),
})
