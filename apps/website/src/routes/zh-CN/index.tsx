import { createFileRoute } from "@tanstack/react-router"
import { HomePage } from "@/components/marketing"
import { localizedHead } from "@/lib/metadata"

export const Route = createFileRoute("/zh-CN/")({
  component: () => <HomePage locale="zh-CN" />,
  head: () =>
    localizedHead({
      description: "面向 Agent、钱包与 Web 的本地优先工作区。",
      locale: "zh-CN",
      path: "/",
      title: "Cypheria — 本地 Agent，一个可信工作区",
    }),
})
