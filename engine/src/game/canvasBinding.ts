/**
 * A set of event listeners that live on the game's canvas and follow it to a
 * new one. A live tier change (`rendererSwap.ts`) builds the renderer on a
 * fresh canvas; whatever listened on the old one (the input sampler's lock
 * requests, the touch layer's stick and look) moves across rather than being
 * rebuilt, so the state it holds (the player's aim, a finger's role) carries on.
 */

export type CanvasBinding = {
  /** The canvas the listeners are on now. */
  readonly canvas: HTMLCanvasElement;
  /** Moves every listener off the current canvas and onto `next`. */
  rebind(next: HTMLCanvasElement): void;
  dispose(): void;
};

export function bindCanvas(canvas: HTMLCanvasElement, listeners: Readonly<Record<string, EventListener>>): CanvasBinding {
  let current = canvas;
  const attach = (target: HTMLCanvasElement): void => {
    for (const [type, listener] of Object.entries(listeners)) target.addEventListener(type, listener);
  };
  const detach = (target: HTMLCanvasElement): void => {
    for (const [type, listener] of Object.entries(listeners)) target.removeEventListener(type, listener);
  };
  attach(current);
  return {
    get canvas() {
      return current;
    },
    rebind(next) {
      if (next === current) return;
      detach(current);
      current = next;
      attach(current);
    },
    dispose() {
      detach(current);
    },
  };
}
