import type { LanguageModelV4CallOptions } from "@ai-sdk/provider"
import { tool } from "ai"
import { expect } from "vitest"
import { z } from "zod"
import { acpTools } from "../src/acp-tool.js"
import { convertAiSdkMessagesToAcp, extractACPTools } from "../src/convert-utils.js"
import { assertEquals } from "./assert.js"
import { Deno } from "./deno-compat.js"

function createCallOptions(
  content: Array<{
    type: "file"
    data:
      | { type: "data"; data: string | Uint8Array }
      | { type: "text"; text: string }
      | { type: "url"; url: URL }
    mediaType: string
  }>
): LanguageModelV4CallOptions {
  return {
    prompt: [
      {
        role: "user",
        content,
      },
    ],
  } as LanguageModelV4CallOptions
}

Deno.test("convertAiSdkMessagesToAcp converts string image file parts to ACP image blocks", () => {
  const options = createCallOptions([
    {
      type: "file",
      data: { type: "data", data: "data:image/png;base64,Zm9v" },
      mediaType: "image/png",
    },
  ])

  const result = convertAiSdkMessagesToAcp(options, true, undefined, { image: true })

  assertEquals(result, [
    {
      type: "image",
      mimeType: "image/png",
      data: "Zm9v",
    },
  ])
})

Deno.test("convertAiSdkMessagesToAcp converts Uint8Array image file parts to ACP image blocks", () => {
  const options = createCallOptions([
    {
      type: "file",
      data: { type: "data", data: new Uint8Array([102, 111, 111]) },
      mediaType: "image/png",
    },
  ])

  const result = convertAiSdkMessagesToAcp(options, true, undefined, { image: true })

  assertEquals(result, [
    {
      type: "image",
      mimeType: "image/png",
      data: "Zm9v",
    },
  ])
})

Deno.test("convertAiSdkMessagesToAcp converts LanguageModelV4 inline text files to ACP text blocks", () => {
  const options = createCallOptions([
    {
      type: "file",
      data: { type: "text", text: "inline document" },
      mediaType: "text/plain",
    },
  ])

  assertEquals(convertAiSdkMessagesToAcp(options, true), [
    { type: "text", text: "inline document" },
  ])
})

Deno.test("convertAiSdkMessagesToAcp preserves URL files as ACP resource links", () => {
  const options = createCallOptions([
    {
      type: "file",
      data: { type: "url", url: new URL("https://example.com/context.pdf") },
      mediaType: "application/pdf",
    },
  ])

  assertEquals(convertAiSdkMessagesToAcp(options, true), [
    {
      type: "resource_link",
      uri: "https://example.com/context.pdf",
      name: "https://example.com/context.pdf",
      mimeType: "application/pdf",
    },
  ])
})

Deno.test("convertAiSdkMessagesToAcp uses embedded resources when negotiated", () => {
  const options = createCallOptions([
    {
      type: "file",
      data: { type: "data", data: new Uint8Array([1, 2, 3]) },
      mediaType: "application/octet-stream",
    },
  ])

  assertEquals(convertAiSdkMessagesToAcp(options, true, undefined, { embeddedContext: true }), [
    {
      type: "resource",
      resource: {
        uri: "data:application/octet-stream",
        mimeType: "application/octet-stream",
        blob: "AQID",
      },
    },
  ])
})

Deno.test("convertAiSdkMessagesToAcp rejects unsupported media capabilities", () => {
  const options = createCallOptions([
    {
      type: "file",
      data: { type: "data", data: "data:audio/wav;base64,Zm9v" },
      mediaType: "audio/wav",
    },
  ])

  expect(() => convertAiSdkMessagesToAcp(options, true)).toThrow(
    "does not advertise audio prompt support"
  )
})

Deno.test("convertAiSdkMessagesToAcp preserves AI SDK 7 tool result variants", () => {
  const result = convertAiSdkMessagesToAcp(
    {
      prompt: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "lookup",
              output: { type: "json", value: { answer: 42 } },
            },
            {
              type: "tool-result",
              toolCallId: "call-2",
              toolName: "write",
              output: { type: "execution-denied", reason: "policy" },
            },
          ],
        },
      ],
    } as LanguageModelV4CallOptions,
    true
  )

  assertEquals(result, [
    { type: "text", text: 'Result: {"answer":42}' },
    { type: "text", text: "[Tool Execution Denied] policy" },
  ])
})

Deno.test("convertAiSdkMessagesToAcp sends only messages added after the previous prompt", () => {
  const previous = [
    { role: "user" as const, content: [{ type: "text" as const, text: "question" }] },
    {
      role: "assistant" as const,
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "call-1",
          toolName: "lookup",
          input: { q: "x" },
        },
      ],
    },
  ]
  const prompt = [
    ...previous,
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "call-1",
          toolName: "lookup",
          output: { type: "text" as const, value: "done" },
        },
      ],
    },
  ]

  assertEquals(
    convertAiSdkMessagesToAcp(
      { prompt } as LanguageModelV4CallOptions,
      false,
      undefined,
      {},
      previous
    ),
    [{ type: "text", text: "Result: done" }]
  )
})

Deno.test("acpTools registrations are isolated even when tool names collide", async () => {
  const first = acpTools({
    sameName: tool({ inputSchema: z.object({}), execute: async () => "first" }),
  })
  const second = acpTools({
    sameName: tool({ inputSchema: z.object({}), execute: async () => "second" }),
  })
  const prepare = (value: typeof first) => [
    {
      type: "function" as const,
      name: "sameName",
      inputSchema: { type: "object", properties: {} },
      providerOptions: value.sameName.providerOptions,
    },
  ]

  const firstTool = extractACPTools(prepare(first))[0]
  const secondTool = extractACPTools(prepare(second))[0]
  assertEquals(await firstTool.execute?.({}, {} as never), "first")
  assertEquals(await secondTool.execute?.({}, {} as never), "second")
})

Deno.test("extractACPTools rejects client-side AI SDK tools without execute", () => {
  const tools = acpTools({
    clientOnly: tool({ inputSchema: z.object({}) }),
  })

  expect(() =>
    extractACPTools([
      {
        type: "function",
        name: "clientOnly",
        inputSchema: { type: "object", properties: {} },
        providerOptions: tools.clientOnly.providerOptions,
      },
    ])
  ).toThrow("has no execute function")
})
