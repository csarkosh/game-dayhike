/**
 * A stand-in document for the screens built with DOM calls: this suite runs
 * under vitest's `node` environment, with no DOM. It models only what those
 * tests lean on, and models it the way a browser does where a test could
 * otherwise pass for the wrong reason:
 *
 * - setting a select's `value`, or an option's `selected`, fires nothing; a
 *   `change` comes only from `choose`, the stand-in for a person picking;
 * - a person's pick fires nothing when it changes nothing, and never lands
 *   on a disabled option; a value no option has selects nothing;
 * - a focused node taken out of the page, disabled, or put under an inert
 *   ancestor loses the focus to the body, so a repaint that rebuilt the
 *   control, or a focus move that never happened, shows as lost focus;
 * - nothing hidden, disabled, inert or under `display: none` takes the
 *   focus or a click, and a pointer's click focuses the control it lands on,
 *   as Chrome and Firefox do;
 * - a script unselecting the chosen option selects the first one again.
 *
 * Styles are known only as set inline (`style.display`): a class that hides
 * a node through a stylesheet (`.pausemenu` without `.open`) is invisible
 * here, so focus survives it where a browser would drop it.
 */
import { vi } from "vitest";

type Listener = (event: StandInEvent) => void;

export type StandInEvent = {
  type: string;
  target: StandInElement;
  code?: string;
  key?: string;
  /** A click's count: 0 for a click no pointer made (Enter or Space on a button). */
  detail?: number;
  defaultPrevented: boolean;
  preventDefault(): void;
};

export class StandInElement {
  readonly tagName: string;
  children: StandInElement[] = [];
  parent: StandInElement | null = null;
  className = "";
  id = "";
  type = "";
  name = "";
  htmlFor = "";
  private isHidden = false;
  private isDisabled = false;
  private isInert = false;
  /** Inline styles; a write re-checks the focus, as `display: none` can
   * take it away. */
  readonly style: Record<string, string> = new Proxy({} as Record<string, string>, {
    set: (target, key, value) => {
      target[key as string] = String(value);
      this.doc.focusFixup();
      return true;
    },
  });
  private text = "";
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly doc: StandInDocument,
    tag: string,
  ) {
    this.tagName = tag.toUpperCase();
  }

  get hidden(): boolean {
    return this.isHidden;
  }
  set hidden(on: boolean) {
    this.isHidden = on;
    this.doc.focusFixup();
  }
  get disabled(): boolean {
    return this.isDisabled;
  }
  set disabled(on: boolean) {
    this.isDisabled = on;
    this.doc.focusFixup();
  }
  get inert(): boolean {
    return this.isInert;
  }
  set inert(on: boolean) {
    this.isInert = on;
    this.doc.focusFixup();
  }

  get textContent(): string {
    return this.children.length > 0 ? this.children.map((c) => c.textContent).join("") : this.text;
  }
  set textContent(value: string) {
    for (const child of this.children) this.detach(child);
    this.children = [];
    this.text = value;
  }

  get classList() {
    const names = (): string[] => this.className.split(/\s+/).filter((n) => n !== "");
    return {
      add: (n: string) => {
        if (!names().includes(n)) this.className = [...names(), n].join(" ");
      },
      remove: (n: string) => {
        this.className = names().filter((m) => m !== n).join(" ");
      },
      toggle: (n: string, on?: boolean) => {
        const want = on ?? !names().includes(n);
        if (want) this.classList.add(n);
        else this.classList.remove(n);
        return want;
      },
      contains: (n: string) => names().includes(n),
    };
  }

  /** This element and every element above it, nearest first. */
  ancestry(): StandInElement[] {
    return [this, ...(this.parent?.ancestry() ?? [])];
  }

  get isConnected(): boolean {
    return this.ancestry().includes(this.doc.body);
  }

  append(...nodes: (StandInElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        const text = new StandInElement(this.doc, "#text");
        text.textContent = node;
        text.parent = this;
        this.children.push(text);
        continue;
      }
      node.parent?.removeChild(node);
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: StandInElement[]): void {
    for (const child of this.children) this.detach(child);
    this.children = [];
    this.append(...nodes);
  }

  remove(): void {
    this.parent?.removeChild(this);
  }

  removeChild(node: StandInElement): void {
    this.children = this.children.filter((c) => c !== node);
    this.detach(node);
  }

  private detach(node: StandInElement): void {
    node.parent = null;
    this.doc.focusFixup();
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  /** Fires `event` here and bubbles it up the page and out to the window. */
  dispatch(type: string, extra: Partial<StandInEvent> = {}): StandInEvent {
    const event: StandInEvent = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      ...extra,
    };
    for (const node of this.ancestry()) for (const listener of node.listeners.get(type) ?? []) listener(event);
    if (this.isConnected) this.doc.window.fire(event);
    return event;
  }
  /** A pointer's click: it focuses the control it lands on, then fires,
   * counting one click. Nothing that cannot take the focus gets one. */
  click(): void {
    if (!this.focusable) return;
    if (FOCUSED_BY_CLICK.has(this.tagName)) this.focus();
    this.dispatch("click", { detail: 1 });
  }
  /** Enter or Space on a focused button: the button has the focus, and the
   * click it fires counts no pointer's clicks. */
  press(): void {
    if (!this.focusable) return;
    this.focus();
    this.dispatch("click", { detail: 0 });
  }

  /** As a browser: nothing out of the page, disabled, hidden, or under an
   * inert or `display: none` ancestor can hold the focus. */
  get focusable(): boolean {
    if (this === this.doc.body) return true;
    if (this.disabled || !this.isConnected) return false;
    return !this.ancestry().some((node) => node.inert || node.hidden || node.style.display === "none");
  }
  focus(): void {
    if (this.focusable) this.doc.activeElement = this;
  }

  /** Every element below this one, in document order. */
  descendants(): StandInElement[] {
    return this.children.filter((c) => c.tagName !== "#TEXT").flatMap((c) => [c, ...c.descendants()]);
  }
  /** A tag name with classes (`select`, `button.secondary.settings`, …):
   * nothing here needs more, and anything more throws. */
  querySelector(selector: string): StandInElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): StandInElement[] {
    const m = /^([a-z0-9]+)((?:\.[a-z0-9-]+)*)$/.exec(selector);
    if (m === null) throw new Error(`the stand-in document matches a tag and classes only, not ${selector}`);
    const tag = m[1]!.toUpperCase();
    const classes = m[2]!.split(".").filter((c) => c !== "");
    return this.descendants().filter((el) => el.tagName === tag && classes.every((c) => el.classList.contains(c)));
  }

  /** `:open`, where a test says the browser supports it; otherwise a
   * browser without it, which throws on the selector. */
  openState: boolean | "unsupported" = "unsupported";
  matches(selector: string): boolean {
    if (selector !== ":open") throw new Error(`the stand-in document matches :open only, not ${selector}`);
    if (this.openState === "unsupported") throw new SyntaxError("':open' is not a valid selector");
    return this.openState;
  }
}

