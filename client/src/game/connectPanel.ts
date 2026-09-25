import type { SessionEnd } from "../net/clientSession.js";

const STYLE = `
  .connectfail {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    background: rgba(16, 16, 20, 0.82);
    font-family: ui-monospace, monospace;
    /* Above the pause menu (pauseMenu.ts, 18), which opens underneath whenever
       the pointer is not engaged — and app.ts releases the pointer before
       showing this panel, since a player can resume into the game while it
       connects — and below the roster (roster.ts, 20), which still shows the
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

/**
 * What the panel's first button does. `reconnect` runs the handshake again,
 * which can succeed once a network hiccup has passed. `reload` reloads the
 * page: the site is a single-page app that never refetches its own code, so a
 * page running an older build than the host can only catch up by reloading.
 */
export type RetryMode = "reconnect" | "reload";

export type ConnectFailure = { message: string; retry: RetryMode };

/** Shown when the host turns this page away for running a different build. */
export const STALE_PAGE_MESSAGE =
  "You and the host are running different versions of Day Hike. " +
  "Reload this page to get the latest version, then join again. " +
  "If that does not work, the host needs to reload too.";

/** A handshake that failed or threw: worth another try from the same page. */
export function connectFailure(err: unknown): ConnectFailure {
  return { message: connectFailureMessage(err), retry: "reconnect" };
}

/**
 * Where a session end is explained: the panel, when the player has something
 * to do about it, or the status line on the way back to the landing page.
 */
export type SessionEndOutcome = { panel: ConnectFailure } | { status: string };

export function sessionEndOutcome(end: SessionEnd): SessionEndOutcome {
  switch (end.kind) {
    case "version_skew":
      return { panel: { message: STALE_PAGE_MESSAGE, retry: "reload" } };
    case "world_changed":
      // The host has moved to another game; the lobby's route update takes
      // this page there, or the landing page is the fallback.
      return { status: end.message };
    case "host_ended":
      return { status: end.message.length > 0 ? end.message : "The host ended this session." };
  }
}

/** Runs the recovery the panel is currently offering. */
export function runRetry(mode: RetryMode, hooks: { reconnect(): void; reload(): void }): void {
  if (mode === "reload") hooks.reload();
  else hooks.reconnect();
}

export type ConnectPanel = {
  show(failure: ConnectFailure): void;
  hide(): void;
  dispose(): void;
};

/**
 * The overlay shown when a follower's connection to the host fails, or when
 * the host turns this page away for running a different build. It offers the
 * two ways out that a stranded player actually has: try again (the handshake,
 * or a reload, whichever can help), or give up on the party and play alone in
 * a fresh world — which an older build can still do perfectly well.
 *
 * Built with DOM APIs and `textContent`, matching the HUD's rule that anything
 * dynamic cannot become markup.
 */
export function createConnectPanel(
  container: HTMLElement,
  options: { onReconnect(): void; onReload(): void; onOffline(): void },
): ConnectPanel {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "connectfail";

  const panel = document.createElement("div");
  panel.className = "panel";

  const message = document.createElement("p");
  let mode: RetryMode = "reconnect";

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () =>
    runRetry(mode, { reconnect: options.onReconnect, reload: options.onReload }),
  );

  const offline = document.createElement("button");
  offline.type = "button";
  offline.textContent = "Continue offline";
  offline.addEventListener("click", () => options.onOffline());

  panel.append(message, retry, offline);
  root.append(panel);
  container.append(style, root);

  return {
    show(failure) {
      mode = failure.retry;
      message.textContent = failure.message;
      // The button says what it will do: a reload drops this page's world.
      retry.textContent = failure.retry === "reload" ? "Reload" : "Retry";
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
