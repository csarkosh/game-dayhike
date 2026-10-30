/**
 * Material 3 motion for the admin page (Cyrus, 2026-10-29): the folded tables' accordion, fades,
 * a card easing to a new height, the glide of a re-rendered list and the menu's grow and shrink.
 * The host's own dashboards move through the host's module (csarko.sh `admin/public/motion.js`);
 * this is that module in TypeScript, the same names and the same behaviour, so the four admin
 * pages move as one. Plain Web Animations, no dependency.
 *
 * Every easing and duration is a motion token read off :root (the host's `/theme.css`), never
 * typed here. Under prefers-reduced-motion: reduce the durations read 0ms, and a duration of 0
 * means the end state at once: nothing is animated and nothing waits. Something interrupted part
 * way continues from where and how it is drawn (its computed height, transform and opacity),
 * never from its layout place.
 *
 * Nothing here touches the DOM until a function is called: the tests import it under plain Node.
 */

const EASINGS = { standard: "easing-standard", decelerate: "easing-emphasized-decelerate", accelerate: "easing-emphasized-accelerate" } as const;
const DURATIONS = ["short2", "short3", "short4", "medium2", "medium4"] as const;
type Duration = (typeof DURATIONS)[number];

/** The motion tokens: three easings, and five durations in ms. */
export type Tokens = Record<keyof typeof EASINGS, string> & Record<Duration, number>;

/** "150ms" → 150, "0.3s" → 300; `fallback` for anything that is not a CSS time. */
export function parseDuration(value: string | null | undefined, fallback = 0): number {
  const m = /^\s*(\d*\.?\d+)(ms|s)\s*$/i.exec(String(value ?? ""));
  if (m === null) return fallback;
  const n = Number(m[1]);
  return m[2]!.toLowerCase() === "s" ? Math.round(n * 1e6) / 1e3 : n;
}

/** A custom property as it is on :root now, trimmed. */
export function rootToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The motion tokens as they are on :root now. */
export function tokens(): Tokens {
  const read = (name: string): string => rootToken(`--md-${name}`);
  const ms = Object.fromEntries(DURATIONS.map((key) => [key, parseDuration(read(`duration-${key}`))])) as Record<Duration, number>;
  return { standard: read(EASINGS.standard), decelerate: read(EASINGS.decelerate), accelerate: read(EASINGS.accelerate), ...ms };
}

type Timing = { duration: number; easing: string; delay?: number; fill?: FillMode };

/**
 * One animation, or null when there is nothing to animate: a 0 duration, no easing token, or no
 * Web Animations.
 */
export function play(node: Element, frames: Keyframe[], { duration, easing, delay = 0, fill = "none" }: Timing): Animation | null {
  if (!(duration > 0) || !easing || typeof node.animate !== "function") return null;
  return node.animate(frames, { duration, easing, delay, fill });
}

/**
 * Still drawing: running or paused, or finished and holding its last frame (a fill of forwards
 * or both, as fadeOut and hideMenu use). A finished animation with no fill draws nothing, so it
 * is over, as is a cancelled one.
 */
export function live(animation: Animation | null | undefined): animation is Animation {
  if (!animation) return false;
  const state = animation.playState;
  if (state === "running" || state === "paused") return true;
  return state === "finished" && /^(forwards|both)$/.test(animation.effect?.getTiming().fill ?? "");
}

/** An element's look as it is drawn now, its animations included; with none, its own. */
export function look(node: Element): { opacity: number; transform: string } {
  const css = getComputedStyle(node);
  return { opacity: Number(css.opacity), transform: css.transform };
}

// A height keyframe. Border-box so the figure is the element's whole height (offsetHeight)
// whatever its own box-sizing; clipped so what does not fit yet stays hidden.
const tall = (px: number): Keyframe => ({ height: `${px}px`, boxSizing: "border-box", overflow: "clip" });

/** Resolves once every animation has finished or been cancelled. */
export const settled = (animations: Animation[]): Promise<void> => Promise.allSettled(animations.map((a) => a.finished)).then(() => {});

// ---------------------------------------------------------------- eased height

const heights = new WeakMap<HTMLElement, Animation>();

/**
 * Eases `el` from `from` px to `to` px tall (border box, as offsetHeight measures), medium2 on
 * the standard curve; its own height takes over when it ends. Null when `from === to` or the
 * duration is 0. Called again while an ease is in flight on `el`, it starts from the height drawn
 * now and goes to `el`'s own height measured without the old ease (which `to`, read while that
 * ease was applied, cannot be).
 */