const FOCUSED_BY_CLICK = new Set(["BUTTON", "SELECT", "INPUT", "TEXTAREA", "A"]);

export class StandInOption extends StandInElement {
  value = "";
  private isSelected = false;
  get selected(): boolean {
    return this.isSelected;
  }
  /** A script's write. A single select holds one selected option: selecting
   * one clears the others, and unselecting the last leaves the first one
   * not disabled selected, as a browser's does. */
  set selected(on: boolean) {
    this.setSelectedness(on);
    if (!on && this.parent instanceof StandInSelect) this.parent.reset();
  }
  /** The selectedness alone, with no reset (a select's own value write). */
  setSelectedness(on: boolean): void {
    if (on && this.parent instanceof StandInSelect) for (const o of this.parent.options) o.isSelected = false;
    this.isSelected = on;
  }
}

export class StandInSelect extends StandInElement {
  get options(): StandInOption[] {
    return this.children.filter((c): c is StandInOption => c instanceof StandInOption);
  }
  get selectedIndex(): number {
    return this.options.findIndex((o) => o.selected);
  }
  get value(): string {
    return this.options[this.selectedIndex]?.value ?? "";
  }
  /** A script's write: selects the matching option, or none where no option
   * has that value, and fires nothing, as a browser does. */
  set value(v: string) {
    for (const o of this.options) o.setSelectedness(false);
    const match = this.options.find((o) => o.value === v);
    if (match !== undefined) match.setSelectedness(true);
  }
  /** With none selected, the first option not disabled is. */
  reset(): void {
    if (this.selectedIndex !== -1) return;
    this.options.find((o) => !o.disabled)?.setSelectedness(true);
  }
  /** Options going in with none selected: the first one not disabled is, as a
   * browser's single select does on insertion. */
  override append(...nodes: (StandInElement | string)[]): void {
    super.append(...nodes);
    this.reset();
  }
  /** A person picking `value`: the selection moves, then `input` and
   * `change` fire, in that order, as a browser fires them. Nothing happens
   * for a disabled select, a disabled or missing option, or the value
   * already chosen. */
  choose(value: string): void {
    if (this.disabled) return;
    const option = this.options.find((o) => o.value === value);
    if (option === undefined || option.disabled || option.selected) return;
    this.value = value;
    this.dispatch("input");
    this.dispatch("change");
  }
}

export class StandInWindow {
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  fire(event: StandInEvent): void {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

export class StandInDocument {
  readonly window = new StandInWindow();
  readonly body: StandInElement;
  activeElement: StandInElement;
  /** The focus fixup: focus held by a node that can no longer hold it goes
   * to the body. */
  focusFixup(): void {
    if (!this.activeElement.focusable) this.activeElement = this.body;
  }
  constructor() {
    this.body = new StandInElement(this, "body");
    this.activeElement = this.body;
  }
  createElement(tag: string): StandInElement {
    if (tag === "select") return new StandInSelect(this, tag);
    if (tag === "option") return new StandInOption(this, tag);
    return new StandInElement(this, tag);
  }
  createTextNode(text: string): StandInElement {
    const node = new StandInElement(this, "#text");
    node.textContent = text;
    return node;
  }
}

/** A fresh stand-in document, installed as `document` and `window` until
 * `vi.unstubAllGlobals()`. */
export function installStandInDom(): StandInDocument {
  const doc = new StandInDocument();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", doc.window);
  return doc;
}

/** The stand-in as the DOM type the code under test takes. */
export const asHtml = (el: StandInElement): HTMLElement => el as unknown as HTMLElement;
