import { afterEach, describe, expect, it } from "vitest"

import { AUDIO_CHUNK_BYTES } from "../src/audio.ts"
import { createAppsApi } from "../src/runtime/apps.ts"
import { SnapshotHistory } from "../src/runtime/diff.ts"
import { Documentation } from "../src/runtime/docs.ts"

const install = (rpc: (service: string, request: Record<string, unknown>) => unknown) => {
  const written: string[] = []
  Reflect.set(globalThis, "nodeRepl", {
    env: {},
    rpc: async (service: string, request: Record<string, unknown>) => rpc(service, request),
    write: (text: string) => written.push(text),
  })
  return written
}

describe("computer audio in the runtime", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "nodeRepl")
  })

  it("is offered, and documented, only when the REPL can emit audio", () => {
    const written = install(() => null)
    const without = createAppsApi(new SnapshotHistory(), new Documentation("macOS"), "darwin")
    expect("start_audio_recording" in without.computer).toBe(false)

    const docs = new Documentation("macOS", true)
    const withAudio = createAppsApi(new SnapshotHistory(), docs, "darwin")
    expect("start_audio_recording" in withAudio.computer).toBe(true)
    docs.enterApps()
    expect(written.join("\n")).toContain("## Computer audio")
  })

  it("starts a recording and reads it back in pieces as one data URL", async () => {
    const size = AUDIO_CHUNK_BYTES + 3
    const requests: Record<string, unknown>[] = []
    install((service, request) => {
      expect(service).toBe("cua")
      requests.push(request)
      if (request.op === "apps.audio.stop") return { mimeType: "audio/wav", size }
      if (request.op === "apps.audio.read") {
        const offset = request.offset as number
        const length = Math.min(request.length as number, size - offset)
        return Buffer.alloc(length, offset === 0 ? 1 : 2).toString("base64")
      }
      return null
    })
    const api = createAppsApi(new SnapshotHistory(), new Documentation("macOS", true), "darwin")
    const computer = api.computer as typeof api.computer & {
      start_audio_recording(input?: { max_duration_ms?: number }): Promise<void>
      stop_audio_recording(): Promise<{ data_url: string }>
    }
    await computer.start_audio_recording({ max_duration_ms: 5000 })
    const { data_url } = await computer.stop_audio_recording()
    const [header, data] = data_url.split(",")
    expect(header).toBe("data:audio/wav;base64")
    const bytes = Buffer.from(data ?? "", "base64")
    expect(bytes).toHaveLength(size)
    expect(bytes.at(0)).toBe(1)
    expect(bytes.at(-1)).toBe(2)
    expect(requests.map((request) => request.op)).toEqual([
      "apps.audio.start",
      "apps.audio.stop",
      "apps.audio.read",
      "apps.audio.read",
    ])
    expect(requests[0]).toMatchObject({ maxDurationMs: 5000 })
  })
})
