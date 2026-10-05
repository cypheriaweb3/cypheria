import type { BrowserMember } from "../browser/members.ts"
import type { WireImage } from "../browser/types.ts"
import { EngineError } from "../engine/errors.ts"
import { type KeyDefinition, parseChord, parseModifiers } from "../engine/keys.ts"
import { INJECTED_SCRIPT_SOURCE } from "../vendor/playwright-injected.ts"

/** Where the injected script lives in the App's main world, as in the CDP engine. */
const INJECTED_KEY = "cypheria.cua.injected"
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_DOM_SNAPSHOT = 200_000

/**
 * One document a DOM-only tab acts on, such as the frame of an MCP App. The host evaluates
 * expressions in the document's main world and can capture it as shown.
 */
export interface DomFrame {
  /** Evaluates an expression and resolves to its JSON value, awaiting a returned promise. */
  evaluate(expression: string): Promise<unknown>
  /** Captures the document as the person sees it. */
  screenshot(): Promise<{ readonly data: Uint8Array; readonly mimeType: string }>
}

/** Helpers every call has in scope beside Playwright's injected script. */
const HELPERS = `
const SEPARATOR = /\\s*>>\\s*internal:control=enter-frame\\s*>>\\s*/u;
const fail = (code, message, retryable) => Object.assign(new Error(message), { code, retryable: !!retryable });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scope = (selector) => {
  const parts = selector.split(SEPARATOR);
  let root = document;
  for (const part of parts.slice(0, -1)) {
    const frames = injected.querySelectorAll(injected.parseSelector(part), root);
    if (frames.length > 1) throw fail("strict_mode", "The frame locator matches " + frames.length + " frames; make it specific.");
    const inner = frames[0] && frames[0].contentDocument;
    if (!inner) throw fail("not_found", "No same-origin frame matches " + part + ".", true);
    root = inner;
  }
  return { root, inner: parts[parts.length - 1] };
};
const all = (selector) => {
  const { root, inner } = scope(selector);
  return injected.querySelectorAll(injected.parseSelector(inner), root);
};
const first = (selector) => {
  try { return all(selector)[0] ?? null; } catch (error) { if (error.code === "not_found") return null; throw error; }
};
const single = async (selector, state, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let last = "it does not exist yet";
  for (;;) {
    let found = [];
    try { found = all(selector); } catch (error) { if (error.code !== "not_found") throw error; }
    if (found.length > 1) throw fail("strict_mode", "The locator matches " + found.length + " elements; narrow it with first(), nth(), filter(), or a more specific locator.");
    const element = found[0];
    if (element) {
      if (state === "attached") return element;
      if (!injected.elementState(element, "visible").matches) last = "it is not visible";
      else if (state === "enabled" && !injected.elementState(element, "enabled").matches) last = "it is disabled";
      else if (state === "editable" && !injected.elementState(element, "editable").matches) last = "it is not editable";
      else return element;
    }
    if (Date.now() >= deadline) throw fail("timeout", "Timed out after " + timeoutMs + " ms waiting for the locator: " + last + ".", true);
    await sleep(100);
  }
};
const flags = (modifiers) => ({
  altKey: modifiers.includes("Alt"),
  ctrlKey: modifiers.includes("Control"),
  metaKey: modifiers.includes("Meta"),
  shiftKey: modifiers.includes("Shift"),
});
const FOCUSABLE = "input, textarea, select, button, a[href], [tabindex], [contenteditable]";
const focus = (element) => {
  const target = element.closest ? element.closest(FOCUSABLE) ?? element : element;
  if (target.ownerDocument.activeElement !== target && typeof target.focus === "function") target.focus();
  return target;
};
const click = (element, button, count, modifiers) => {
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const view = element.ownerDocument.defaultView;
  const hit = element.ownerDocument.elementFromPoint(x, y);
  const target = hit && (hit === element || element.contains(hit)) ? hit : element;
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view, button: { left: 0, middle: 1, right: 2 }[button] ?? 0, ...flags(modifiers) };
  const pointer = { ...init, isPrimary: true, pointerId: 1, pointerType: "mouse" };
  for (let detail = 1; detail <= count; detail++) {
    target.dispatchEvent(new view.PointerEvent("pointerdown", { ...pointer, detail }));
    target.dispatchEvent(new view.MouseEvent("mousedown", { ...init, detail }));
    if (detail === 1) focus(target);
    target.dispatchEvent(new view.PointerEvent("pointerup", { ...pointer, detail }));
    target.dispatchEvent(new view.MouseEvent("mouseup", { ...init, detail }));
    if (button === "right") target.dispatchEvent(new view.MouseEvent("contextmenu", { ...init, detail }));
    else target.dispatchEvent(new view.MouseEvent(button === "left" ? "click" : "auxclick", { ...init, detail }));
  }
  if (count === 2 && button === "left") target.dispatchEvent(new view.MouseEvent("dblclick", { ...init, detail: 2 }));
};
const setValue = (element, value) => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
  if (descriptor && descriptor.set) descriptor.set.call(element, value); else element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};
const insertText = (element, text) => {
  const doc = element.ownerDocument;
  if (text && doc.execCommand("insertText", false, text)) return;
  if (!("value" in element)) throw fail("not_editable", "The element does not accept text.");
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? element.value.length;
  setValue(element, element.value.slice(0, start) + text + element.value.slice(end));
};
const press = (element, key, modifiers) => {
  const view = element.ownerDocument.defaultView;
  const init = { bubbles: true, cancelable: true, composed: true, code: key.code, key: key.key, keyCode: key.keyCode, which: key.keyCode, location: key.location ?? 0, ...flags(modifiers) };
  const proceed = element.dispatchEvent(new view.KeyboardEvent("keydown", init));
  const shortcut = modifiers.some((modifier) => modifier !== "Shift");
  if (proceed && !shortcut) {
    const editable = element.isContentEditable || element.tagName === "TEXTAREA" || (element.tagName === "INPUT" && "value" in element);
    if (key.key === "Enter") {
      if (element.isContentEditable || element.tagName === "TEXTAREA") element.ownerDocument.execCommand("insertLineBreak");
      else if (element.form) element.form.requestSubmit();
      else if (element.tagName === "BUTTON" || element.tagName === "A") element.click();
    } else if (key.key === "Backspace" && editable) {
      element.ownerDocument.execCommand("delete");
    } else if (key.key === "Delete" && editable) {
      element.ownerDocument.execCommand("forwardDelete");
    } else if (key.key === " " && !editable && (element.tagName === "BUTTON" || element.getAttribute("role") === "checkbox")) {
      element.click();
    } else if (key.text && key.key !== "Enter" && editable) {
      element.dispatchEvent(new view.KeyboardEvent("keypress", { ...init, charCode: key.text.charCodeAt(0) }));
      insertText(element, key.text);
    }
  }
  element.dispatchEvent(new view.KeyboardEvent("keyup", init));
};
const plain = (value) => {
  if (value === undefined) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
};
`

