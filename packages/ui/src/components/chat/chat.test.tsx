// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ChatActivityItem,
  ChatActivityList,
  ChatApprovalCard,
  ChatCommandBlock,
  ChatComposerBanner,
  ChatComposerBody,
  ChatComposerDock,
  ChatComposerFooter,
  ChatComposerForm,
  ChatComposerFrame,
  ChatComposerPanel,
  ChatComposerStatusMessage,
  ChatComposerSubmit,
  ChatComposerTextarea,
  ChatComposerTopTray,
  ChatContextChip,
  ChatContextUsage,
  ChatDesktopNotificationPreview,
  ChatFileChange,
  ChatFileChanges,
  ChatFixedTurnSummary,
  ChatFixedTurnSummaryItem,
  ChatHeader,
  ChatMessageContent,
  ChatModelSelector,
  ChatPanel,
  ChatPanelEmptyState,
  ChatPanelErrorState,
  ChatPanelLauncher,
  ChatPanelLoadingState,
  ChatPanelSurface,
  type ChatPanelTabDescriptor,
  ChatPendingInteractionBody,
  ChatPendingInteractionFooter,
  ChatPendingOption,
  ChatPendingQuestion,
  ChatPermissionRequest,
  ChatQueuedInputItem,
  ChatQueuedInputList,
  ChatReasoning,
  ChatReasoningContent,
  ChatReasoningTrigger,
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
  ChatTimelineEvent,
  ChatTimelineItem,
  ChatTimelineState,
  ChatTool,
  ChatToolCode,
  ChatToolContent,
  ChatToolSection,
  ChatToolTrigger,
  ChatTurnGroup,
  ChatTurnMarker,
  ChatTurnNavigator,
  ChatTurnNotice,
  ChatUserInputCard,
  ChatUserMessage,
  ChatWorkspaceShell,
} from "./index.js"

