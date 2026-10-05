import {
  characterKey,
  type KeyChord,
  type KeyDefinition,
  MAC_EDITING_COMMANDS,
  type Modifier,
  modifierKey,
  modifierMask,
} from "./keys.ts"
import type { CdpTransport } from "./transport.ts"

export type MouseButton = "left" | "right" | "middle" | "back" | "forward"
export type Point = { readonly x: number; readonly y: number }

const BUTTON_MASKS: Record<MouseButton, number> = {
  back: 8,
  forward: 16,
  left: 1,
  middle: 4,
  right: 2,
}

/**
 * Trusted input for one page through CDP `Input`, so pages see real pointer and key events.
 * Coordinates are CSS pixels in the top-level viewport.
 */
export class PageInput {
  readonly #transport: CdpTransport
  readonly #platform: string
  readonly #dialogOpened: () => Promise<void>
  readonly #pointer: ((point: Point) => Promise<void>) | undefined
  #position: Point = { x: 0, y: 0 }

  /**
   * `dialogOpened` resolves when the page shows a JavaScript dialog: CDP holds back an input
   * event that opened one until the dialog closes, so the opening ends the action instead.
   */
  constructor(
    transport: CdpTransport,
    platform: string,
    dialogOpened: () => Promise<void>,
    /** Shows where the pointer goes before it presses, releases, moves, or scrolls. */
    pointer?: (point: Point) => Promise<void>
  ) {
    this.#transport = transport
    this.#platform = platform
    this.#dialogOpened = dialogOpened
    this.#pointer = pointer
  }