/** Page-side functions by member; each receives the call's arguments after `injected`. */
const SCRIPTS: Partial<Record<BrowserMember, string>> = {
  "tab.info": `() => ({ title: document.title, url: location.href })`,
  "playwright.domSnapshot": `() => {
    const clone = document.documentElement.cloneNode(true);
    const frames = document.querySelectorAll("iframe, frame");
    const clones = clone.querySelectorAll("iframe, frame");
    frames.forEach((frame, i) => {
      try {
        const inner = frame.contentDocument;
        if (inner && inner.body && clones[i]) clones[i].setAttribute("data-cypheria-frame-body", inner.body.outerHTML);
      } catch {}
    });
    for (const node of clone.querySelectorAll("script, style, noscript")) node.remove();
    return "<!DOCTYPE html>\\n" + clone.outerHTML;
  }`,
  "playwright.evaluate": `async (arg) => {
    const value = (SOURCE);
    return plain(typeof value === "function" ? await value(arg) : value);
  }`,
  "locator.count": `(selector) => { try { return all(selector).length; } catch (error) { if (error.code === "not_found") return 0; throw error; } }`,
  "locator.allTextContents": `(selector) => { try { return all(selector).map((element) => element.textContent ?? ""); } catch (error) { if (error.code === "not_found") return []; throw error; } }`,
  "locator.textContent": `async (selector, timeoutMs) => (await single(selector, "attached", timeoutMs)).textContent`,
  "locator.innerText": `async (selector, timeoutMs) => {
    const element = await single(selector, "attached", timeoutMs);
    return element.innerText ?? element.textContent ?? "";
  }`,
  "locator.getAttribute": `async (selector, timeoutMs, name) => (await single(selector, "attached", timeoutMs)).getAttribute(name)`,
  "locator.isVisible": `(selector) => { const element = first(selector); return element ? injected.elementState(element, "visible").matches : false; }`,
  "locator.isEnabled": `(selector) => { const element = first(selector); return element ? injected.elementState(element, "enabled").matches : false; }`,
  "locator.waitFor": `async (selector, timeoutMs, state) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const element = first(selector);
      const visible = !!element && injected.elementState(element, "visible").matches;
      const matched = state === "attached" ? !!element : state === "detached" ? !element : state === "visible" ? visible : !visible;
      if (matched) return null;
      if (Date.now() >= deadline) throw fail("timeout", "Timed out after " + timeoutMs + " ms waiting for the locator to be " + state + ".", true);
      await sleep(100);
    }
  }`,
  "locator.evaluate": `async (selector, timeoutMs, arg) => {
    const element = await single(selector, "attached", timeoutMs);
    const value = (SOURCE);
    return plain(typeof value === "function" ? await value(element, arg) : value);
  }`,
  "locator.evaluateAll": `async (selector, _timeoutMs, arg) => {
    let elements = [];
    try { elements = all(selector); } catch (error) { if (error.code !== "not_found") throw error; }
    const value = (SOURCE);
    return plain(typeof value === "function" ? await value(elements, arg) : value);
  }`,
  "locator.click": `async (selector, timeoutMs, force, button, count, modifiers) => {
    click(await single(selector, force ? "attached" : "enabled", timeoutMs), button, count, modifiers);
    return null;
  }`,
  "locator.fill": `async (selector, timeoutMs, value) => {
    const element = await single(selector, "editable", timeoutMs);
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const result = injected.fill(element, value);
    if (typeof result === "string" && result.startsWith("error:")) throw fail("fill_failed", "Could not fill: " + result.slice(6) + ".");
    if (result === "needsinput") {
      if (value) insertText(element, value);
      else element.ownerDocument.execCommand("delete");
    }
    return null;
  }`,
  "locator.type": `async (selector, timeoutMs, keys) => {
    const element = focus(await single(selector, "attached", timeoutMs));
    for (const key of keys) press(element, key, []);
    return null;
  }`,
  "locator.press": `async (selector, timeoutMs, key, modifiers) => {
    press(focus(await single(selector, "attached", timeoutMs)), key, modifiers);
    return null;
  }`,
  "locator.setChecked": `async (selector, timeoutMs, force, checked) => {
    const element = await single(selector, force ? "attached" : "enabled", timeoutMs);
    const state = checked ? "checked" : "unchecked";
    if (injected.elementState(element, state).matches) return null;
    click(element, "left", 1, []);
    await sleep(0);
    if (!injected.elementState(element, state).matches) throw fail("check_failed", "Clicking did not " + (checked ? "check" : "uncheck") + " the element.");
    return null;
  }`,
  "locator.selectOption": `async (selector, timeoutMs, values) => {
    const element = await single(selector, "enabled", timeoutMs);
    const result = injected.selectOptions(element, values);
    if (typeof result === "string") throw fail("select_failed", "Could not select: " + result.replace(/^error:/u, "") + ".");
    return result;
  }`,
}