class ResizeObserverStub implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("chat presentation components", () => {
  it("renders compact context usage and unified model controls", () => {
    render(
      <div>
        <ChatModelSelector
          agent="codex"
          agentLabel="Codex"
          agentOptions={[{ label: "Codex", value: "codex" }]}
          labels={{ agent: "Agent", model: "Model", reasoning: "Reasoning", speed: "Speed" }}
          model="gpt"
          modelOptions={[{ label: "GPT", value: "gpt" }]}
          onAgentChange={() => undefined}
          onModelChange={() => undefined}
          onReasoningChange={() => undefined}
          onSpeedChange={() => undefined}
          reasoning="high"
          reasoningOptions={[{ label: "High", value: "high" }]}
          speed="fast"
          speedOptions={[{ label: "Fast", value: "fast" }]}
        />
        <ChatContextUsage
          agent="codex"
          agentLabel="Codex"
          maxTokens={200}
          sourceLabel="Agent reported"
          tokens={{
            cacheRead: 10,
            cacheWrite: 0,
            input: 30,
            output: 5,
            reasoning: 5,
            total: 50,
          }}
          usedTokens={50}
        />
      </div>
    )

    expect(screen.getByRole("combobox", { name: "Agent" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Reasoning" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Speed" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Codex context 25%" })).toHaveAttribute(
      "data-agent",
      "codex"
    )
  })

  it("labels grouped tool activity without owning timeline state", () => {
    render(
      <ChatTurnGroup current kind="tools" label="Tool activity">
        <span>Read files</span>
      </ChatTurnGroup>
    )
    const group = screen.getByRole("region", { name: "Tool activity" })
    expect(group).toHaveAttribute("data-slot", "chat-turn-group")
    expect(group).toHaveAttribute("data-current", "true")
  })
  it("identifies audited timeline events and panel surface kinds", () => {
    const { container } = render(
      <div>
        <ChatTimelineEvent
          description="The response can be retried."
          state="error"
          title="Stream interrupted"
          tone="error"
          type="stream-error"
        />
        <ChatApprovalCard state="pending" stateLabel="Waiting" title="Permission required">
          Review the requested command.
        </ChatApprovalCard>
        <ChatUserInputCard title="Choose a scope" />
        <ChatPanelSurface kind="mcp-extension-thread">Extension</ChatPanelSurface>
      </div>
    )

    expect(container.querySelector('[data-type="stream-error"]')).toHaveAttribute("role", "alert")
    expect(container.querySelector('[data-slot="chat-approval-card"]')).toHaveAttribute(
      "data-state",
      "pending"
    )
    expect(container.querySelector('[data-slot="chat-user-input-card"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="chat-panel-surface"]')).toHaveAttribute(
      "data-kind",
      "mcp-extension-thread"
    )
  })

  it("keeps hidden panels mounted and omits closed panels", () => {
    const { container, rerender } = render(
      <ChatWorkspaceShell
        bottomPanel={<div>Retained terminal</div>}
        bottomPanelVisibility="hidden"
        fixedHeaderActions={<button type="button">Fixed toggles</button>}
        header={<ChatHeader reserveFixedActions>Conversation header</ChatHeader>}
        rightPanel={<div>Sources</div>}
        rightPanelVisibility="closed"
      >
        <div>Timeline</div>
      </ChatWorkspaceShell>
    )

    const bottom = container.querySelector('[data-slot="chat-bottom-panel-surface"]')
    expect(bottom).toHaveAttribute("hidden")
    expect(bottom).toHaveAttribute("inert")
    expect(bottom?.closest('[data-slot="resizable-panel"]')).toBeInTheDocument()
    expect(screen.getByText("Retained terminal")).toBeInTheDocument()
    expect(container.querySelector('[data-slot="chat-right-panel-surface"]')).toBeNull()
    expect(container.querySelector('[data-slot="chat-workspace-main-stack"]')).toContainElement(
      screen.getByText("Conversation header")
    )
    expect(container.querySelector('[data-slot="chat-header"]')).toHaveAttribute(
      "data-fixed-actions-inset",
      "true"
    )
    expect(
      container.querySelector('[data-slot="chat-workspace-fixed-header-actions"]')
    ).toContainElement(screen.getByRole("button", { name: "Fixed toggles" }))

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
    expect(container.querySelectorAll('[data-slot="chat-panel-resize-handle"]')).toHaveLength(1)
    expect(container.querySelector('[data-slot="chat-panel-resize-handle"]')).toHaveClass(
      "hover:bg-ring/45"
    )
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
          headerClassName="right-titlebar"
          hideLabel="Hide panel"
          moveTabLabel={(tab, placement) => `Move ${String(tab.title)} to ${placement}`}
          onActiveTabChange={setValue}
          onCloseTab={onClose}
          onMoveTab={onMove}
          onVisibilityChange={onVisibilityChange}
          placement="right"
          tabs={tabs}
          tabsLabel="Right panel tabs"
          workspaceHeader
        />
      )
    }

    const { container } = render(<ControlledPanel />)
    expect(screen.getByRole("tablist", { name: "Right panel tabs" })).toBeInTheDocument()
    expect(container.querySelector('[data-slot="chat-panel-header"]')).toHaveAttribute(
      "data-placement",
      "right"
    )
    expect(container.querySelector('[data-slot="chat-panel-header"]')).toHaveClass("right-titlebar")
    expect(container.querySelector('[data-slot="chat-panel-header"]')).toHaveAttribute(
      "data-workspace-header",
      "true"
    )
    expect(container.querySelector('[data-slot="chat-panel-header"]')).toHaveClass("border-b-0")
    expect(container.querySelectorAll('[data-slot="chat-panel-tab"]')).toHaveLength(2)
    expect(container.querySelector('[data-slot="chat-panel-header-actions"]')).toContainElement(
      screen.getByRole("button", { name: "Move Sources to bottom" })
    )
    const sourcesTab = screen.getByRole("tab", { name: "Sources" })
    const reviewTab = screen.getByRole("tab", { name: "Review" })
    expect(sourcesTab.querySelector("span.min-w-0")).toHaveStyle({
      maskImage: "linear-gradient(to right, black calc(100% - 0.75rem), transparent)",
    })
    await user.click(screen.getByRole("button", { name: "Move Sources to bottom" }))
    expect(onMove).toHaveBeenCalledWith("sources", "bottom")
    await user.click(screen.getByRole("button", { name: "Close Sources" }))
    expect(onClose).toHaveBeenCalledWith("sources")
    onClose.mockClear()
    sourcesTab.focus()
    expect(sourcesTab).toHaveAttribute("aria-keyshortcuts", "Delete")
    await user.keyboard("{Delete}")
    expect(onClose).toHaveBeenCalledWith("sources")
    await user.keyboard("{ArrowRight}")
    expect(reviewTab).toHaveFocus()
    await user.click(reviewTab)
    expect(reviewTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Review content")).toBeVisible()

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
          <ChatComposerBody>Saved draft</ChatComposerBody>
          <ChatComposerFooter>
            <ChatComposerSubmit
              onClick={onSubmit}
              status="ready"
              stopLabel="Stop response"
              submitLabel="Send prompt"
            />
          </ChatComposerFooter>
        </ChatComposerFrame>
      </ChatComposerDock>
    )

    expect(container.querySelector('[data-slot="chat-composer-footer"]')).toHaveAttribute(
      "data-align",
      "block-end"
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

  it("submits the native chat composer on Enter and preserves Shift+Enter", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(
      <ChatComposerForm onSubmit={onSubmit}>
        <ChatComposerTextarea aria-label="Prompt" />
        <ChatComposerSubmit status="ready" stopLabel="Stop response" submitLabel="Send prompt" />
      </ChatComposerForm>
    )

    const prompt = screen.getByRole("textbox", { name: "Prompt" })
    await user.type(prompt, "First line{shift>}{enter}{/shift}Second line")
    expect(onSubmit).not.toHaveBeenCalled()
    expect(prompt).toHaveValue("First line\nSecond line")

    await user.type(prompt, "{enter}")
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("renders Desktop-derived composer surfaces without making them timeline items", () => {
    const { container } = render(
      <div>
        <ChatFixedTurnSummary>
          <ChatFixedTurnSummaryItem kind="todo" label="Plan" progress={50} value="1/2" />
        </ChatFixedTurnSummary>
        <ChatComposerTopTray>
          <ChatComposerBanner
            description="Review the request"
            title="Approval policy"
            tone="warning"
          />
          <ChatComposerPanel title="Queued follow-ups">
            <ChatQueuedInputList>
              <ChatQueuedInputItem state="queued" stateLabel="Queued">
                Keep the panel open
              </ChatQueuedInputItem>
            </ChatQueuedInputList>
          </ChatComposerPanel>
          <ChatComposerStatusMessage state="running">
            Waiting for approval
          </ChatComposerStatusMessage>
        </ChatComposerTopTray>
        <ChatPermissionRequest title="Allow filesystem access?">
          <ChatPendingInteractionBody>
            <ChatPendingQuestion legend="Requested scope">
              <ChatPendingOption label="Read one folder" selected />
            </ChatPendingQuestion>
          </ChatPendingInteractionBody>
          <ChatPendingInteractionFooter>
            <button type="button">Continue</button>
          </ChatPendingInteractionFooter>
        </ChatPermissionRequest>
        <ChatContextChip
          label="reference.md"
          removeLabel="Remove reference"
          onRemove={() => undefined}
        />
        <ChatDesktopNotificationPreview
          appName="Cypheria"
          body="The task needs attention"
          kind="question"
          title="Input required"
        />
      </div>
    )

    expect(container.querySelector('[data-slot="chat-fixed-turn-summary"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="chat-composer-banner"]')).toHaveAttribute(
      "data-tone",
      "warning"
    )
    expect(
      screen.getByText("Waiting for approval").closest('[data-slot="chat-composer-status-message"]')
    ).toHaveAttribute("aria-live", "polite")
    expect(container.querySelector('[data-slot="chat-permission-request"]')).toHaveAttribute(
      "data-kind",
      "permission"
    )
    expect(screen.getByRole("button", { name: "Read one folder" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByRole("button", { name: "Remove reference" })).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="chat-desktop-notification-preview"]')
    ).toHaveAttribute("data-kind", "question")
    expect(container.querySelector('[data-slot="chat-timeline-item"]')).toBeNull()
  })

  it("renders chat-owned message, reasoning, and tool disclosure primitives", () => {
    const { container } = render(
      <div>
        <ChatMessageContent>**Ready** for review.</ChatMessageContent>
        <ChatReasoning defaultOpen>
          <ChatReasoningTrigger label="Thought for 4 seconds" />
          <ChatReasoningContent>Compared the two layouts.</ChatReasoningContent>
        </ChatReasoning>
        <ChatTool defaultOpen state="completed">
          <ChatToolTrigger state="completed" stateLabel="Completed" title="Read files" />
          <ChatToolContent>
            <ChatToolSection label="Result">
              <ChatToolCode>3 files</ChatToolCode>
            </ChatToolSection>
          </ChatToolContent>
        </ChatTool>
      </div>
    )

    expect(container.querySelector('[data-slot="chat-message-content"]')).toHaveTextContent(
      "Ready for review."
    )
    expect(screen.getByRole("button", { name: /Thought for 4 seconds/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(screen.getByText("Compared the two layouts.")).toBeVisible()
    expect(screen.getByRole("button", { name: /Read files/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(screen.getByText("3 files")).toHaveAttribute("data-slot", "chat-tool-code")
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

  it("renders rich activity, command, file change, and recovery items", () => {
    render(
      <ChatTimeline aria-label="Rich conversation">
        <ChatTimelineContent>
          <ChatActivityList>
            <ChatActivityItem
              description="Inspected the renderer"
              state="completed"
              stateLabel="Completed"
              title="Read files"
            />
          </ChatActivityList>
          <ChatCommandBlock
            command="pnpm check"
            output="13 tasks passed"
            state="completed"
            stateLabel="Exited 0"
            title="Repository checks"
          />
          <ChatFileChanges summary="1 file" title="Changed files">
            <ChatFileChange
              additions={12}
              deletions={2}
              path="timeline.tsx"
              statusLabel="Modified"
            />
          </ChatFileChanges>
          <ChatTurnNotice title="Retry available" tone="error">
            The failed command did not change source files.
          </ChatTurnNotice>
        </ChatTimelineContent>
      </ChatTimeline>
    )

    expect(screen.getByText("Read files").closest("li")).toHaveAttribute(
      "data-slot",
      "chat-activity-item"
    )
    expect(screen.getByText("Completed")).toHaveClass("sr-only")
    expect(screen.getByText("pnpm check").closest("section")).toHaveAttribute(
      "data-state",
      "completed"
    )
    expect(screen.getByText("timeline.tsx").closest("li")).toHaveTextContent("+12-2")
    expect(screen.getByRole("alert")).toHaveTextContent("Retry available")
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
