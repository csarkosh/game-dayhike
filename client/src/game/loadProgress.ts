/**
 * The loading bar's model: what the game has fetched and built so far, as
 * one bar value and one line. Pure: the overlay draws it, the hooks feed it.
 *
 * Stages are weighed by bytes where bytes are known (the downloads, the
 * only part that scales with the connection) and by count where they are
 * not. A stage with no total (shader compiles on WebGL2) counts up in its
 * line and adds nothing to the bar until the gate says the world is ready,
 * so the bar never shows a percentage it made up. The bar never moves
 * backward: a stage whose total grows keeps the value it had until the
 * new work catches up.
 */
export type Stage = "models" | "ground" | "shaders" | "pipelines" | "world";

export type ProgressView = { bar: number; line: string; ready: boolean };

export type LoadProgress = {
  /** The stage will have `n` items; may be told again as more are found. */
  total(stage: Stage, n: number): void;
  /** An item began; `bytes` is its size when the catalog knows it. */
  start(stage: Stage, id: string, bytes?: number): void;
  /** Bytes landed for an item, and its size where the response says it. */
  bytes(stage: Stage, id: string, loaded: number, total?: number): void;
  /** An item is done. */
  done(stage: Stage, id: string): void;
  /** The world is ready: every stage reads finished and the bar is full. */
  gate(): void;
  view(): ProgressView;
};

/** The bar's share of each stage. They sum to 1. */
const WEIGHT: Record<Stage, number> = { models: 0.6, ground: 0.1, shaders: 0.1, pipelines: 0.1, world: 0.1 };
const ORDER: Stage[] = ["models", "ground", "shaders", "pipelines", "world"];

type Item = { loaded: number; total: number | null; done: boolean };
type StageState = { total: number | null; items: Map<string, Item> };

export function createLoadProgress(): LoadProgress {
  const stages = new Map<Stage, StageState>(ORDER.map((s) => [s, { total: null, items: new Map() }]));
  let gated = false;
  let highest = 0;
  const of = (stage: Stage): StageState => stages.get(stage) as StageState;
  const doneCount = (s: StageState): number => {
    let n = 0;
    for (const it of s.items.values()) if (it.done) n++;
    return n;
  };

  /**
   * A stage's fraction done, or null where nothing bounds it. By bytes when
   * every item started has a size, scaled by how many of the stage's items
   * have started, so two models of four half landed read as a quarter and
   * not as a half; by count otherwise.
   */
  const fraction = (stage: Stage): number | null => {
    const s = of(stage);
    if (s.total === null) return null;
    if (s.total === 0) return 1;
    let known = 0, loaded = 0, sized = 0;
    for (const it of s.items.values()) {
      if (it.total !== null) {
        known += it.total;
        loaded += Math.min(it.loaded, it.total);
        sized++;
      }
    }
    if (sized > 0 && sized === s.items.size) {
      const started = Math.min(1, s.items.size / s.total);
      return (known === 0 ? 1 : loaded / known) * started;
    }
    return Math.min(1, doneCount(s) / s.total);
  };

  const line = (): string => {
    for (const stage of ORDER) {
      const s = of(stage);
      const done = doneCount(s);
      if (s.total !== null && done >= s.total) continue;
      if (s.total === null && s.items.size === 0) continue;
      switch (stage) {
        case "models": {
          let loaded = 0, known = 0;
          for (const it of s.items.values()) {
            if (it.total !== null) {
              known += it.total;
              loaded += Math.min(it.loaded, it.total);
            }
          }
          const mb = known > 0 ? `, ${(loaded / 1048576).toFixed(1)} of ${(known / 1048576).toFixed(1)} MB` : "";
          return `downloading models ${done} of ${s.total ?? "?"}${mb}`;
        }
        case "ground":
          return `ground and sound ${done} of ${s.total ?? "?"}`;
        case "shaders":
          return s.total === null ? `compiling shaders ${done}` : `shaders ${done} of ${s.total}`;
        case "pipelines":
          return `pipelines ${done} of ${s.total ?? s.items.size}`;
        case "world":
          return `building the world ${done} of ${s.total ?? "?"}`;
      }
    }
    return "";
  };

  const view = (): ProgressView => {
    if (gated) return { bar: 1, line: "ready", ready: true };
    let bar = 0;
    for (const stage of ORDER) {
      const f = fraction(stage);
      if (f !== null) bar += WEIGHT[stage] * f;
    }
    highest = Math.max(highest, bar);
    return { bar: highest, line: line(), ready: false };
  };

  return {
    total(stage, n) {
      of(stage).total = Math.max(n, of(stage).total ?? 0);
    },
    start(stage, id, bytes) {
      const s = of(stage);
      if (!s.items.has(id)) s.items.set(id, { loaded: 0, total: bytes ?? null, done: false });
    },
    bytes(stage, id, loaded, total) {
      const s = of(stage);
      const it = s.items.get(id) ?? { loaded: 0, total: null, done: false };
      it.loaded = Math.max(it.loaded, loaded);
      if (total !== undefined) it.total = total;
      s.items.set(id, it);
    },
    done(stage, id) {
      const s = of(stage);
      const it = s.items.get(id) ?? { loaded: 0, total: null, done: false };
      it.done = true;
      if (it.total !== null) it.loaded = it.total;
      s.items.set(id, it);
    },
    gate() {
      gated = true;
    },
    view,
  };
}
