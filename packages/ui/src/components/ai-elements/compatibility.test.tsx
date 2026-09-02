// @vitest-environment jsdom

// Adapted from vercel/ai-elements component tests (Apache-2.0):
// https://github.com/vercel/ai-elements/tree/main/packages/elements/__tests__
import "@testing-library/jest-dom/vitest"

import { render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type { Tool } from "ai"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { AgentTool, AgentTools } from "./agent.js"
import { JSXPreview, JSXPreviewContent } from "./jsx-preview.js"
import { Plan, PlanContent, PlanTrigger } from "./plan.js"
import { SchemaDisplay, SchemaDisplayPath } from "./schema-display.js"
import { StackTrace, StackTraceErrorMessage, StackTraceErrorType } from "./stack-trace.js"
import { Terminal } from "./terminal.js"
import { VoiceSelector, VoiceSelectorContent, VoiceSelectorTrigger } from "./voice-selector.js"

describe("AI Elements compatibility adaptations", () => {
  it("renders string tool descriptions and safely falls back for dynamic descriptions", () => {
    const dynamicTool = {
      description: () => "Dynamic description",
      inputSchema: z.object({ query: z.string() }),
    } as unknown as Tool

    render(
      <AgentTools>
        <AgentTool tool={dynamicTool} value="search" />
      </AgentTools>
    )

    expect(screen.getByText("No description")).toBeInTheDocument()
  })

  it("renders schema path parameters without interpreting path text as HTML", () => {
    const { container } = render(
      <SchemaDisplay method="GET" path={'/<img src="x" onerror="alert(1)">/{walletId}'}>
        <SchemaDisplayPath />
      </SchemaDisplay>
    )

    expect(container.querySelector("img")).not.toBeInTheDocument()
    expect(screen.getByText("{walletId}")).toHaveClass("text-blue-600")
  })

  it("renders JSX through the NodeNext default-export adapter", () => {
    render(
      <JSXPreview jsx="<span>Preview output</span>">
        <JSXPreviewContent />
      </JSXPreview>
    )

    expect(screen.getByText("Preview output")).toBeInTheDocument()
  })

  it("renders ANSI terminal output through the NodeNext default-export adapter", () => {
    render(<Terminal output={"\u001B[32mGreen Text\u001B[0m"} />)
    expect(screen.getByText("Green Text")).toBeInTheDocument()
  })

  it("parses stack traces safely under noUncheckedIndexedAccess", () => {
    render(
      <StackTrace trace={"TypeError: broken\n    at run (/app/main.ts:10:2)"}>
        <StackTraceErrorType />
        <StackTraceErrorMessage />
      </StackTrace>
    )

    expect(screen.getByText("TypeError")).toBeInTheDocument()
    expect(screen.getByText("broken")).toBeInTheDocument()
  })

  it("keeps Base UI trigger composition interactive", async () => {
    const user = userEvent.setup()
    render(
      <Plan>
        <PlanTrigger />
        <PlanContent>Plan details</PlanContent>
      </Plan>
    )

    expect(screen.queryByText("Plan details")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Toggle plan" }))
    expect(screen.getByText("Plan details")).toBeInTheDocument()
  })

  it("forwards the Base UI dialog event details from voice selector", async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <VoiceSelector onOpenChange={onOpenChange}>
        <VoiceSelectorTrigger>Open voices</VoiceSelectorTrigger>
        <VoiceSelectorContent>Voice content</VoiceSelectorContent>
      </VoiceSelector>
    )

    await user.click(screen.getByRole("button", { name: "Open voices" }))
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.any(Object))
  })
})
