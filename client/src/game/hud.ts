const STYLE = `
  .hud { position: absolute; inset: 0; pointer-events: none; font-family: system-ui, sans-serif; color: #fff; }
  .hud .status {
    position: absolute; left: 50%; top: 55%; transform: translateX(-50%);
    font-size: 1.1rem; text-shadow: 0 1px 4px #000; text-align: center;
  }
  .hud .respawn {
    position: absolute; left: 50%; top: 42%; transform: translateX(-50%);
    font-size: 1.6rem; font-weight: 600; text-shadow: 0 2px 6px #000;
    color: #ff6b5e; text-align: center;
  }
`;

export type Hud = {
  setStatus(text: string | null): void;
  /** Seconds until respawn, or null when alive. */
  setRespawn(seconds: number | null): void;
  dispose(): void;
};

/**
 * Built with DOM APIs rather than innerHTML: setStatus carries server-supplied
 * disconnect reasons, and textContent makes injection structurally impossible.
 */
export function createHud(container: HTMLElement): Hud {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "hud";

  const status = document.createElement("div");
  status.className = "status";

  const respawn = document.createElement("div");
  respawn.className = "respawn";
  respawn.hidden = true;

  root.append(status, respawn);
  container.append(style, root);

  return {
    setStatus(text) {
      status.textContent = text ?? "";
    },
    setRespawn(seconds) {
      const dead = seconds !== null && seconds > 0;
      respawn.hidden = !dead;
      respawn.textContent = dead ? `Respawning… ${Math.ceil(seconds)}` : "";
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
