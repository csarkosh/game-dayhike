const STYLE = `
  .netgraph {
    position: absolute; right: 12px; top: 12px; z-index: 10;
    background: rgba(0,0,0,0.72); color: #b8f5c0; padding: 8px 10px;
    border-radius: 6px; font: 12px ui-monospace, monospace; pointer-events: none;
    min-width: 150px;
  }
  .netgraph table { border-collapse: collapse; width: 100%; }
  .netgraph td { padding: 1px 0; }
  .netgraph td:last-child { text-align: right; font-weight: 600; }
  .netgraph .bar { margin-top: 6px; height: 4px; background: #223; border-radius: 2px; }
  .netgraph .bar span { display: block; height: 100%; width: 0; background: #6cf; border-radius: 2px; }
`;

const ROWS: { key: string; label: string }[] = [
  { key: "fps", label: "fps" },
  { key: "tick", label: "tick" },
  { key: "rtt", label: "rtt" },
  { key: "snaps", label: "snap/s" },
  { key: "bytes", label: "down" },
  { key: "entities", label: "entities" },
  { key: "unacked", label: "unacked" },
  { key: "err", label: "pred err" },
];

/** Anything past this much correction per snapshot is visible to the player. */
const VISIBLE_ERROR_M = 0.2;

export type DebugSample = {
  rttMs: number;
  predictionError: number;
  snapshotsPerSecond: number;
  bytesPerSecond: number;
  entities: number;
  tick: number;
  unackedInputs: number;
  fps: number;
};

/** Sliding-window rate counter. Drops samples that fall out of the window. */
export class RateCounter {
  private readonly samples: { at: number; value: number }[] = [];

  constructor(private readonly windowMs: number) {}

  add(value: number, nowMs: number): void {
    this.samples.push({ at: nowMs, value });
    this.trim(nowMs);
  }

  perSecond(nowMs: number): number {
    this.trim(nowMs);
    let total = 0;
    for (const sample of this.samples) total += sample.value;
    return (total * 1000) / this.windowMs;
  }

  private trim(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.samples.length > 0 && (this.samples[0] as { at: number }).at < cutoff) {
      this.samples.shift();
    }
  }
}

export type Netgraph = {
  update(sample: DebugSample): void;
  toggle(): void;
  readonly visible: boolean;
  dispose(): void;
};

export function createNetgraph(container: HTMLElement): Netgraph {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "netgraph";
  root.hidden = true;

  const table = document.createElement("table");
  const cells = new Map<string, HTMLTableCellElement>();
  for (const { key, label } of ROWS) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = label;
    const value = document.createElement("td");
    value.textContent = "-";
    row.append(name, value);
    table.append(row);
    cells.set(key, value);
  }

  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("span");
  bar.append(fill);

  root.append(table, bar);
  container.append(style, root);

  const set = (key: string, text: string) => {
    const cell = cells.get(key);
    if (cell !== undefined) cell.textContent = text;
  };

  return {
    get visible() {
      return !root.hidden;
    },
    toggle() {
      root.hidden = !root.hidden;
    },
    update(sample) {
      if (root.hidden) return;
      set("fps", sample.fps.toFixed(0));
      set("tick", String(sample.tick));
      set("rtt", `${sample.rttMs.toFixed(0)}ms`);
      set("snaps", sample.snapshotsPerSecond.toFixed(1));
      set("bytes", `${(sample.bytesPerSecond / 1024).toFixed(1)}KB/s`);
      set("entities", String(sample.entities));
      set("unacked", String(sample.unackedInputs));
      set("err", `${(sample.predictionError * 100).toFixed(1)}cm`);
      const ratio = Math.min(1, sample.predictionError / VISIBLE_ERROR_M);
      fill.style.width = `${ratio * 100}%`;
      fill.style.background = ratio > 0.5 ? "#f66" : "#6cf";
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
