/** The scene route's caption: one line under the picture, the text and
 * whether it is heard through the radio, written with `textContent` only. */
import type { Caption } from "./timeline.js";

export type CaptionPanel = { set(caption: Caption | null): void; dispose(): void };

const STYLE = `
  .scene-caption { position: absolute; left: 0; right: 0; bottom: 8vh; margin: 0 auto; max-width: 44ch; text-align: center; white-space: pre-line; color: #eee; font: 500 clamp(16px, 2.4vh, 26px)/1.35 system-ui, sans-serif; pointer-events: none; z-index: 30; }
  .scene-caption.radio { font-style: italic; }
  .scene-caption.radio::before { content: "Dispatch (radio): "; font-style: normal; opacity: 0.7; }
`;

export function createCaptionPanel(container: HTMLElement): CaptionPanel {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const node = document.createElement("div");
  node.className = "scene-caption";
  container.append(style, node);
  return {
    set(caption) {
      node.textContent = caption?.text ?? "";
      node.classList.toggle("radio", caption?.radio ?? false);
    },
    dispose() {
      node.remove();
      style.remove();
    },
  };
}
