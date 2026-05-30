import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import { Textarea } from "@cypheria/ui/components/textarea"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ArrowUp,
  ChevronDown,
  FileDiff,
  FolderGit2,
  Globe2,
  HardDrive,
  LockKeyhole,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  TerminalSquare,
  WalletCards,
} from "lucide-react"

export const Route = createFileRoute("/")({
  component: HomeRoute,
})

const auditRows = [
  ["Codex home", "$CYPHERIA_HOME/codex"],
  ["Runtime", "Electron main"],
  ["Renderer", "Typed IPC only"],
  ["Auto-signing", "Off"],
] as const

function HomeRoute() {
  const appMetadataQuery = useQuery({
    queryFn: () => window.cypheria?.app.getMetadata() ?? null,
    queryKey: ["app-metadata"],
    staleTime: Number.POSITIVE_INFINITY,
  })

  const appHealthQuery = useQuery({
    queryFn: () => window.cypheria?.app.getHealth() ?? null,
    queryKey: ["app-health"],
    staleTime: 10_000,
  })

  const runtimeInfoQuery = useQuery({
    queryFn: () => window.cypheria?.runtime.getInfo() ?? null,
    queryKey: ["runtime-info"],
    staleTime: Number.POSITIVE_INFINITY,
  })

  const preloadStatus = window.cypheria
    ? (runtimeInfoQuery.data?.cypheriaHome ?? "Loading")
    : "Browser preview"
  const appVersion = appMetadataQuery.data?.version ?? "0.0.0"
  const healthStatus = appHealthQuery.data?.status ?? (window.cypheria ? "Loading" : "Preview")

  return (
    <section
      className="grid h-screen min-h-0 grid-cols-[minmax(560px,1fr)_minmax(360px,34vw)] bg-background max-[1220px]:grid-cols-[minmax(0,1fr)] max-[860px]:h-[calc(100vh-48px)]"
      aria-label="Open workspace"
    >
      <main
        className="grid min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)_auto] border-r border-border max-[1220px]:border-r-0"
        aria-label="Chat"
      >
        <header className="flex min-h-[54px] items-center justify-between gap-3 border-b border-border bg-background px-4">
          <div className="inline-flex min-w-0 items-center gap-[7px] text-sm font-semibold text-muted-foreground">
            <FolderGit2 aria-hidden="true" size={16} strokeWidth={1.9} />
            <span className="truncate">cypheria</span>
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
          </div>
          <div className="inline-flex items-center gap-2">
            <Badge variant={window.cypheria ? "secondary" : "outline"}>
              {window.cypheria ? "Live" : "Preview"}
            </Badge>
            <Button aria-label="Collapse panel" size="icon" variant="ghost">
              <PanelRightClose aria-hidden="true" size={16} strokeWidth={1.9} />
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 content-center overflow-auto px-8 pb-6 pt-8 max-[640px]:content-start max-[640px]:px-3.5 max-[640px]:pb-[18px] max-[640px]:pt-6">
          <section className="mb-11 grid place-items-center" aria-label="Chat prompt">
            <h1 className="text-center text-3xl font-medium text-foreground sm:text-4xl">
              What should we build in Cypheria?
            </h1>
          </section>

          <div className="text-center text-sm text-muted-foreground">
            <span>Open a chat or start a new one.</span>
          </div>
        </div>

        <form
          aria-label="Message composer"
          className="mb-6 w-[min(840px,calc(100%-64px))] justify-self-center overflow-hidden rounded-[20px] border border-border bg-muted shadow-[0_14px_36px_rgb(0_0_0/0.08)] max-[640px]:mb-3 max-[640px]:w-[calc(100%-24px)]"
        >
          <Textarea
            aria-label="Message Cypheria"
            className="block min-h-24 w-full resize-none rounded-none border-0 bg-card px-[18px] pb-1.5 pt-[18px] text-[15px] leading-[1.45] text-card-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
            placeholder="Ask Cypheria to inspect, edit, run, or review..."
            rows={3}
          />
          <div className="flex items-center justify-between gap-2 bg-card px-2.5 pb-2.5 max-[640px]:flex-col max-[640px]:items-stretch">
            <div className="flex min-w-0 items-center gap-[7px]">
              <Button aria-label="Attach context" size="icon" variant="ghost">
                <Plus aria-hidden="true" size={17} strokeWidth={1.9} />
              </Button>
              <Button size="sm" variant="ghost">
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.9} />
                Full access
                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-[7px] max-[640px]:justify-between">
              <Button size="sm" variant="ghost">
                GPT-5
                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
              </Button>
              <Button aria-label="Send message" size="icon">
                <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-start gap-2 overflow-auto px-3.5 pb-2.5 pt-2">
            <Button
              className="h-auto gap-1.5 px-0 text-[13px] font-medium text-muted-foreground"
              type="button"
              variant="ghost"
            >
              <FolderGit2 aria-hidden="true" size={14} strokeWidth={1.9} />
              cypheria
            </Button>
            <Button
              className="h-auto gap-1.5 px-0 text-[13px] font-medium text-muted-foreground"
              type="button"
              variant="ghost"
            >
              <HardDrive aria-hidden="true" size={14} strokeWidth={1.9} />
              Local mode
            </Button>
            <Button
              className="h-auto gap-1.5 px-0 text-[13px] font-medium text-muted-foreground"
              type="button"
              variant="ghost"
            >
              <WalletCards aria-hidden="true" size={14} strokeWidth={1.9} />
              Wallet
            </Button>
            <Button
              className="h-auto gap-1.5 px-0 text-[13px] font-medium text-muted-foreground"
              type="button"
              variant="ghost"
            >
              <Globe2 aria-hidden="true" size={14} strokeWidth={1.9} />
              Network
            </Button>
          </div>
        </form>
      </main>

      <aside
        className="grid min-h-0 min-w-0 content-start gap-3.5 overflow-auto bg-background px-5 pb-5 max-[1220px]:hidden"
        aria-label="Panel"
      >
        <header className="sticky top-0 z-[1] -mx-5 flex min-h-[54px] items-center justify-between gap-3 border-b border-border bg-background px-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Panel</h2>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {healthStatus} · App {appVersion}
            </span>
          </div>
          <Button aria-label="Panel options" size="icon" variant="ghost">
            <MoreHorizontal aria-hidden="true" size={16} strokeWidth={1.9} />
          </Button>
        </header>

        <section className="grid grid-cols-2 gap-3.5 pt-[22px]" aria-label="Panel tools">
          <button
            className="grid min-h-[142px] place-items-center gap-2 rounded-lg border-0 bg-muted px-3 py-[18px] text-center text-foreground hover:bg-accent"
            type="button"
          >
            <FolderGit2 aria-hidden="true" size={23} strokeWidth={1.6} />
            <strong className="text-[15px] font-bold">Files</strong>
            <span className="text-[13px] text-muted-foreground">Browse workspace files</span>
          </button>
          <button
            className="grid min-h-[142px] place-items-center gap-2 rounded-lg border-0 bg-muted px-3 py-[18px] text-center text-foreground hover:bg-accent"
            type="button"
          >
            <Globe2 aria-hidden="true" size={23} strokeWidth={1.6} />
            <strong className="text-[15px] font-bold">Browser</strong>
            <span className="text-[13px] text-muted-foreground">Open dApps and sites</span>
          </button>
          <button
            className="grid min-h-[142px] place-items-center gap-2 rounded-lg border-0 bg-muted px-3 py-[18px] text-center text-foreground hover:bg-accent"
            type="button"
          >
            <FileDiff aria-hidden="true" size={23} strokeWidth={1.6} />
            <strong className="text-[15px] font-bold">Review</strong>
            <span className="text-[13px] text-muted-foreground">Inspect code changes</span>
          </button>
          <button
            className="grid min-h-[142px] place-items-center gap-2 rounded-lg border-0 bg-muted px-3 py-[18px] text-center text-foreground hover:bg-accent"
            type="button"
          >
            <TerminalSquare aria-hidden="true" size={23} strokeWidth={1.6} />
            <strong className="text-[15px] font-bold">Terminal</strong>
            <span className="text-[13px] text-muted-foreground">Interactive shell</span>
          </button>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex min-h-[50px] items-center justify-between gap-3 border-b border-border px-3">
            <div>
              <h2 className="text-[13px] font-semibold text-foreground">Web3 Context</h2>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Renderer-safe state
              </span>
            </div>
          </div>
          <div className="px-3 py-[18px] text-center text-sm text-muted-foreground">
            No wallet, network, or policy context selected.
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex min-h-[50px] items-center justify-between gap-3 border-b border-border px-3">
            <div>
              <h2 className="text-[13px] font-semibold text-foreground">Runtime</h2>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Local Cypheria home
              </span>
            </div>
          </div>
          <div className="grid">
            <div className="grid min-h-[42px] min-w-0 grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)] items-center gap-2.5 border-b border-border px-3 py-2">
              <span className="truncate text-xs text-muted-foreground">Home</span>
              <code
                className="truncate text-right font-mono text-xs text-muted-foreground"
                title={preloadStatus}
              >
                {preloadStatus}
              </code>
            </div>
            {auditRows.map(([label, value]) => (
              <div
                className="grid min-h-[42px] min-w-0 grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)] items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0"
                key={label}
              >
                <span className="truncate text-xs text-muted-foreground">{label}</span>
                <code className="truncate text-right font-mono text-xs text-muted-foreground">
                  {value}
                </code>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </section>
  )
}
