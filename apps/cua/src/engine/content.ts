/**
 * Exports of a page's content to a file: Google Workspace documents through Google's own export
 * endpoint, and YouTube transcripts through the caption request the player itself makes. Both
 * run with the page's signed-in session, so they work for documents and videos the user can open.
 */

export const GSUITE_EXPORT_TYPES = ["pdf", "md", "xlsx", "csv", "docx", "pptx"] as const
export type GsuiteExportType = (typeof GSUITE_EXPORT_TYPES)[number]

type GoogleDocType = "document" | "spreadsheets" | "presentation"

/** The export types Google offers for each kind of document. */
const GSUITE_TYPES: Record<GoogleDocType, readonly GsuiteExportType[]> = {
  document: ["pdf", "md", "docx"],
  presentation: ["pdf", "pptx"],
  spreadsheets: ["pdf", "xlsx", "csv"],
}

const DOC_NAMES: Record<GoogleDocType, string> = {
  document: "Google Docs document",
  presentation: "Google Slides presentation",
  spreadsheets: "Google Sheets spreadsheet",
}

export type GoogleDoc = { readonly docType: GoogleDocType; readonly id: string; readonly url: URL }

/** The Google Workspace document a URL shows, or null for any other page or a published copy. */
export const parseGoogleDoc = (href: string): GoogleDoc | null => {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null
  const parts = url.pathname.split("/").filter(Boolean)
  const docType = parts[0]
  if (docType !== "document" && docType !== "spreadsheets" && docType !== "presentation") {
    return null
  }
  const marker = parts.indexOf("d", 1)
  const id = marker < 0 ? undefined : parts[marker + 1]
  if (!id || parts.at(-1) === "pub") return null
  return { docType, id, url }
}

/**
 * The export URL of a document in a format it supports; a spreadsheet keeps the sheet the tab
 * shows and a multi-tab document the tab it shows.
 */
export const gsuiteExportUrl = (doc: GoogleDoc, type: GsuiteExportType): string => {
  const allowed = GSUITE_TYPES[doc.docType]
  if (!allowed.includes(type)) {
    throw new RangeError(
      `A ${DOC_NAMES[doc.docType]} exports as ${allowed.join(", ")}, not ${type}.`
    )
  }
  const url = new URL(`https://docs.google.com/${doc.docType}/d/${doc.id}/export`)
  url.searchParams.set("format", type)
  const tab = doc.url.searchParams.get("tab")
  if (tab) url.searchParams.set("tab", tab)
  const gid = /(?:^|[#&])gid=(\d+)/u.exec(doc.url.hash)?.[1] ?? doc.url.searchParams.get("gid")
  if (gid && doc.docType === "spreadsheets") url.searchParams.set("gid", gid)
  return url.toString()
}

/**
 * Markdown exports inline every image as a data URL reference; dropping them keeps the text
 * readable. The image positions stay as their alt text.
 */
export const stripInlineImages = (markdown: string): string =>
  markdown.replace(/^\s*\[[^\]]+\]:\s*<data:[^>]+>\s*$\n?/gmu, "").trimEnd()

/** A file name from a page title, without the product suffix Google and YouTube add. */
export const titleFilename = (title: string | undefined, fallback: string): string => {
  const base = (title ?? "")
    .replace(/\s+-\s+(Google (Docs|Sheets|Slides)|YouTube)$/u, "")
    .replace(/^\(\d+\)\s+/u, "")
    .replaceAll(/[/\\?%*|"<>:]/gu, "_")
    .trim()
  return (base || fallback).slice(0, 120)
}

/** The YouTube video a URL shows, or null when it is not an HTTPS watch page. */
export const youtubeVideoId = (href: string): string | null => {
  try {
    const url = new URL(href)
    if (url.protocol !== "https:") return null
    if (url.hostname !== "www.youtube.com" && url.hostname !== "youtube.com") return null
    if (url.pathname !== "/watch") return null
    return url.searchParams.get("v") || null
  } catch {
    return null
  }
}

/** Transcripts longer than this are cut, with a note at the end. */
export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024

export type TranscriptOutcome =
  | { readonly ok: true; readonly title: string; readonly lines: readonly string[] }
  | { readonly ok: false; readonly reason: "no_player" | "no_captions" | "fetch_failed" }

/** Joins transcript lines into a file's text, cutting it at the size limit. */
export const transcriptText = (lines: readonly string[]): string => {
  const kept: string[] = []
  let size = 0
  for (const line of lines) {
    size += Buffer.byteLength(line) + 1
    if (size > MAX_TRANSCRIPT_BYTES) {
      kept.push("", "[Transcript truncated]")
      break
    }
    kept.push(line)
  }
  return `${kept.join("\n")}\n`
}

/**
 * Runs in a YouTube watch page. The player requests captions with tokens only it can make, so
 * the script turns captions on, watches for the player's own caption request, restores the
 * captions setting, and fetches that request again as JSON. Each caption becomes one
 * `[m:ss] text` line.
 */
export const youtubeTranscriptScript = (
  videoId: string,
  timeoutMs: number
): string => `(async () => {
  const videoId = ${JSON.stringify(videoId)};
  const player = document.getElementById("movie_player");
  const call = (name) => typeof player?.[name] === "function" ? player[name]() : undefined;
  if (!player || typeof player.toggleSubtitles !== "function" || call("getVideoData")?.video_id !== videoId) {
    return { ok: false, reason: "no_player" };
  }
  const since = performance.now();
  let request = null;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime + 0.5 < since) continue;
      try {
        const url = new URL(entry.name);
        if (url.hostname === "www.youtube.com" && url.pathname === "/api/timedtext" && url.searchParams.get("v") === videoId) request = entry.name;
      } catch {}
    }
  });
  observer.observe({ buffered: true, type: "resource" });
  const wasOn = !!call("isSubtitlesOn");
  try {
    if (wasOn) call("toggleSubtitles");
    if (typeof player.toggleSubtitlesOn === "function") player.toggleSubtitlesOn(); else call("toggleSubtitles");
    const deadline = Date.now() + ${timeoutMs};
    while (!request && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    const on = !!call("isSubtitlesOn");
    if (on !== wasOn) call(wasOn ? "toggleSubtitlesOn" : "toggleSubtitles");
    observer.disconnect();
  }
  if (!request) return { ok: false, reason: "no_captions" };
  const url = new URL(request);
  url.searchParams.set("fmt", "json3");
  const response = await fetch(url, { credentials: "include" }).catch(() => null);
  if (!response?.ok) return { ok: false, reason: "fetch_failed" };
  const data = await response.json().catch(() => null);
  const lines = [];
  for (const event of data?.events ?? []) {
    const text = (event.segs ?? []).map((segment) => segment.utf8 ?? "").join("").replace(/\\s+/g, " ").trim();
    if (!text) continue;
    const seconds = Math.floor((event.tStartMs ?? 0) / 1000);
    lines.push("[" + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") + "] " + text);
  }
  return lines.length > 0 ? { ok: true, title: document.title, lines } : { ok: false, reason: "no_captions" };
})()`
