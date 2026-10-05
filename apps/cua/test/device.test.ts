import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { type ChromeSessions, CuaDevice, type NativeAppsBackend } from "../src/host/index.ts"

describe("cua device", () => {
  it("validates requests again and reports missing backends", async () => {
    const device = new CuaDevice({})
    expect(device.capabilities).toEqual({ chrome: false, computer: false })
    await expect(device.handle({ op: "iab.tabs" }, { threadId: "t" })).rejects.toThrow(
      /Invalid device request/u
    )
    await expect(device.handle({ op: "apps.list" }, { threadId: "t" })).rejects.toThrow(
      /Native app control is unavailable on this device/u
    )
    expect(await device.handle({ op: "browsers.list" }, { threadId: "t" })).toEqual([])
  })

  it("runs browser calls and lifecycle notices for the Thread", async () => {
    const chrome = {
      call: vi.fn(async () => "ok"),
      closeThread: vi.fn(),
      list: vi.fn(async () => []),
      turnEnded: vi.fn(async () => undefined),
    } as unknown as ChromeSessions
    const device = new CuaDevice({ chrome: () => chrome })
    expect(device.capabilities.chrome).toBe(true)
    await device.handle({ op: "device.turnEnded" }, { threadId: "t" })
    await device.handle({ op: "device.closeThread" }, { threadId: "t" })
    await device.handle({ op: "browsers.list" }, { threadId: "t" })
    expect(
      await device.handle(
        { args: [], browser: "chrome", member: "tabs.list", op: "browser.call", backend: "chrome" },
        { cwd: "/work", threadId: "t" }
      )
    ).toBe("ok")
    expect(chrome.turnEnded).toHaveBeenCalledWith("t")
    expect(chrome.closeThread).toHaveBeenCalledWith("t")
    expect(chrome.list).toHaveBeenCalledOnce()
    expect(chrome.call).toHaveBeenCalledWith(expect.objectContaining({ member: "tabs.list" }), {
      cwd: "/work",
      threadId: "t",
    })
  })

  it("serves a finished audio recording in pieces and refuses backends that cannot record", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "cua-audio-")), "a.wav")
    writeFileSync(path, Buffer.from("RIFFwave"))
    const computer = {
      closeThread: vi.fn(),
      startAudioRecording: vi.fn(async () => undefined),
      stopAudioRecording: vi.fn(async () => ({ mimeType: "audio/wav", path })),
    } as unknown as NativeAppsBackend
    const device = new CuaDevice({ computer: () => computer })
    const thread = { threadId: "t" }
    await expect(
      device.handle({ length: 3, offset: 0, op: "apps.audio.read" }, thread)
    ).rejects.toThrow(/No finished computer audio recording/u)
    await device.handle({ maxDurationMs: 5000, op: "apps.audio.start" }, thread)
    expect(computer.startAudioRecording).toHaveBeenCalledWith("t", 5000)
    expect(await device.handle({ op: "apps.audio.stop" }, thread)).toEqual({
      mimeType: "audio/wav",
      size: 8,
    })
    const read = (offset: number) =>
      device.handle({ length: 6, offset, op: "apps.audio.read" }, thread) as Promise<string>
    expect(Buffer.from((await read(0)) + (await read(6)), "base64").toString()).toBe("RIFFwave")
    await device.handle({ op: "device.closeThread" }, thread)
    await expect(read(0)).rejects.toThrow(/No finished computer audio recording/u)

    const cannot = new CuaDevice({ computer: () => ({ closeThread: vi.fn() }) as never })
    await expect(cannot.handle({ op: "apps.audio.start" }, thread)).rejects.toThrow(
      /cannot record computer audio/u
    )
  })
})
