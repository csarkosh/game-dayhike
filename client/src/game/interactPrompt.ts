import { INTERACT_REACH } from "../sim/interact.js";
import { InteractKind } from "../sim/register.js";

export type Projected = { x: number; y: number; depth: number };
export type PromptView = { x: number; y: number; label: string; scale: number; hold: number };
export type PromptContext = {
  /** The carried hiker's name, or null with empty hands. */
  carrying: string | null;
  /** The sign-out hold, 0 to 1. */
  hold: number;
};

/** Kept from the viewport's edges, so a prompt at the corner is still legible. */
const EDGE_PX = 24;
/** Nearer than this the prompt is at full size. */
const NEAR_M = 1;
const FAR_SCALE = 0.7;

const LABELS: Record<number, string> = {
  0: "Interact",
};

/** The verb for an interactable's `kind`, when it carries no label of its own. */
export function promptLabel(kind: number): string {
  return LABELS[kind] ?? "Interact";
}

/**
 * Where and what the prompt shows, or null. Pure: the app resolves the target
 * and projects its position; this only decides the label, the size, the
 * clamp and the hold ring.
 */
export function promptModel(
  target: { kind: number; label?: string } | null,
  projected: Projected | null,
  viewport: { width: number; height: number },
  touch: boolean,
  ctx: PromptContext,
): PromptView | null {
  if (target === null || projected === null) return null;
  let label: string;
  let hold = 0;
  if (target.kind === InteractKind.Register) {
    if (ctx.carrying === null) label = target.label ?? "Read the register";
    else {
      label = `Sign out ${ctx.carrying} — hold`;
      hold = Math.min(1, Math.max(0, ctx.hold));
    }
  } else if (target.label !== undefined) {
    // A named thing reads the same on every device: "Click to pick up dana
    // whitcombe" would lowercase a name.
    label = target.label;
  } else {
    label = touch ? promptLabel(target.kind) : `Click to ${promptLabel(target.kind).toLowerCase()}`;
  }
  const t = Math.min(1, Math.max(0, (projected.depth - NEAR_M) / (INTERACT_REACH - NEAR_M)));
  const scale = 1 - (1 - FAR_SCALE) * t;
  return {
    x: Math.min(viewport.width - EDGE_PX, Math.max(EDGE_PX, projected.x)),
    y: Math.min(viewport.height - EDGE_PX, Math.max(EDGE_PX, projected.y)),
    label,
    scale,
    hold,
  };
}

const STYLE = `
  .prompt {
    position: absolute; left: 0; top: 0; z-index: 12;
    display: flex; align-items: center; gap: 0.5rem;
    font-family: system-ui, sans-serif; font-size: 0.95rem; color: #fff;
    text-shadow: 0 1px 4px #000; white-space: nowrap;
    pointer-events: none; opacity: 0;
    /* transform is rewritten every frame by sync() to track the projected
       point, so only opacity transitions here — a transform transition would
       make the prompt lag the target by its own duration. The entry rise is a
       one-shot keyframe below instead. transform-origin keeps the dot's
       centre pinned at (x, y) while scale changes its size around it, rather
       than around the row's default centre, which would carry the label along
       and drift the dot off the projected point. */
    transition: opacity 150ms ease-out;
    transform-origin: 6px 50%;
    -webkit-user-select: none; user-select: none;
  }
  .prompt.on { opacity: 1; animation: prompt-rise 150ms ease-out; }
  @keyframes prompt-rise {
    from { translate: 0 4px; }
    to { translate: 0 0; }
  }
  /*
   * A hidden prompt must never intercept a tap meant for what is underneath
   * it. "pressable", not "touch": the touch layer's own root element in
   * touchControls.ts already owns the ".touch" class in this same container,
   * and reusing it here would make the prompt match that full-viewport rule.
   */
  .prompt.pressable.on { pointer-events: auto; touch-action: none; }
  .prompt .dot {
    width: 12px; height: 12px; border-radius: 50%; position: relative;
    background: rgba(255, 255, 255, 0.85); box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
    animation: prompt-drift 3s ease-in-out infinite;
  }
  /* The sign-out hold: a ring that fills clockwise round the dot over five
     seconds and empties the instant the hold breaks — no transition, so an
     interrupted ritual is unmistakable. */
  .prompt .dot::after {
    content: ""; position: absolute; inset: -6px; border-radius: 50%;
    background: conic-gradient(rgba(255, 255, 255, 0.9) calc(var(--hold, 0) * 360deg), rgba(255, 255, 255, 0.15) 0);
    -webkit-mask: radial-gradient(circle, transparent 9px, #000 10px);
    mask: radial-gradient(circle, transparent 9px, #000 10px);
    opacity: 0;
  }
  .prompt.holding .dot::after { opacity: 1; }
  @keyframes prompt-drift {
    0%, 100% { transform: translateY(-2px); }
    50% { transform: translateY(2px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .prompt .dot { animation: none; }
    .prompt.on { animation: none; }
  }
`;

export type InteractPrompt = {
  sync(view: PromptView | null): void;
  dispose(): void;
};

/**
 * Floats the prompt at the projected point. `hooks` are the touch press: on a
 * phone the prompt is the interact control, so pressing it is the edge and
 * holding it is the bit.
 */
export function createInteractPrompt(
  container: HTMLElement,
  hooks: { onDown(): void; onUp(): void; touch: boolean },
): InteractPrompt {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "prompt";
  root.classList.toggle("pressable", hooks.touch);
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.className = "label";
  root.append(dot, label);
  container.append(style, root);

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    root.setPointerCapture(e.pointerId);
    hooks.onDown();
  };
  const onUp = () => hooks.onUp();
  if (hooks.touch) {
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
  }

  let shown = false;
  return {
    sync(view) {
      if (view === null) {
        if (shown) {
          shown = false;
          root.classList.remove("on");
          // A hidden prompt cannot be held; release so the bit does not stick.
          if (hooks.touch) hooks.onUp();
        }
        return;
      }
      if (!shown) {
        shown = true;
        root.classList.add("on");
      }
      label.textContent = view.label;
      root.classList.toggle("holding", view.hold > 0);
      root.style.setProperty("--hold", String(view.hold));
      // The 4 px rise on entry is the `prompt-rise` keyframe on `.on` (an
      // independent `translate`, so it composes with this `transform` rather
      // than fighting it); this is always the exact, steady-state point.
      root.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
