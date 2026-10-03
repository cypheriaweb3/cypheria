import { describe, expect, it } from "vitest"

import { untrustedInputItems } from "../agent/managed-thread-adapter.js"
import { modelContextToUntrusted, untrustedAppInput } from "./app-content.js"

describe("untrusted App input", () => {
  it("keeps App text, structured content, and images apart, one item per App", () => {
    const [item] = modelContextToUntrusted([
      {
        content: [
          { text: "Selected: M6 bolt", type: "text" },
          { data: "aGk=", mimeType: "image/png", type: "image" },
          { name: "bolt", title: "M6 bolt", type: "resource_link", uri: "cad://bolt" },
        ],
        key: "app-key",
        pluginId: "bits@market",
        server: "bits",
        structuredContent: { part: "m6" },
        title: "Bits",
        updateId: "u1",
      },
    ])
    expect(item).toEqual({
      images: [{ data: "aGk=", mimeType: "image/png" }],
      kind: "model_context",
      server: "bits",
      source: "mcp_app",
      sourceId: "app-key",
      structuredContent: { part: "m6" },
      text: "Selected: M6 bolt\nM6 bolt <cad://bolt>",
      title: "Bits",
    })
  })

  it("builds the untrusted_input call and output ChatGPT Desktop injects", () => {
    const message = untrustedAppInput({
      content: [
        { text: "Design a bracket", type: "text" },
        { data: "aGk=", mimeType: "image/png", type: "image" },
      ],
      kind: "message",
      server: "bits",
      sourceId: "app-key",
      title: "Bits",
    })
    expect(untrustedInputItems("untrusted_input_m1", [message])).toEqual([
      {
        arguments: "{}",
        call_id: "untrusted_input_m1",
        name: "untrusted_input",
        type: "function_call",
      },
      {
        call_id: "untrusted_input_m1",
        output: [
          {
            text: JSON.stringify({
              kind: "message",
              server: "bits",
              source: "mcp_app",
              sourceId: "app-key",
              text: "Design a bracket",
              title: "Bits",
            }),
            type: "input_text",
          },
          { image_url: "data:image/png;base64,aGk=", type: "input_image" },
        ],
        type: "function_call_output",
      },
    ])
  })
})
