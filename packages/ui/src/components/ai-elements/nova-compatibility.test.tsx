// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "#components/button"
import { TooltipProvider } from "#components/tooltip"
import { ArtifactAction } from "./artifact.js"
import { Context, ContextTrigger } from "./context.js"
import { MessageAction } from "./message.js"
import {
  PromptInput,
  PromptInputButton,
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
} from "./prompt-input.js"
import {
  Sandbox,
  SandboxContent,
  SandboxHeader,
  SandboxTabContent,
  SandboxTabs,
  SandboxTabsList,
  SandboxTabsTrigger,
} from "./sandbox.js"

afterEach(cleanup)

describe("AI Elements with base-nova primitives", () => {
  it.each([
    MessageAction,
    ArtifactAction,
    PromptInputButton,
  ])("composes tooltip actions into one keyboard-accessible button (%#)", async (Action) => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { container, rerender } = render(
      <TooltipProvider>
        <Action aria-label="Run action" onClick={onClick} tooltip="Action help" />
      </TooltipProvider>
    )

    expect(container.querySelectorAll("button")).toHaveLength(1)
    const button = screen.getByRole("button", { name: "Run action" })
    expect(button).toHaveClass("group/button")
    await user.tab()
    expect(button).toHaveFocus()
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toHaveTextContent(
        "Action help"
      )
    })
    await user.keyboard("{Enter}")
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <TooltipProvider>
        <Action aria-label="Run action" disabled onClick={onClick} tooltip="Action help" />
      </TooltipProvider>
    )
    await user.click(screen.getByRole("button", { name: "Run action" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders default and custom context triggers without nesting interactive elements", () => {
    const { container, rerender } = render(
      <Context maxTokens={100} usedTokens={25}>
        <ContextTrigger />
      </Context>
    )
    expect(screen.getByRole("button", { name: /25%/ })).toHaveClass("text-sm")
    expect(container.querySelector("a button, button button")).toBeNull()

    rerender(
      <Context maxTokens={100} usedTokens={25}>
        <ContextTrigger>
          <Button>Custom usage</Button>
        </ContextTrigger>
      </Context>
    )
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Custom usage" })).toBeInTheDocument()
    expect(container.querySelector("a button, button button")).toBeNull()
  })

  it("inherits Nova selector typography", () => {
    render(
      <PromptInputSelect defaultValue="low">
        <PromptInputSelectTrigger aria-label="Reasoning effort">
          <PromptInputSelectValue />
        </PromptInputSelectTrigger>
      </PromptInputSelect>
    )
    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toHaveClass(
      "text-sm",
      "data-[size=default]:h-8"
    )
  })

  it("submits text and stops generation through Nova input buttons", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onStop = vi.fn()
    const { rerender } = render(
      <PromptInput onSubmit={onSubmit}>
        <PromptInputTextarea aria-label="Prompt" />
        <PromptInputSubmit />
      </PromptInput>
    )
    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Inspect this task")
    await user.click(screen.getByRole("button", { name: "Submit" }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Inspect this task", files: [] }),
      expect.anything()
    )

    rerender(
      <PromptInput onSubmit={onSubmit}>
        <PromptInputTextarea aria-label="Prompt" />
        <PromptInputSubmit onStop={onStop} status="streaming" />
      </PromptInput>
    )
    await user.click(screen.getByRole("button", { name: "Stop" }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("uses Base UI open and active attributes for sandbox styling", async () => {
    const user = userEvent.setup()
    render(
      <Sandbox defaultOpen={false}>
        <SandboxHeader state="output-available" title="Sandbox output" />
        <SandboxContent>
          <SandboxTabs defaultValue="code">
            <SandboxTabsList>
              <SandboxTabsTrigger value="code">Code</SandboxTabsTrigger>
              <SandboxTabsTrigger value="output">Output</SandboxTabsTrigger>
            </SandboxTabsList>
            <SandboxTabContent value="code">Code content</SandboxTabContent>
            <SandboxTabContent value="output">Output content</SandboxTabContent>
          </SandboxTabs>
        </SandboxContent>
      </Sandbox>
    )
    const trigger = screen.getByRole("button", { name: /Sandbox output/ })
    await user.click(trigger)
    expect(trigger).toHaveAttribute("data-panel-open")
    expect(trigger.closest('[data-slot="collapsible"]')).toHaveAttribute("data-open")
    expect(trigger.querySelector(".group-data-open\\:rotate-180")).not.toBeNull()
    const output = screen.getByRole("tab", { name: "Output" })
    await user.click(output)
    expect(output).toHaveAttribute("data-active")
    expect(output).toHaveClass("data-active:text-foreground")
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Output content")
  })
})
