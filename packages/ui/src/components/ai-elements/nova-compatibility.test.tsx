// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "#components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#components/dropdown-menu"
import { TooltipProvider } from "#components/tooltip"
import { ArtifactAction } from "./artifact.js"
import { Context, ContextTrigger } from "./context.js"
import { MessageAction } from "./message.js"
import {
  PromptInput,
  PromptInputButton,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ProviderAttachmentNames = () => {
  const { attachments } = usePromptInputController()
  return <output aria-label="Retained attachments">{attachments.files.map(StringFileName)}</output>
}

const ProviderAttachmentDetails = () => {
  const { attachments } = usePromptInputController()
  const attachment = attachments.files[0]
  return (
    <output aria-label="Retained attachment details">
      {attachment
        ? JSON.stringify({
            filename: attachment.filename,
            pastedText: attachment.pastedText,
          })
        : "empty"}
    </output>
  )
}

const InsertAtSelection = ({ value }: { value: string }) => {
  const { textInput } = usePromptInputController()
  return (
    <button onClick={() => textInput.insertAtSelection(value)} type="button">
      Restore pasted text
    </button>
  )
}

const StringFileName = (file: { filename?: string }) => file.filename ?? "Attachment"

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

  it("opens a labeled Base UI menu radio group without losing its group context", async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<Button>Model and reasoning</Button>} />
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="balanced">
            <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
            <DropdownMenuRadioItem value="fast">Fast</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="balanced">Balanced</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await waitFor(() => {
      expect(screen.getByText("Reasoning")).toBeInTheDocument()
      expect(screen.getByRole("menuitemradio", { name: "Balanced" })).toHaveAttribute(
        "aria-checked",
        "true"
      )
    })
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

  it("reports provider text changes and clears the retained draft after submission", async () => {
    const user = userEvent.setup()
    const onInputChange = vi.fn()
    render(
      <PromptInputProvider initialInput="Saved draft" onInputChange={onInputChange}>
        <PromptInput onSubmit={() => undefined}>
          <PromptInputTextarea aria-label="Retained prompt" />
          <PromptInputSubmit />
        </PromptInput>
      </PromptInputProvider>
    )

    const textarea = screen.getByRole("textbox", { name: "Retained prompt" })
    expect(textarea).toHaveValue("Saved draft")
    await user.type(textarea, " updated")
    expect(onInputChange).toHaveBeenLastCalledWith("Saved draft updated")

    await user.click(screen.getByRole("button", { name: "Submit" }))
    expect(onInputChange).toHaveBeenLastCalledWith("")
    expect(textarea).toHaveValue("")
  })

  it("restores externally retained provider attachments without owning their unmount cleanup", () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    const attachment = {
      filename: "reference.png",
      id: "attachment-1",
      mediaType: "image/png",
      type: "file" as const,
      url: "blob:retained-attachment",
    }
    const { unmount } = render(
      <PromptInputProvider initialAttachments={[attachment]} retainAttachmentsOnUnmount>
        <ProviderAttachmentNames />
      </PromptInputProvider>
    )

    expect(screen.getByRole("status", { name: "Retained attachments" })).toHaveTextContent(
      "reference.png"
    )
    unmount()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it("turns a 5000-character paste into a restorable pasted-text attachment", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pasted-text")
    render(
      <PromptInputProvider>
        <PromptInput maxFileSize={25 * 1024 * 1024} maxFiles={20} onSubmit={() => undefined}>
          <PromptInputTextarea aria-label="Prompt" />
        </PromptInput>
        <ProviderAttachmentDetails />
      </PromptInputProvider>
    )

    const text = `Preview line\n${"x".repeat(5000 - 13)}`
    const event = createEvent.paste(screen.getByRole("textbox", { name: "Prompt" }), {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? text : ""),
        items: [],
      },
    })
    fireEvent(screen.getByRole("textbox", { name: "Prompt" }), event)

    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole("status", { name: "Retained attachment details" })).toHaveTextContent(
      '"filename":"Pasted text.txt"'
    )
    expect(screen.getByRole("status", { name: "Retained attachment details" })).toHaveTextContent(
      '"characterCount":5000'
    )
    expect(screen.getByRole("status", { name: "Retained attachment details" })).toHaveTextContent(
      '"preview":"Preview line"'
    )
  })

  it("keeps short text and image-plus-independent-text in the native paste path", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:clipboard-image")
    render(
      <PromptInputProvider>
        <PromptInput accept="image/*" onSubmit={() => undefined}>
          <PromptInputTextarea aria-label="Prompt" />
        </PromptInput>
        <ProviderAttachmentNames />
      </PromptInputProvider>
    )
    const textarea = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    const shortText = createEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "short text" : ""),
        items: [],
      },
    })
    fireEvent(textarea, shortText)
    expect(shortText.defaultPrevented).toBe(false)

    const image = new File([new Uint8Array([1])], "capture.png", { type: "image/png" })
    const mixed = createEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "capture.png\nPlease inspect this image" : "",
        items: [{ getAsFile: () => image, kind: "file" }],
      },
    })
    fireEvent(textarea, mixed)
    expect(mixed.defaultPrevented).toBe(false)
    expect(screen.getByRole("status", { name: "Retained attachments" })).toHaveTextContent("")
  })

  it("consumes an image-only clipboard payload as an attachment", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:clipboard-image")
    render(
      <PromptInputProvider>
        <PromptInput accept="image/*" onSubmit={() => undefined}>
          <PromptInputTextarea aria-label="Prompt" />
        </PromptInput>
        <ProviderAttachmentNames />
      </PromptInputProvider>
    )
    const image = new File([new Uint8Array([1])], "capture.png", { type: "image/png" })
    const event = createEvent.paste(screen.getByRole("textbox", { name: "Prompt" }), {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "capture.png" : ""),
        items: [{ getAsFile: () => image, kind: "file" }],
      },
    })
    fireEvent(screen.getByRole("textbox", { name: "Prompt" }), event)
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole("status", { name: "Retained attachments" })).toHaveTextContent(
      "capture.png"
    )
  })

  it("restores pasted text at the active textarea selection", async () => {
    const user = userEvent.setup()
    render(
      <PromptInputProvider initialInput="alpha omega">
        <PromptInput onSubmit={() => undefined}>
          <PromptInputTextarea aria-label="Prompt" />
        </PromptInput>
        <InsertAtSelection value="beta " />
      </PromptInputProvider>
    )
    const textarea = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(6, 6)
    await user.click(screen.getByRole("button", { name: "Restore pasted text" }))
    expect(textarea).toHaveValue("alpha beta omega")
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
