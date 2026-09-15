import { INTERACT_REACH } from "../sim/interact.js";

export type Projected = { x: number; y: number; depth: number };
export type PromptView = { x: number; y: number; label: string; scale: number };

/** Kept from the viewport's edges, so a prompt at the corner is still legible. */
const EDGE_PX = 24;
/** Nearer than this the prompt is at full size. */
const NEAR_M = 1;
const FAR_SCALE = 0.7;

const LABELS: Record<number, string> = {
  0: "Interact",
};

/** The verb for an interactable's `kind`. Register kinds add rows here. */
export function promptLabel(kind: number): string {
  return LABELS[kind] ?? "Interact";
}

/**
 * Where and what the prompt shows, or null. Pure: the app resolves the target
 * and projects its position; this only decides the label, the size and the
 * clamp.
 */
export function promptModel(
  target: { kind: number } | null,
  projected: Projected | null,
  viewport: { width: number; height: number },
  touch: boolean,
): PromptView | null {
  if (target === null || projected === null) return null;
  const label = touch ? promptLabel(target.kind) : `Click to ${promptLabel(target.kind).toLowerCase()}`;
  const t = Math.min(1, Math.max(0, (projected.depth - NEAR_M) / (INTERACT_REACH - NEAR_M)));
  const scale = 1 - (1 - FAR_SCALE) * t;
  return {
    x: Math.min(viewport.width - EDGE_PX, Math.max(EDGE_PX, projected.x)),
    y: Math.min(viewport.height - EDGE_PX, Math.max(EDGE_PX, projected.y)),
    label,
    scale,
  };
}

const STYLE = `
  .prompt {
    position: absolute; left: 0; top: 0; z-index: 12;
    display: flex; align-items: center; gap: 0.5rem;
    font-family: system-ui, sans-serif; font-size: 0.95rem; color: #fff;
    text-shadow: 0 1px 4px #000; white-space: nowrap;
    pointer-events: none; opacity: 0;
    transition: opacity 150ms ease-out, transform 150ms ease-out;
    -webkit-user-select: none; user-select: none;
  }
  .prompt.on { opacity: 1; }
  .prompt.touch { pointer-events: auto; touch-action: none; }
  .prompt .dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.85); box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
    animation: prompt-drift 3s ease-in-out infinite;
  }
  @keyframes prompt-drift {
    0%, 100% { transform: translateY(-2px); }
    50% { transform: translateY(2px); }
  }
  @media (prefers-reduced-motion: reduce) { .prompt .dot { animation: none; } }
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
  root.classList.toggle("touch", hooks.touch);
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
      // The 4 px rise on entry comes from the transition between the last
      // hidden position and this one; steady state is exact.
      root.style.transform = `translate(${view.x}px, ${view.y - 6}px) scale(${view.scale})`;
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