export function easeHeight(el: HTMLElement, from: number, to: number): Animation | null {
  const t = tokens();
  const prev = heights.get(el);
  heights.delete(el);
  if (live(prev)) {
    from = el.offsetHeight;
    prev.cancel();
    to = el.offsetHeight;
  }
  if (from === to) return null;
  const animation = play(el, [tall(from), tall(to)], { duration: t.medium2, easing: t.standard });
  if (animation) heights.set(el, animation);
  return animation;
}

// ---------------------------------------------------------------- fades

const fades = new WeakMap<Element, Animation>();

// In: from 0 (or as drawn, a fade in flight) to its own opacity. Out: from as drawn to 0.
function fade(el: Element, arriving: boolean, duration: number, easing: string, fill: FillMode): Animation | null {
  const prev = fades.get(el);
  fades.delete(el);
  const from = live(prev) || !arriving ? look(el).opacity : 0;
  prev?.cancel();
  const to = arriving ? look(el).opacity : 0;
  const animation = play(el, [{ opacity: from }, { opacity: to }], { duration, easing, fill });
  if (animation) fades.set(el, animation);
  return animation;
}

/**
 * Fades `el` in to its own opacity on the standard curve, over `duration` ms (a token's value;
 * medium2, content arriving, by default). From the opacity it is drawn at if a fade is in flight.
 * Null when the duration is 0.
 */
export function fadeIn(el: Element, duration?: number): Animation | null {
  const t = tokens();
  return fade(el, true, duration ?? t.medium2, t.standard, "none");
}

/**
 * Fades `el` out on the accelerate curve, over `duration` ms (short3 by default), from the
 * opacity it is drawn at, and holds it invisible until the caller removes or hides it, or a
 * fadeIn brings it back. Null when the duration is 0: the caller hides it at once.
 */
export function fadeOut(el: Element, duration?: number): Animation | null {
  const t = tokens();
  return fade(el, false, duration ?? t.short3, t.accelerate, "forwards");
}

// ---------------------------------------------------------------- the accordion

const wired = new WeakSet<HTMLDetailsElement>();

/**
 * A folded section that opens as an accordion. The <details> stays the element (keyboard, screen
 * readers and find-in-page keep working); its summary's click is taken over. Opening: the height
 * grows from closed to full over medium2 on the standard curve while the parts under the summary
 * fade in over short3, starting halfway into that fade's length. Closing: the parts fade out over
 * short2 while the height shrinks to closed over short4, both accelerating, and then `open` is
 * cleared; `data-closing` is on the element meanwhile, for the disclosure arrow to turn with it. A
 * click while it moves does not interrupt it: it is taken once the motion settles, so the fold
 * ends as the last click asked (a second click undoes a waiting one). A toggle it did not cause
 * (find-in-page, a script, another <details name> opening) just opens or closes, ending any motion
 * in flight and dropping a waiting click. Wiring it twice is harmless.
 */
