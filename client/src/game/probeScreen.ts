/**
 * The screen over the startup probe: the landing's dark ground and one line,
 * opaque, so the probe's canvas renders beneath it unseen. Built with DOM calls
 * and `textContent` only.
 */

/** The one line the screen shows. */
export const PROBE_SCREEN_LINE = "Setting up graphics…";

const STYLE = `
  .probe-screen {
    position: absolute; inset: 0;
    /* Above the probe's canvas, which is a plain block in the container. */
    z-index: 1;
    display: flex; align-items: center; justify-content: center;
    background: #101014; color: #fff;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.06em;
  }
`;

/** Covers `container` with the screen until `dispose`. */
export function showProbeScreen(container: HTMLElement): { dispose(): void } {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "probe-screen";
  root.setAttribute("role", "status");
  root.textContent = PROBE_SCREEN_LINE;
  container.append(style, root);
  return {
    dispose() {
      style.remove();
      root.remove();
    },
  };
}
