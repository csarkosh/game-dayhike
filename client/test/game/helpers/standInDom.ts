/**
 * A stand-in document for the screens built with DOM calls: this suite runs
 * under vitest's `node` environment, with no DOM. It models only what those
 * tests lean on, and models it the way a browser does where a test could
 * otherwise pass for the wrong reason:
 *
 * - setting a select's `value`, or an option's `selected`, fires nothing; a
 *   `change` comes only from `choose`, the stand-in for a person picking;
 * - a focused node taken out of the page loses the focus to the body, so a
 *   repaint that rebuilt the control would show as lost focus.
 */
import { vi } from "vitest";

type Listener = (event: StandInEvent) => void;

export type StandInEvent = { type: string; target: StandInElement; code?: string; key?: string; defaultPrevented: boolean; preventDefault(): void };

export class StandInElement {
  readonly tagName: string;
  children: StandInElement[] = [];
  parent: StandInElement | null = null;
  className = "";
  id = "";
  type = "";
  name = "";
  htmlFor = "";
  hidden = false;
  disabled = false;
  inert = false;
  readonly style: Record<string, string> = {};
  private text = "";
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly doc: StandInDocument,
    tag: string,
  ) {
    this.tagName = tag.toUpperCase();
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
    const active = this.doc.activeElement;
    if (active !== null && !active.isConnected) this.doc.activeElement = this.doc.body;
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
  click(): void {
    if (!this.disabled) this.dispatch("click");
  }

  /** As a browser: nothing disabled, out of the page, or under an inert
   * ancestor takes the focus. */
  focus(): void {
    if (this.disabled || !this.isConnected) return;
    if (this.ancestry().some((node) => node.inert)) return;
    this.doc.activeElement = this;
  }

  /** Every element below this one, in document order. */
  descendants(): StandInElement[] {
    return this.children.filter((c) => c.tagName !== "#TEXT").flatMap((c) => [c, ...c.descendants()]);
  }
  /** Tag names only (`select`, `option`, …): nothing here needs more. */
  querySelector(selector: string): StandInElement | null {
    if (!/^[a-z0-9]+$/.test(selector)) throw new Error(`the stand-in document matches tag names only, not ${selector}`);
    return this.descendants().find((el) => el.tagName === selector.toUpperCase()) ?? null;
  }
  querySelectorAll(selector: string): StandInElement[] {
    if (!/^[a-z0-9]+$/.test(selector)) throw new Error(`the stand-in document matches tag names only, not ${selector}`);
    return this.descendants().filter((el) => el.tagName === selector.toUpperCase());
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

export class StandInOption extends StandInElement {
  value = "";
  private isSelected = false;
  get selected(): boolean {
    return this.isSelected;
  }
  set selected(on: boolean) {
    // A single select holds one selected option: selecting one clears the others.
    if (on && this.parent instanceof StandInSelect) for (const o of this.parent.options) o.isSelected = false;
    this.isSelected = on;
  }
}

export class StandInSelect extends StandInElement {
  get options(): StandInOption[] {
    return this.children.filter((c): c is StandInOption => c instanceof StandInOption);
  }
  get selectedIndex(): number {
    const i = this.options.findIndex((o) => o.selected);
    return i === -1 && this.options.length > 0 ? 0 : i;
  }
  get value(): string {
    return this.options[this.selectedIndex]?.value ?? "";
  }
  /** A script's write: selects the matching option and fires nothing, as a
   * browser does. */
  set value(v: string) {
    for (const o of this.options) o.selected = false;
    const match = this.options.find((o) => o.value === v);
    if (match !== undefined) match.selected = true;
  }
  /** A person picking `value`: the selection moves, then `input` and
   * `change` fire, in that order, as a browser fires them. */
  choose(value: string): void {
    if (this.disabled) return;
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
