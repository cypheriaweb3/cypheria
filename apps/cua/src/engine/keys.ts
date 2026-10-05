import { EngineError } from "./errors.ts"

/** One key as CDP `Input.dispatchKeyEvent` describes it. */
export type KeyDefinition = {
  readonly key: string
  readonly code: string
  readonly keyCode: number
  readonly text?: string
  readonly location?: number
}

export type Modifier = "Alt" | "Control" | "Meta" | "Shift"

/** CDP modifier bit masks. */
export const MODIFIER_BITS: Record<Modifier, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }

const named = (key: string, code: string, keyCode: number, text?: string): KeyDefinition => ({
  code,
  key,
  keyCode,
  ...(text !== undefined ? { text } : {}),
})

/** Keys by their DOM `key` name. */
const NAMED_KEYS: Record<string, KeyDefinition> = {
  ArrowDown: named("ArrowDown", "ArrowDown", 40),
  ArrowLeft: named("ArrowLeft", "ArrowLeft", 37),
  ArrowRight: named("ArrowRight", "ArrowRight", 39),
  ArrowUp: named("ArrowUp", "ArrowUp", 38),
  Backspace: named("Backspace", "Backspace", 8),
  CapsLock: named("CapsLock", "CapsLock", 20),
  ContextMenu: named("ContextMenu", "ContextMenu", 93),
  Delete: named("Delete", "Delete", 46),
  End: named("End", "End", 35),
  Enter: named("Enter", "Enter", 13, "\r"),
  Escape: named("Escape", "Escape", 27),
  Home: named("Home", "Home", 36),
  Insert: named("Insert", "Insert", 45),
  PageDown: named("PageDown", "PageDown", 34),
  PageUp: named("PageUp", "PageUp", 33),
  Space: named(" ", "Space", 32, " "),
  Tab: named("Tab", "Tab", 9, "\t"),
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, named(`F${i + 1}`, `F${i + 1}`, 112 + i)])
  ),
}

const MODIFIER_KEYS: Record<Modifier, KeyDefinition> = {
  Alt: { code: "AltLeft", key: "Alt", keyCode: 18, location: 1 },
  Control: { code: "ControlLeft", key: "Control", keyCode: 17, location: 1 },
  Meta: { code: "MetaLeft", key: "Meta", keyCode: 91, location: 1 },
  Shift: { code: "ShiftLeft", key: "Shift", keyCode: 16, location: 1 },
}

/** Lower-case aliases from xdotool, X11 keysyms, and common shorthand. */
const ALIASES: Record<string, string> = {
  backspace: "Backspace",
  bksp: "Backspace",
  caps_lock: "CapsLock",
  del: "Delete",
  delete: "Delete",
  down: "ArrowDown",
  end: "End",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  home: "Home",
  ins: "Insert",
  insert: "Insert",
  kp_enter: "Enter",
  left: "ArrowLeft",
  menu: "ContextMenu",
  next: "PageDown",
  page_down: "PageDown",
  page_up: "PageUp",
  pagedown: "PageDown",
  pageup: "PageUp",
  prior: "PageUp",
  return: "Enter",
  right: "ArrowRight",
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
  up: "ArrowUp",
}

const MODIFIER_ALIASES: Record<string, Modifier | "ControlOrMeta"> = {
  alt: "Alt",
  cmd: "Meta",
  command: "Meta",
  control: "Control",
  controlormeta: "ControlOrMeta",
  ctrl: "Control",
  meta: "Meta",
  option: "Alt",
  opt: "Alt",
  shift: "Shift",
  super: "Meta",
  win: "Meta",
}

/** Printable symbols on a US layout that need Shift, with their unshifted key. */
const SHIFTED: Record<string, string> = {
  "!": "1",
  '"': "'",
  "#": "3",
  $: "4",
  "%": "5",
  "&": "7",
  "(": "9",
  ")": "0",
  "*": "8",
  "+": "=",
  ":": ";",
  "<": ",",
  ">": ".",
  "?": "/",
  "@": "2",
  "^": "6",
  _: "-",
  "{": "[",
  "|": "\\",
  "}": "]",
  "~": "`",
}

const PUNCTUATION_CODES: Record<string, [code: string, keyCode: number]> = {
  "'": ["Quote", 222],
  ",": ["Comma", 188],
  "-": ["Minus", 189],
  ".": ["Period", 190],
  "/": ["Slash", 191],
  ";": ["Semicolon", 186],
  "=": ["Equal", 187],
  "[": ["BracketLeft", 219],
  "\\": ["Backslash", 220],
  "]": ["BracketRight", 221],
  "`": ["Backquote", 192],
}