export function accordion(details: HTMLDetailsElement): void {
  if (wired.has(details)) return;
  const summary = [...details.children].find((node) => node.localName === "summary");
  if (summary === undefined) return;
  wired.add(details);
  let run: Animation[] = [];
  // A click taken while the fold moved, for once it settles.
  let waiting = false;
  // The `open` a toggle of ours will report; any other toggle came from elsewhere.
  let expect: boolean | null = null;
  const parts = (): HTMLElement[] => [...details.children].filter((node): node is HTMLElement => node !== summary && node instanceof HTMLElement);
  const set = (open: boolean): void => {
    expect = open;
    details.open = open;
  };
  const stop = (): void => {
    run.forEach((a) => a.cancel());
    run = [];
    waiting = false;
    details.removeAttribute("data-closing");
  };
  const track = (animations: (Animation | null)[], done: () => void): void => {
    const mine = animations.filter((a): a is Animation => a !== null);
    if (mine.length === 0) return done();
    run = mine;
    void settled(mine).then(() => {
      if (run !== mine) return;
      run = [];
      done();
      mine.forEach((a) => a.cancel());
      if (waiting) {
        waiting = false;
        toggle();
      }
    });
  };
  // Its height closed, without closing it (which would fire a toggle): the parts are taken out of
  // the layout for the measurement, within one task, so nothing is drawn that way.
  const closedHeight = (): number => {
    const was = parts().map((node) => [node, node.style.getPropertyValue("display"), node.style.getPropertyPriority("display")] as const);
    was.forEach(([node]) => node.style.setProperty("display", "none", "important"));
    const height = details.offsetHeight;
    was.forEach(([node, value, priority]) => node.style.setProperty("display", value, priority));
    return height;
  };

  details.addEventListener("toggle", () => {
    const ours = expect !== null && details.open === expect;
    expect = null;
    if (!ours) stop();
  });

  summary.addEventListener("click", (event) => {
    // A link or button inside the summary keeps its own click.
    const target = event.target instanceof Element ? event.target : null;
    const inner = target?.closest("a, button, input, select, textarea, label");
    if (inner && inner !== summary && summary.contains(inner)) return;
    event.preventDefault();
    if (run.length > 0) waiting = !waiting;
    else toggle();
  });

  function toggle(): void {
    const t = tokens();
    if (!details.open) {
      if (!t.medium2) return set(true);
      const from = details.offsetHeight;
      set(true);
      const to = details.offsetHeight;
      track(
        [
          play(details, [tall(from), tall(to)], { duration: t.medium2, easing: t.standard }),
          ...parts().map((node) => play(node, [{ opacity: 0 }, { opacity: look(node).opacity }], { duration: t.short3, delay: t.short3 / 2, easing: t.standard, fill: "backwards" })),
        ],
        () => {},
      );
    } else {
      if (!t.short4) return set(false);
      const from = details.offsetHeight;
      const to = closedHeight();
      details.setAttribute("data-closing", "");
      track(
        [
          play(details, [tall(from), tall(to)], { duration: t.short4, easing: t.accelerate, fill: "forwards" }),
          ...parts().map((node) => play(node, [{ opacity: look(node).opacity }, { opacity: 0 }], { duration: t.short2, easing: t.accelerate, fill: "forwards" })),
        ],
        () => {
          details.removeAttribute("data-closing");
          set(false);
        },
      );
    }
  }
}

// ---------------------------------------------------------------- the glide

type Glide = { run: Animation[]; ghosts: HTMLElement[]; position: string | undefined };
const glides = new WeakMap<HTMLElement, Glide>();

function stopGlide(host: HTMLElement): void {
  const state = glides.get(host);
  if (state === undefined) return;
  glides.delete(host);
  state.run.forEach((a) => a.cancel());
  state.ghosts.forEach((g) => g.remove());
  if (state.position !== undefined) host.style.position = state.position;
}

type Place = { x: number; y: number; width: number; height: number };

/**
 * The glide of a list across a re-render (a chip that filters it): `change()` replaces `host`'s
 * children, and old and new children are matched by `keyOf` (unique within the list). Children
 * that stay glide from their old place to their new one (medium4, standard); new ones arrive,
 * fading in and rising 8 px with a slight scale (medium2, emphasized decelerate, short2 in); old
 * ones that are gone fade out where they were, as ghosts (short3, emphasized accelerate); and the
 * host's height eases to its new height over medium4. A change during a glide starts from what is
 * drawn. Resolves when it has settled; at once, after `change()`, under reduced motion.
 */
