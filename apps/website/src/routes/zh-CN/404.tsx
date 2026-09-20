import { createFileRoute } from "@tanstack/react-router"
import { NotFound } from "@/components/not-found"

export const Route = createFileRoute("/zh-CN/404")({ component: NotFound })
