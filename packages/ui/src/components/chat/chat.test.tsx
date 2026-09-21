// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ChatComposerDock,
  ChatComposerFrame,
  ChatComposerSubmit,
  ChatPanel,
  ChatPanelEmptyState,
  ChatPanelErrorState,
  ChatPanelLauncher,
  ChatPanelLoadingState,
  type ChatPanelTabDescriptor,
  ChatReviewFileList,
  ChatSourceGroup,
  ChatSourceItem,
  ChatSourcesPanel,
  ChatSubagentGroup,
  ChatSubagentItem,
  ChatSubagentsPanel,
  ChatTerminalOutputHost,
  ChatTerminalPanel,
  ChatTerminalStatusBar,
  ChatTerminalTabs,
  ChatTimeline,
  ChatTimelineContent,
  ChatTimelineItem,
  ChatTimelineState,
  ChatTurnMarker,
  ChatTurnNavigator,
  ChatUserMessage,
  ChatWorkspaceShell,
} from "./index.js"

afterEach(cleanup)

describe("chat presentation components", () => {
  it("keeps hidden panels mounted and omits closed panels", () => {
    const { container, rerender } = render(
      <ChatWorkspaceShell
        bottomPanel={<div>Retained terminal</div>}
        bottomPanelVisibility="hidden"
        rightPanel={<div>Sources</div>}
        rightPanelVisibility="closed"
      >
        <div>Timeline</div>
      </ChatWorkspaceShell>
    )

    const bottom = container.querySelector('[data-slot="chat-bottom-panel-surface"]')
    expect(bottom).toHaveAttribute("hidden")
    expect(bottom).toHaveAttribute("inert")
    expect(screen.getByText("Retained terminal")).toBeInTheDocument()
    expect(container.querySelector('[data-slot="chat-right-panel-surface"]')).toBeNull()

    rerender(
      <ChatWorkspaceShell
        bottomPanel={<div>Terminal</div>}
        bottomPanelVisibility="closed"
        rightPanel={<div>Sources</div>}
        rightPanelVisibility="visible"
      >
        <div>Timeline</div>
      </ChatWorkspaceShell>
    )
    expect(container.querySelector('[data-slot="chat-bottom-panel-surface"]')).toBeNull()
    expect(container.querySelector('[data-slot="chat-right-panel-surface"]')).toBeVisible()
  })

  it("supports controlled tab selection, keyboard focus, move, and close callbacks", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onMove = vi.fn()
    const onVisibilityChange = vi.fn()
    const tabs: ChatPanelTabDescriptor[] = [
      { closable: true, content: "Source content", id: "sources", movable: true, title: "Sources" },
      { content: "Review content", id: "review", title: "Review" },
    ]

    const ControlledPanel = () => {
      const [value, setValue] = useState("sources")
      return (
        <ChatPanel
          activeTabId={value}
          closeTabLabel={(tab) => `Close ${String(tab.title)}`}
          hideLabel="Hide panel"
          moveTabLabel={(tab, placement) => `Move ${String(tab.title)} to ${placement}`}
          onActiveTabChange={setValue}
          onCloseTab={onClose}
          onMoveTab={onMove}
          onVisibilityChange={onVisibilityChange}
          placement="right"
          tabs={tabs}
        />
      )
    }

    render(<ControlledPanel />)
    const sourcesTab = screen.getByRole("tab", { name: "Sources" })
    const reviewTab = screen.getByRole("tab", { name: "Review" })
    sourcesTab.focus()
    await user.keyboard("{ArrowRight}")
    expect(reviewTab).toHaveFocus()
    await user.click(reviewTab)
    expect(reviewTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Review content")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Move Sources to bottom" }))
    expect(onMove).toHaveBeenCalledWith("sources", "bottom")
    await user.click(screen.getByRole("button", { name: "Close Sources" }))
    expect(onClose).toHaveBeenCalledWith("sources")
    await user.click(screen.getByRole("button", { name: "Hide panel" }))
    expect(onVisibilityChange).toHaveBeenCalledWith("hidden")
  })

  it("launches panel content from the accessible launcher", async () => {
    const user = userEvent.setup()
    const onLaunch = vi.fn()
    render(
      <ChatPanelLauncher
        defaultOpen
        items={[{ description: "Changed files", id: "review", label: "Review" }]}
        label="Open panel tab"
        onLaunch={onLaunch}
      />
    )

    await user.click(screen.getByRole("menuitem", { name: /Review/ }))
    expect(onLaunch).toHaveBeenCalledWith("review")
  })

  it("exposes composer ready, streaming, and retained hidden states", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onStop = vi.fn()
    const { container, rerender } = render(
      <ChatComposerDock>
        <ChatComposerFrame>
          <ChatComposerSubmit
            onClick={onSubmit}
            status="ready"
            stopLabel="Stop response"
            submitLabel="Send prompt"
          />
        </ChatComposerFrame>
      </ChatComposerDock>
    )

    await user.click(screen.getByRole("button", { name: "Send prompt" }))
    expect(onSubmit).toHaveBeenCalledOnce()

    rerender(
      <ChatComposerDock>
        <ChatComposerFrame>
          <ChatComposerSubmit
            onStop={onStop}
            status="streaming"
            stopLabel="Stop response"
            submitLabel="Send prompt"
          />
        </ChatComposerFrame>
      </ChatComposerDock>
    )
    await user.click(screen.getByRole("button", { name: "Stop response" }))
    expect(onStop).toHaveBeenCalledOnce()

    rerender(
      <ChatComposerDock visible={false}>
        <ChatComposerFrame>Saved draft</ChatComposerFrame>
      </ChatComposerDock>
    )
    const dock = container.querySelector('[data-slot="chat-composer-dock"]')
    expect(dock).toHaveAttribute("hidden")
    expect(dock).toHaveAttribute("inert")
    expect(screen.getByText("Saved draft")).toBeInTheDocument()
  })

  it("renders timeline semantics, states, and user-turn navigation", () => {
    render(
      <div>
        <ChatTimeline aria-label="Conversation">
          <ChatTimelineContent>
            <ChatTimelineItem kind="user">
              <ChatUserMessage>Build the panel system</ChatUserMessage>
            </ChatTimelineItem>
            <ChatTimelineState state="loading-history">Loading earlier turns</ChatTimelineState>
          </ChatTimelineContent>
        </ChatTimeline>
        <ChatTurnNavigator label="User turns">
          <ChatTurnMarker active label="Jump to user turn one" />
        </ChatTurnNavigator>
      </div>
    )

    expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument()
    expect(screen.getByText("Build the panel system")).toHaveAttribute(
      "data-slot",
      "chat-user-message"
    )
    expect(screen.getByRole("status")).toHaveTextContent("Loading earlier turns")
    expect(screen.getByRole("button", { name: "Jump to user turn one" })).toHaveAttribute(
      "aria-current",
      "step"
    )
  })

  it("renders source, subagent, review, and terminal presentation states", async () => {
    const user = userEvent.setup()
    const onSelectFile = vi.fn()
    const onSelectTerminal = vi.fn()
    render(
      <div>
        <ChatSourcesPanel>
          <ChatSourceGroup count={1} title="Read">
            <ChatSourceItem source={{ id: "source", kind: "read", label: "shell.tsx" }} />
          </ChatSourceGroup>
        </ChatSourcesPanel>
        <ChatSubagentsPanel>
          <ChatSubagentGroup count={1} title="Active">
            <ChatSubagentItem
              agent={{ id: "agent", state: "running", title: "Inspect UI" }}
              stateLabel="Working"
            />
          </ChatSubagentGroup>
        </ChatSubagentsPanel>
        <ChatReviewFileList
          files={[{ additions: 8, deletions: 2, id: "file", path: "panel.tsx", selected: true }]}
          onSelectFile={onSelectFile}
          selectFileLabel={() => "Open panel.tsx diff"}
        />
        <ChatTerminalPanel>
          <ChatTerminalTabs
            activeTabId="terminal"
            onSelectTab={onSelectTerminal}
            selectTabLabel={() => "Select development terminal"}
            statusLabel={() => "Running"}
            tabs={[{ id: "terminal", status: "running", title: "Development" }]}
          />
          <ChatTerminalOutputHost>Terminal renderer</ChatTerminalOutputHost>
          <ChatTerminalStatusBar status="running">Running</ChatTerminalStatusBar>
        </ChatTerminalPanel>
        <ChatPanelEmptyState>No sources</ChatPanelEmptyState>
        <ChatPanelLoadingState>Loading review</ChatPanelLoadingState>
        <ChatPanelErrorState>Diff unavailable</ChatPanelErrorState>
      </div>
    )

    expect(screen.getByText("shell.tsx")).toBeInTheDocument()
    expect(screen.getByText("Working")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open panel.tsx diff" }))
    expect(onSelectFile).toHaveBeenCalledWith("file")
    await user.click(screen.getByRole("tab", { name: "Select development terminal" }))
    expect(onSelectTerminal).toHaveBeenCalledWith("terminal")
    expect(screen.getByRole("alert")).toHaveTextContent("Diff unavailable")
    expect(screen.getByText("Loading review")).toHaveAttribute(
      "data-slot",
      "chat-panel-loading-state"
    )
    expect(
      screen.getByText("Running", {
        selector: '[data-slot="chat-terminal-status"]',
      })
    ).toBeInTheDocument()
  })
})