export function glideList(host: HTMLElement, change: () => void, keyOf: (node: HTMLElement) => string | null): Promise<void> {
  const t = tokens();
  if (!t.medium4 || typeof host.animate !== "function") {
    stopGlide(host);
    change();
    return Promise.resolve();
  }
  const children = (): HTMLElement[] => [...host.children].filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hasAttribute("data-ghost"));
  const shown = (node: HTMLElement): boolean => node.getClientRects().length > 0;

  // What is on screen: the host's height and each child as drawn, a glide in flight included.
  const fromHeight = host.offsetHeight;
  const before = new Map<string, { node: HTMLElement; opacity: number; transform: string; at?: Place }>();
  for (const node of children()) {
    const key = keyOf(node);
    if (key !== null && shown(node)) before.set(key, { node, ...look(node) });
  }
  stopGlide(host);
  // Then where each one is laid out, with that glide gone.
  const placeOf = (origin: DOMRect) => (node: HTMLElement): Place => {
    const r = node.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
  };
  const placeBefore = placeOf(host.getBoundingClientRect());
  for (const was of before.values()) was.at = placeBefore(was.node);

  change();

  const toHeight = host.offsetHeight;
  const placeAfter = placeOf(host.getBoundingClientRect());
  const state: Glide = { run: [], ghosts: [], position: undefined };
  const add = (animation: Animation | null): Animation | null => {
    if (animation) state.run.push(animation);
    return animation;
  };
  const kept = new Set<string>();

  for (const node of children()) {
    if (!shown(node)) continue;
    const key = keyOf(node);
    const was = key !== null ? before.get(key) : undefined;
    const own = look(node);
    if (key !== null && was?.at !== undefined) {
      kept.add(key);
      const at = placeAfter(node);
      const dx = was.at.x - at.x;
      const dy = was.at.y - at.y;
      const drawn = was.transform === "none" ? "" : ` ${was.transform}`;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !drawn && was.opacity === own.opacity) continue;
      add(play(node, [{ transform: `translate(${dx}px, ${dy}px)${drawn}`, opacity: was.opacity }, own], { duration: t.medium4, easing: t.standard }));
    } else {
      add(play(node, [{ opacity: 0, transform: "translateY(8px) scale(0.98)" }, own], { duration: t.medium2, delay: t.short2, easing: t.decelerate, fill: "backwards" }));
    }
  }

  for (const [key, was] of before) {
    if (kept.has(key) || !t.short3 || was.at === undefined) continue;
    if (state.position === undefined && getComputedStyle(host).position === "static") {
      state.position = host.style.position;
      host.style.position = "relative";
    }
    const ghost = was.node.cloneNode(true) as HTMLElement;
    for (const node of [ghost, ...ghost.querySelectorAll("[id]")]) node.removeAttribute("id");
    ghost.setAttribute("data-ghost", "");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    Object.assign(ghost.style, {
      position: "absolute", margin: "0", boxSizing: "border-box", pointerEvents: "none",
      left: `${was.at.x - host.clientLeft + host.scrollLeft}px`, top: `${was.at.y - host.clientTop + host.scrollTop}px`,
      width: `${was.at.width}px`, height: `${was.at.height}px`, transform: was.transform, opacity: String(was.opacity),
    });
    host.append(ghost);
    state.ghosts.push(ghost);
    const out = add(play(ghost, [{ opacity: was.opacity }, { opacity: 0 }], { duration: t.short3, easing: t.accelerate, fill: "forwards" }));
    out?.finished.then(() => ghost.remove(), () => {});
  }

  if (fromHeight !== toHeight) add(play(host, [tall(fromHeight), tall(toHeight)], { duration: t.medium4, easing: t.standard }));

  glides.set(host, state);
  return settled(state.run).then(() => {
    if (glides.get(host) !== state) return;
    glides.delete(host);
    state.ghosts.forEach((g) => g.remove());
    if (state.position !== undefined) host.style.position = state.position;
  });
}

// ---------------------------------------------------------------- the menu

// Each menu's show or hide in flight.
const menus = new WeakMap<HTMLElement, { showing: boolean; animation: Animation }>();
// It grows from the account button's corner (the menu hangs from the nav's right edge).
const CORNER = "top right";
const SMALL = { opacity: 0, transform: "scale(0.92)" };

/** Shows `menu`: it grows from 0.92 and fades in from its top-right corner, medium2, emphasized decelerate. */
export function showMenu(menu: HTMLElement): void {
  const prev = menus.get(menu);
  if (prev?.showing && live(prev.animation)) return;
  if (!menu.hidden && !live(prev?.animation)) return;
  const t = tokens();
  const from = live(prev?.animation) ? look(menu) : SMALL;
  prev?.animation.cancel();
  menus.delete(menu);
  menu.hidden = false;
  menu.inert = false;
  const animation = play(menu, [{ ...from, transformOrigin: CORNER }, { ...look(menu), transformOrigin: CORNER }], { duration: t.medium2, easing: t.decelerate });
  if (animation) menus.set(menu, { showing: true, animation });
}

/**
 * Hides `menu`: it shrinks to 0.92 and fades out, short3, emphasized accelerate, and is `hidden`
 * when done. Meanwhile it is inert, so what is fading cannot be clicked or focused.
 */
export function hideMenu(menu: HTMLElement): void {
  const prev = menus.get(menu);
  if (menu.hidden || (prev && !prev.showing && live(prev.animation))) return;
  const t = tokens();
  const from = look(menu);
  prev?.animation.cancel();
  menus.delete(menu);
  const animation = play(menu, [{ ...from, transformOrigin: CORNER }, { ...SMALL, transformOrigin: CORNER }], { duration: t.short3, easing: t.accelerate, fill: "forwards" });
  if (!animation) {
    menu.hidden = true;
    return;
  }
  menus.set(menu, { showing: false, animation });
  menu.inert = true;
  animation.finished.then(
    () => {
      if (menus.get(menu)?.animation !== animation) return;
      menus.delete(menu);
      menu.hidden = true;
      menu.inert = false;
      animation.cancel();
    },
    () => {},
  );
}
