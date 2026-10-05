import { describe, expect, it, vi } from "vitest"

import {
  gsuiteExportUrl,
  MAX_TRANSCRIPT_BYTES,
  parseGoogleDoc,
  stripInlineImages,
  type TranscriptOutcome,
  titleFilename,
  transcriptText,
  youtubeTranscriptScript,
  youtubeVideoId,
} from "../src/engine/content.ts"

describe("Google Workspace exports", () => {
  it("recognizes documents, sheets, and slides but not published copies", () => {
    expect(parseGoogleDoc("https://docs.google.com/document/d/abc123/edit")).toMatchObject({
      docType: "document",
      id: "abc123",
    })
    expect(parseGoogleDoc("https://docs.google.com/spreadsheets/u/1/d/s1/edit")?.id).toBe("s1")
    expect(parseGoogleDoc("https://docs.google.com/document/d/abc/pub")).toBeNull()
    expect(parseGoogleDoc("https://drive.google.com/file/d/abc/view")).toBeNull()
    expect(parseGoogleDoc("http://docs.google.com/document/d/abc/edit")).toBeNull()
  })

  it("builds export URLs in the formats each kind supports", () => {
    const doc = parseGoogleDoc("https://docs.google.com/document/d/abc/edit?tab=t.0")
    const sheet = parseGoogleDoc("https://docs.google.com/spreadsheets/d/s1/edit#gid=42")
    if (!doc || !sheet) throw new Error("parse failed")
    expect(gsuiteExportUrl(doc, "md")).toBe(
      "https://docs.google.com/document/d/abc/export?format=md&tab=t.0"
    )
    expect(gsuiteExportUrl(sheet, "csv")).toBe(
      "https://docs.google.com/spreadsheets/d/s1/export?format=csv&gid=42"
    )
    expect(() => gsuiteExportUrl(doc, "xlsx")).toThrow(/exports as pdf, md, docx/u)
  })

  it("drops inline images from Markdown and names files after the title", () => {
    expect(
      stripInlineImages("# Title\n![chart][image1]\n\n[image1]: <data:image/png;base64,AAA>\n")
    ).toBe("# Title\n![chart][image1]")
    expect(titleFilename("Q3 plan: draft - Google Docs", "Document")).toBe("Q3 plan_ draft")
    expect(titleFilename("(3) Launch talk - YouTube", "v")).toBe("Launch talk")
    expect(titleFilename("", "Document")).toBe("Document")
  })
})

describe("YouTube transcripts", () => {
  it("accepts only HTTPS watch pages", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=abc&t=10")).toBe("abc")
    expect(youtubeVideoId("https://youtube.com/watch?v=abc")).toBe("abc")
    expect(youtubeVideoId("https://www.youtube.com/shorts/abc")).toBeNull()
    expect(youtubeVideoId("http://www.youtube.com/watch?v=abc")).toBeNull()
  })

  it("cuts long transcripts with a note", () => {
    const line = "x".repeat(1024)
    const text = transcriptText(
      Array.from({ length: MAX_TRANSCRIPT_BYTES / 1024 + 10 }, () => line)
    )
    expect(text.endsWith("[Transcript truncated]\n")).toBe(true)
    expect(Buffer.byteLength(text)).toBeLessThan(MAX_TRANSCRIPT_BYTES + 100)
  })

  /** Runs the page script against a fake player that requests captions when they turn on. */
  const runScript = async (options: { captions: boolean; initiallyOn: boolean }) => {
    let on = options.initiallyOn
    let observer:
      | ((list: { getEntries(): { name: string; startTime: number }[] }) => void)
      | undefined
    const caption = "https://www.youtube.com/api/timedtext?v=vid1&pot=token"
    const turnOn = () => {
      on = true
      if (options.captions)
        setTimeout(() => observer?.({ getEntries: () => [{ name: caption, startTime: 10 }] }), 10)
    }
    const player = {
      getVideoData: () => ({ video_id: "vid1" }),
      isSubtitlesOn: () => on,
      toggleSubtitles: () => {
        if (on) on = false
        else turnOn()
      },
      toggleSubtitlesOn: turnOn,
    }
    const fetch = vi.fn(async (url: URL) => ({
      json: async () => ({
        events: [
          { segs: [{ utf8: "Hello" }, { utf8: " world" }], tStartMs: 1_500 },
          { segs: [{ utf8: "\n" }], tStartMs: 2_000 },
          { segs: [{ utf8: "Next  line" }], tStartMs: 75_000 },
        ],
      }),
      ok: url.searchParams.get("fmt") === "json3",
    }))
    const run = new Function(
      "document",
      "performance",
      "PerformanceObserver",
      "fetch",
      `return ${youtubeTranscriptScript("vid1", 1_000)}`
    )
    const outcome = (await run(
      { getElementById: () => player, title: "Launch talk - YouTube" },
      { now: () => 0 },
      class {
        constructor(callback: typeof observer) {
          observer = callback
        }
        observe() {}
        disconnect() {}
      },
      fetch
    )) as TranscriptOutcome
    return { fetch, on: () => on, outcome }
  }

  it("reads the player's own caption request and restores the captions setting", async () => {
    const off = await runScript({ captions: true, initiallyOn: false })
    expect(off.outcome).toEqual({
      lines: ["[0:01] Hello world", "[1:15] Next line"],
      ok: true,
      title: "Launch talk - YouTube",
    })
    expect(off.on()).toBe(false)
    expect(String(off.fetch.mock.calls[0]?.[0])).toContain("pot=token")
    const on = await runScript({ captions: true, initiallyOn: true })
    expect(on.outcome.ok).toBe(true)
    expect(on.on()).toBe(true)
  })

  it("reports a video without captions", async () => {
    const result = await runScript({ captions: false, initiallyOn: false })
    expect(result.outcome).toEqual({ ok: false, reason: "no_captions" })
    expect(result.on()).toBe(false)
  })
})