const installScript = () => {
  const options = {
    browserName: "chromium",
    customEngines: [],
    frameSeq: 0,
    isUnderTest: false,
    isUtilityWorld: false,
    sdkLanguage: "javascript",
    shouldPrependErrorPrefix: false,
    stableRafCount: 1,
    testIdAttributeName: "data-testid",
  }
  return `(() => {
    const key = Symbol.for(${JSON.stringify(INJECTED_KEY)});
    if (globalThis[key]) return true;
    const module = {};
    ${INJECTED_SCRIPT_SOURCE}
    const injected = new (module.exports.InjectedScript())(globalThis, ${JSON.stringify(options)});
    Object.defineProperty(globalThis, key, { value: injected, configurable: true });
    return true;
  })()`
}

type Envelope =
  | { readonly install: true }
  | { readonly value: unknown }
  | { readonly error: { code?: string; message: string; retryable?: boolean } }

/**
 * A document driven only through its DOM, for MCP Apps: Playwright locators run on the injected
 * script and actions dispatch synthetic events, since an App has no CDP target, navigation, or
 * native input. It supports the members `mcpapps` browsers list in the support matrix.
 */
export class DomTab {
  readonly #frame: DomFrame
  readonly #platform: string

  constructor(frame: DomFrame, platform: string) {
    this.#frame = frame
    this.#platform = platform
  }