/** A single printable character as a key press, with Shift when the layout needs it. */
export const characterKey = (character: string): { key: KeyDefinition; shift: boolean } | null => {
  if (/^[a-z]$/u.test(character)) {
    const upper = character.toUpperCase()
    return {
      key: { code: `Key${upper}`, key: character, keyCode: upper.charCodeAt(0), text: character },
      shift: false,
    }
  }
  if (/^[A-Z]$/u.test(character)) {
    return {
      key: {
        code: `Key${character}`,
        key: character,
        keyCode: character.charCodeAt(0),
        text: character,
      },
      shift: true,
    }
  }
  if (/^[0-9]$/u.test(character)) {
    return {
      key: {
        code: `Digit${character}`,
        key: character,
        keyCode: character.charCodeAt(0),
        text: character,
      },
      shift: false,
    }
  }
  if (character === " ") return { key: NAMED_KEYS.Space as KeyDefinition, shift: false }
  const base = SHIFTED[character]
  if (base) {
    const unshifted = characterKey(base)
    if (!unshifted) return null
    return { key: { ...unshifted.key, key: character, text: character }, shift: true }
  }
  const punctuation = PUNCTUATION_CODES[character]
  if (punctuation) {
    return {
      key: { code: punctuation[0], key: character, keyCode: punctuation[1], text: character },
      shift: false,
    }
  }
  return null
}

/** A key chord: modifiers held while one key is pressed. */
export type KeyChord = { readonly modifiers: readonly Modifier[]; readonly key: KeyDefinition }

const resolveKey = (name: string): { key: KeyDefinition; shift: boolean } => {
  const keypad = /^kp_(\d)$/iu.exec(name)
  if (keypad) {
    const digit = keypad[1] as string
    return {
      key: {
        code: `Numpad${digit}`,
        key: digit,
        keyCode: 96 + Number(digit),
        location: 3,
        text: digit,
      },
      shift: false,
    }
  }
  const direct = NAMED_KEYS[name] ?? NAMED_KEYS[ALIASES[name.toLowerCase()] ?? ""]
  if (direct) return { key: direct, shift: false }
  if (/^f\d{1,2}$/iu.test(name)) {
    const key = NAMED_KEYS[name.toUpperCase()]
    if (key) return { key, shift: false }
  }
  if ([...name].length === 1) {
    const character = characterKey(name)
    if (character) return character
    return { key: { code: "", key: name, keyCode: 0, text: name }, shift: false }
  }
  throw new EngineError("invalid_key", `Unknown key "${name}".`)
}

/**
 * Parses a key or chord such as `"Return"`, `"super+c"`, `"Control+Shift+T"`, `"KP_0"`, or
 * `"a"`. `ControlOrMeta` and `cmd` follow the platform: Meta on macOS, Control elsewhere.
 */
export const parseChord = (value: string, platform: NodeJS.Platform | string): KeyChord => {
  const parts = value.split("+")
  // "+" itself, and chords ending in "+", name the plus key.
  if (parts.at(-1) === "" && parts.length > 1) {
    parts.splice(-2, 2, "+")
  }
  const keyName = (parts.pop() ?? "").trim()
  if (!keyName) throw new EngineError("invalid_key", `Invalid key "${value}".`)
  const modifiers = new Set<Modifier>()
  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part.trim().toLowerCase()]
    if (!alias) throw new EngineError("invalid_key", `Unknown modifier "${part}" in "${value}".`)
    modifiers.add(alias === "ControlOrMeta" ? (platform === "darwin" ? "Meta" : "Control") : alias)
  }
  const modifierOnly = MODIFIER_ALIASES[keyName.toLowerCase()]
  if (modifierOnly && modifierOnly !== "ControlOrMeta") {
    return { key: MODIFIER_KEYS[modifierOnly], modifiers: [...modifiers] }
  }
  const resolved = resolveKey(keyName)
  if (resolved.shift) modifiers.add("Shift")
  return { key: resolved.key, modifiers: [...modifiers] }
}

/** The modifiers for names such as `"Shift"`, `"CTRL"`, or `"ControlOrMeta"`. */
export const parseModifiers = (
  names: readonly string[] | undefined,
  platform: NodeJS.Platform | string
): Modifier[] => {
  const modifiers = new Set<Modifier>()
  for (const name of names ?? []) {
    const alias = MODIFIER_ALIASES[name.trim().toLowerCase()]
    if (!alias) throw new EngineError("invalid_key", `Unknown modifier "${name}".`)
    modifiers.add(alias === "ControlOrMeta" ? (platform === "darwin" ? "Meta" : "Control") : alias)
  }
  return [...modifiers]
}

export const modifierMask = (modifiers: readonly Modifier[]): number =>
  modifiers.reduce((mask, modifier) => mask | MODIFIER_BITS[modifier], 0)

export const modifierKey = (modifier: Modifier): KeyDefinition => MODIFIER_KEYS[modifier]

/** Editing commands Chromium runs for macOS shortcuts that its key events alone do not trigger. */
export const MAC_EDITING_COMMANDS: Record<string, string> = {
  "Meta+KeyA": "selectAll",
  "Meta+KeyC": "copy",
  "Meta+KeyV": "paste",
  "Meta+KeyX": "cut",
  "Meta+KeyZ": "undo",
  "Meta+Shift+KeyZ": "redo",
}
