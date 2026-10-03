import "./styles.css"

import { I18nProvider } from "@lingui/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { app, applyHostContext } from "./bridge.js"
import { activateLocale, i18n } from "./i18n.js"
import { Root } from "./root.js"
import { type InitialView, InitialViewSchema } from "./schemas.js"

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

let initialView: InitialView | null = null
const viewListeners = new Set<(view: InitialView) => void>()

/** The tool that opened the App names its first view: the inbox, a pull request, or settings. */
app.ontoolresult = (result) => {
  const parsed = InitialViewSchema.safeParse(
    (result.structuredContent as { initialView?: unknown } | undefined)?.initialView
  )
  if (!parsed.success) return
  initialView = parsed.data
  for (const listener of viewListeners) listener(parsed.data)
}

app.onhostcontextchanged = (context) => {
  applyHostContext(context)
  if (context.locale) activateLocale(context.locale)
}

function App() {
  const [view, setView] = useState<InitialView | null>(initialView)
  useEffect(() => {
    viewListeners.add(setView)
    if (initialView) setView(initialView)
    return () => {
      viewListeners.delete(setView)
    }
  }, [])
  return view ? <Root initialView={view} /> : null
}

const start = async () => {
  activateLocale(navigator.language)
  await app.connect()
  const context = app.getHostContext()
  applyHostContext(context)
  activateLocale(context?.locale ?? navigator.language)
  const element = document.getElementById("root")
  if (!element) return
  createRoot(element).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </I18nProvider>
    </StrictMode>
  )
}

void start()
