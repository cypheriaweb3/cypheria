import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: HomeRoute,
})

const workspaceCards = [
  {
    label: "Codex threads",
    value: "0",
    detail: "Thread list and turn stream placeholder",
  },
  {
    label: "Wallet context",
    value: "Read-only",
    detail: "No signing policy is enabled by default",
  },
  {
    label: "Browser sessions",
    value: "Isolated",
    detail: "Origin-scoped dApp sessions will attach here",
  },
]

function HomeRoute() {
  return (
    <section className="workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Desktop shell</p>
          <h1>Workspaces</h1>
        </div>
        <button className="primary-action" type="button">
          New Thread
        </button>
      </header>

      <div className="content-grid">
        <section className="thread-panel" aria-labelledby="threads-heading">
          <div className="panel-heading">
            <h2 id="threads-heading">Agent activity</h2>
            <span className="panel-kicker">Waiting for Codex bridge</span>
          </div>
          <div className="empty-state">
            <p>No workspace thread is selected.</p>
            <span>Typed IPC and Codex event streaming will populate this panel next.</span>
          </div>
        </section>

        <aside className="inspector" aria-labelledby="context-heading">
          <div className="panel-heading">
            <h2 id="context-heading">Context</h2>
            <span className="panel-kicker">Local first</span>
          </div>
          <div className="context-list">
            {workspaceCards.map((card) => (
              <div className="context-row" key={card.label}>
                <div>
                  <strong>{card.label}</strong>
                  <span>{card.detail}</span>
                </div>
                <code>{card.value}</code>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