  async #send(method: string, params: Record<string, unknown>): Promise<void> {
    let opened = false
    await Promise.race([
      this.#transport.send(method, params),
      this.#dialogOpened().then(() => {
        opened = true
      }),
    ])
    if (opened) throw DIALOG_OPENED
  }

  async move(point: Point, modifiers: readonly Modifier[] = []): Promise<void> {
    await this.#pointer?.(point)
    await this.#mouse("mouseMoved", point, { button: "none", modifiers: modifierMask(modifiers) })
  }

  async click(
    point: Point,
    options: { button?: MouseButton; clickCount?: number; modifiers?: readonly Modifier[] } = {}
  ): Promise<void> {
    const button = options.button ?? "left"
    const modifiers = modifierMask(options.modifiers ?? [])
    await this.#withModifiers(options.modifiers ?? [], async () => {
      await this.#mouse("mouseMoved", point, { button: "none", modifiers })
      for (let count = 1; count <= (options.clickCount ?? 1); count++) {
        await this.#mouse("mousePressed", point, {
          button,
          buttons: BUTTON_MASKS[button],
          clickCount: count,
          modifiers,
        })
        await this.#mouse("mouseReleased", point, {
          button,
          buttons: 0,
          clickCount: count,
          modifiers,
        })
      }
    })
  }

  async drag(path: readonly Point[], modifiers: readonly Modifier[] = []): Promise<void> {
    const [start, ...rest] = path
    if (!start) return
    const mask = modifierMask(modifiers)
    await this.#withModifiers(modifiers, async () => {
      await this.#mouse("mouseMoved", start, { button: "none", modifiers: mask })
      await this.#mouse("mousePressed", start, {
        button: "left",
        buttons: 1,
        clickCount: 1,
        modifiers: mask,
      })
      // Intermediate steps let pages that track pointer movement see the drag start.
      let previous = start
      for (const point of rest) {
        const steps = Math.max(1, Math.min(10, Math.round(distance(previous, point) / 20)))
        for (let step = 1; step <= steps; step++) {
          await this.#mouse(
            "mouseMoved",
            {
              x: previous.x + ((point.x - previous.x) * step) / steps,
              y: previous.y + ((point.y - previous.y) * step) / steps,
            },
            { button: "left", buttons: 1, modifiers: mask }
          )
        }
        previous = point
      }
      await this.#mouse("mouseReleased", previous, {
        button: "left",
        buttons: 0,
        clickCount: 1,
        modifiers: mask,
      })
    })
  }

  async wheel(
    point: Point,
    delta: { x: number; y: number },
    modifiers: readonly Modifier[] = []
  ): Promise<void> {
    await this.#pointer?.(point)
    await this.#send("Input.dispatchMouseEvent", {
      deltaX: delta.x,
      deltaY: delta.y,
      modifiers: modifierMask(modifiers),
      type: "mouseWheel",
      x: point.x,
      y: point.y,
    })
    this.#position = point
  }

  /** Presses one chord: modifiers down, the key down and up, modifiers up. */
  async press(chord: KeyChord): Promise<void> {
    await this.#withModifiers(chord.modifiers, async () => {
      const mask = modifierMask(chord.modifiers)
      const command =
        this.#platform === "darwin"
          ? MAC_EDITING_COMMANDS[`${[...chord.modifiers].sort().join("+")}+${chord.key.code}`]
          : undefined
      // A modifier chord produces no text, except Shift alone.
      const producesText = chord.modifiers.every((modifier) => modifier === "Shift")
      await this.#key("keyDown", chord.key, mask, {
        commands: command ? [command] : undefined,
        text: producesText ? chord.key.text : undefined,
      })
      await this.#key("keyUp", chord.key, mask)
    })
  }

  /**
   * Types text: printable US-layout characters as key presses, so key handlers run, and
   * anything else, such as emoji or other scripts, as inserted text.
   */
  async type(text: string): Promise<void> {
    for (const character of text) {
      if (character === "\n" || character === "\r") {
        await this.#key("keyDown", ENTER, 0, { text: "\r" })
        await this.#key("keyUp", ENTER, 0)
        continue
      }
      const key = characterKey(character)
      if (!key) {
        await this.#send("Input.insertText", { text: character })
        continue
      }
      const mask = key.shift ? modifierMask(["Shift"]) : 0
      await this.#key("keyDown", key.key, mask, { text: character })
      await this.#key("keyUp", key.key, mask)
    }
  }

  async insertText(text: string): Promise<void> {
    await this.#send("Input.insertText", { text })
  }

  async #withModifiers(modifiers: readonly Modifier[], run: () => Promise<void>): Promise<void> {
    let mask = 0
    for (const modifier of modifiers) {
      mask |= modifierMask([modifier])
      await this.#key("keyDown", modifierKey(modifier), mask)
    }
    try {
      await run()
    } finally {
      for (const modifier of [...modifiers].reverse()) {
        mask &= ~modifierMask([modifier])
        await this.#key("keyUp", modifierKey(modifier), mask).catch(() => {})
      }
    }
  }

  async #mouse(type: string, point: Point, params: Record<string, unknown>): Promise<void> {
    if (type === "mousePressed" || type === "mouseReleased") await this.#pointer?.(point)
    await this.#send("Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      ...params,
    })
    this.#position = point
  }

  async #key(
    type: "keyDown" | "keyUp",
    key: KeyDefinition,
    modifiers: number,
    options: { text?: string | undefined; commands?: string[] | undefined } = {}
  ): Promise<void> {
    await this.#send("Input.dispatchKeyEvent", {
      code: key.code,
      key: key.key,
      location: key.location ?? 0,
      modifiers,
      type:
        type === "keyDown" && options.text ? "keyDown" : type === "keyDown" ? "rawKeyDown" : type,
      windowsVirtualKeyCode: key.keyCode,
      ...(type === "keyDown" && options.text
        ? { text: options.text, unmodifiedText: options.text }
        : {}),
      ...(options.commands ? { commands: options.commands } : {}),
    })
  }

  get position(): Point {
    return this.#position
  }
}

/** Thrown inside an action to stop it once a dialog opened; the action itself succeeded. */
export const DIALOG_OPENED = new Error("dialog opened")

const ENTER: KeyDefinition = { code: "Enter", key: "Enter", keyCode: 13, text: "\r" }

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** CUA button numbers: 1 left, 2 middle, 3 right, 4 back, 5 forward. */
export const cuaButton = (button: number | undefined): MouseButton =>
  (["left", "middle", "right", "back", "forward"] as const)[(button ?? 1) - 1] ?? "left"

/** Accessibility API button names, with their one-letter forms. */
export const axButton = (button: string | undefined): MouseButton => {
  switch (button) {
    case "r":
    case "right":
      return "right"
    case "m":
    case "middle":
      return "middle"
    default:
      return "left"
  }
}