  async call(
    member: BrowserMember,
    args: readonly unknown[],
    options: { readonly selector?: string } = {}
  ): Promise<unknown> {
    const trailing = (args.at(-1) ?? {}) as {
      timeoutMs?: number
      force?: boolean
      button?: string
      modifiers?: string[]
      state?: string
    }
    const timeoutMs =
      (trailing && typeof trailing === "object" ? trailing.timeoutMs : undefined) ??
      DEFAULT_TIMEOUT_MS
    const selector = options.selector ?? ""
    switch (member) {
      case "tab.info":
      case "playwright.domSnapshot": {
        const value = await this.#run(member, [])
        if (member === "tab.info") return value
        const html = String(value)
        return html.length > MAX_DOM_SNAPSHOT
          ? `${html.slice(0, MAX_DOM_SNAPSHOT)}\n<!-- The DOM snapshot is truncated. -->`
          : html
      }
      case "tab.screenshot":
        return this.#screenshot(args[0] as { clip?: unknown; fullPage?: boolean } | undefined)
      case "playwright.evaluate":
        return this.#run(member, [args[1]], String(args[0]))
      case "locator.all": {
        const count = (await this.#run("locator.count", [selector])) as number
        return Array.from({ length: count }, (_, index) => `${selector} >> nth=${index}`)
      }
      case "locator.count":
      case "locator.allTextContents":
      case "locator.isVisible":
      case "locator.isEnabled":
        return this.#run(member, [selector])
      case "locator.textContent":
      case "locator.innerText":
        return this.#run(member, [selector, timeoutMs])
      case "locator.getAttribute":
        return this.#run(member, [selector, timeoutMs, args[0]])
      case "locator.waitFor":
        return this.#run(member, [selector, timeoutMs, trailing.state ?? "visible"])
      case "locator.evaluate":
      case "locator.evaluateAll":
        return this.#run(member, [selector, timeoutMs, args[1]], String(args[0]))
      case "locator.click":
      case "locator.dblclick":
        return this.#run("locator.click", [
          selector,
          timeoutMs,
          trailing.force ?? false,
          trailing.button ?? "left",
          member === "locator.dblclick" ? 2 : 1,
          parseModifiers(trailing.modifiers, this.#platform),
        ])
      case "locator.fill":
        return this.#run(member, [selector, timeoutMs, args[0]])
      case "locator.type":
      case "locator.pressSequentially":
        return this.#run("locator.type", [selector, timeoutMs, this.#keys(String(args[0]))])
      case "locator.press": {
        const chord = parseChord(String(args[0]), this.#platform)
        return this.#run(member, [selector, timeoutMs, chord.key, chord.modifiers])
      }
      case "locator.check":
      case "locator.uncheck":
      case "locator.setChecked":
        return this.#run("locator.setChecked", [
          selector,
          timeoutMs,
          trailing.force ?? false,
          member === "locator.setChecked" ? args[0] : member === "locator.check",
        ])
      case "locator.selectOption":
        return this.#run(member, [
          selector,
          timeoutMs,
          (args[0] as (string | object)[]).map((value) =>
            typeof value === "string" ? { valueOrLabel: value } : value
          ),
        ])
      default:
        throw new EngineError("unsupported", `${member} is not available in an MCP App.`)
    }
  }

  async #screenshot(
    options: { clip?: unknown; fullPage?: boolean } | undefined
  ): Promise<WireImage> {
    if (options?.clip || options?.fullPage) {
      throw new EngineError(
        "unsupported",
        "An MCP App screenshot shows the App as displayed; clip and fullPage are not available."
      )
    }
    const image = await this.#frame.screenshot()
    return {
      dataBase64: Buffer.from(image.data).toString("base64"),
      mimeType: image.mimeType,
      type: "image",
    }
  }

  /** Each character as the key that types it, so typing fires key events per character. */
  #keys(text: string): KeyDefinition[] {
    return [...text].map((character) => {
      if (character === "\n") return parseChord("Enter", this.#platform).key
      try {
        return { ...parseChord(character, this.#platform).key, text: character }
      } catch {
        return { code: "", key: character, keyCode: 0, text: character }
      }
    })
  }

  /**
   * Runs a member's page function. `source` is model code for the evaluate members, written into
   * the expression rather than passed to `eval`, which an App's content security policy may block.
   */
  async #run(member: BrowserMember, args: readonly unknown[], source?: string): Promise<unknown> {
    const template = SCRIPTS[member]
    if (!template) throw new EngineError("unsupported", `${member} is not available in an MCP App.`)
    const script = source === undefined ? template : template.replace("SOURCE", () => source)
    const expression = `(async () => {
      const injected = globalThis[Symbol.for(${JSON.stringify(INJECTED_KEY)})];
      if (!injected) return { install: true };
      ${HELPERS}
      try {
        return { value: await (${script})(...${JSON.stringify(args)}) };
      } catch (error) {
        return { error: { code: error && error.code, message: String((error && error.message) || error), retryable: !!(error && error.retryable) } };
      }
    })()`
    for (let attempt = 0; ; attempt++) {
      const envelope = (await this.#frame.evaluate(expression)) as Envelope | null
      if (envelope && "install" in envelope && attempt === 0) {
        await this.#frame.evaluate(installScript())
        continue
      }
      if (!envelope || "install" in envelope) {
        throw new EngineError("page_gone", "The MCP App did not answer. List the Apps again.")
      }
      if ("error" in envelope) {
        throw new EngineError(envelope.error.code ?? "script_error", envelope.error.message, {
          retryable: envelope.error.retryable ?? false,
        })
      }
      return envelope.value
    }
  }
}
