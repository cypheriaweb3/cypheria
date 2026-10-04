import { describe, expect, it } from "vitest"

import { withAppPolicy } from "../mcp-app-host.js"
import { parseElicitationSchema } from "./elicitation-form.js"
import { fileHandlers, fileViewerExtension, pickFileViewer } from "./workspace-context.js"

describe("fileHandlers", () => {
  it("orders handlers by their longest matching extension", () => {
    const handlers = [
      { extensions: ["gz"], id: "gz" },
      { extensions: ["tar.gz"], id: "tar" },
      { extensions: ["stl"], id: "stl" },
    ]
    expect(fileHandlers("parts/Model.TAR.GZ", handlers).map((handler) => handler.id)).toEqual([
      "tar",
      "gz",
    ])
    expect(fileHandlers("readme.md", handlers)).toEqual([])
  })
})

describe("file viewer choice", () => {
  const handlers = [
    { extensions: ["gz"], id: "gz" },
    { extensions: ["tar.gz"], id: "tar" },
  ]

  it("keys the choice by the longest extension a viewer matches", () => {
    expect(fileViewerExtension("parts/Model.TAR.GZ", handlers)).toBe("tar.gz")
    expect(fileViewerExtension("notes.txt", handlers)).toBeNull()
  })

  it("prefers the chosen viewer, then a built-in preview, then the longest match", () => {
    const pick = (preferred: string | undefined, builtinPreviews = false) =>
      pickFileViewer({ builtin: "builtin", builtinPreviews, handlers, preferred })
    expect(pick("gz")).toBe("gz")
    expect(pick("builtin")).toBe("builtin")
    expect(pick(undefined, true)).toBe("builtin")
    expect(pick(undefined)).toBe("gz")
    // A viewer that is no longer installed falls back to the default order.
    expect(pick("removed", true)).toBe("builtin")
  })
})

describe("withAppPolicy", () => {
  it("derives the App's policy from its declared domains and drops anything else", () => {
    const html = withAppPolicy("<html><head><title>x</title></head></html>", {
      ui: {
        csp: {
          connectDomains: ["https://api.example.com", "http://insecure.example.com", "*"],
          resourceDomains: ["https://cdn.example.com", "https://*.images.example.com", "data:"],
        },
      },
    })
    const policy = /content="([^"]+)"/u.exec(html)?.[1] ?? ""
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<title>"))
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src https://api.example.com;")
    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' https://cdn.example.com https://*.images.example.com data:"
    )
    expect(policy).toContain("frame-src 'none'")
    expect(policy).not.toContain("insecure")
  })
})

describe("parseElicitationSchema", () => {
  it("reads standard and OpenAI form fields with their defaults", () => {
    const parsed = parseElicitationSchema({
      properties: {
        accessories: {
          items: { type: "string", "x-openai-suggestions": [{ const: "washer", title: "Washer" }] },
          type: "array",
        },
        count: { maximum: 5, type: "integer" },
        part: {
          default: "hex-bolt",
          oneOf: [
            {
              const: "hex-bolt",
              description: "A fastener",
              title: "M6 hex bolt",
              "x-openai-thumbnail": { src: "https://example.com/bolt.png" },
            },
          ],
          type: "string",
        },
        reference: {
          type: "string",
          "x-openai-input": {
            options: [{ name: "bolt", title: "Bolt", uri: "cad://parts/bolt" }],
            type: "resource",
          },
        },
      },
      required: ["part"],
      type: "object",
    })
    expect(parsed?.defaults).toEqual({ part: "hex-bolt" })
    expect(parsed?.fields.map((field) => [field.key, field.field.kind, field.required])).toEqual([
      ["accessories", "multi", false],
      ["count", "number", false],
      ["part", "choice", true],
      ["reference", "choice", false],
    ])
    expect(parsed?.fields[2]?.field).toMatchObject({
      options: [
        { description: "A fastener", thumbnail: "https://example.com/bolt.png", value: "hex-bolt" },
      ],
    })
  })

  it("refuses a form with a field it cannot show instead of showing part of it", () => {
    expect(
      parseElicitationSchema({
        properties: {
          files: {
            items: { type: "string" },
            type: "array",
            "x-openai-input": { options: [], selection: "implicit", type: "resource" },
          },
        },
        type: "object",
      })
    ).toBeNull()
    expect(
      parseElicitationSchema({ properties: { nested: { type: "object" } }, type: "object" })
    ).toBeNull()
  })
})
