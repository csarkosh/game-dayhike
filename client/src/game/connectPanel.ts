const STYLE = `
  .connectfail {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    background: rgba(16, 16, 20, 0.82);
    font-family: ui-monospace, monospace;
    /* Above the pause menu (pauseMenu.ts, 18), which opens underneath whenever
       the pointer is not engaged — and it never is in a game that failed to
       connect — and below the roster (roster.ts, 20), which still shows the
       party this player is deciding whether to stay in. */
    z-index: 19;
  }
  .connectfail.open { display: flex; }
  .connectfail .panel {
    display: flex; flex-direction: column; gap: 0.75rem;
    min-width: 14rem; max-width: 22rem; padding: 0 1rem;
  }
  .connectfail p { margin: 0 0 0.5rem; color: #fff; font-size: 1rem; line-height: 1.4; text-align: center; }
  .connectfail button {
    padding: 0.6rem 1rem; font: inherit; font-size: 1rem; cursor: pointer;
    color: #fff; background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px;
  }
  .connectfail button:hover { background: rgba(255, 255, 255, 0.18); }
  .connectfail button:active { background: rgba(255, 255, 255, 0.3); }
`;

/** What to tell a player whose connection to the host failed. */
export function connectFailureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message === "ice_failed"
    ? "Could not connect. You or the host may be on a restrictive network."
    : "Could not reach the host.";
}

export type ConnectPanel = {
  show(message: string): void;
  hide(): void;
  dispose(): void;
};

/**
 * The overlay shown when a follower's connection to the host fails. It offers
 * the two ways out that a stranded player actually has: try the handshake
 * again, or give up on the party and play alone in a fresh world.
 *
 * Built with DOM APIs and `textContent`, matching the HUD's rule that anything
 * dynamic cannot become markup.
 */
export function createConnectPanel(
  container: HTMLElement,
  options: { onRetry(): void; onOffline(): void },
): ConnectPanel {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "connectfail";

  const panel = document.createElement("div");
  panel.className = "panel";

  const message = document.createElement("p");

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => options.onRetry());

  const offline = document.createElement("button");
  offline.type = "button";
  offline.textContent = "Continue offline";
  offline.addEventListener("click", () => options.onOffline());

  panel.append(message, retry, offline);
  root.append(panel);
  container.append(style, root);

  return {
    show(text) {
      message.textContent = text;
      root.classList.add("open");
    },
    hide() {
      root.classList.remove("open");
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
