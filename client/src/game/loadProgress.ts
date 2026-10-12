/**
 * The loading bar's model: what the game has fetched and built so far, as
 * one bar value and a line per thing under way. Pure: the overlay draws it,
 * the hooks feed it.
 *
 * Stages are weighed by bytes where bytes are known (the downloads, the
 * only part that scales with the connection) and by count where they are
 * not. A stage with no total (shader compiles on WebGL2) counts up in its
 * line and adds nothing to the bar until the gate says the world is ready,
 * so the bar never shows a percentage it made up. The bar never moves
 * backward: a stage whose total grows keeps the value it had until the
 * new work catches up.
 *
 * `lines` has one line for each stage begun and not yet finished, in the
 * stages' order, so work running at once stacks and each line goes as its
 * work ends. The models stage can show two: the download, and, once a
 * model's bytes are all in but its parse (the glTF, the texture transcode)
 * has not settled, the decode, which is the gap between the two counts.
 */
export type Stage = "models" | "ground" | "shaders" | "pipelines" | "world";

export type ProgressView = { bar: number; lines: string[]; ready: boolean };

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

/**
 * A progress model that names each stage as its first item starts — the
 * telemetry's breadcrumb — and forwards everything to `inner` where there is
 * one (the intro's bar). With no inner, the loads still report here, and the
 * view is empty.
 */
export function markedProgress(inner: LoadProgress | null, mark: (stage: Stage) => void): LoadProgress {
  const marked = new Set<Stage>();
  return {
    total: (stage, n) => inner?.total(stage, n),
    start(stage, id, bytes) {
      if (!marked.has(stage)) {
        marked.add(stage);
        mark(stage);
      }
      inner?.start(stage, id, bytes);
    },
    bytes: (stage, id, loaded, total) => inner?.bytes(stage, id, loaded, total),
    done: (stage, id) => inner?.done(stage, id),
    gate: () => inner?.gate(),
    view: () => inner?.view() ?? { bar: 0, lines: [], ready: false },
  };
}

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

  /** Models with every byte in (or done): the download's count. */
  const landed = (s: StageState): number => {
    let n = 0;
    for (const it of s.items.values()) if (it.done || (it.total !== null && it.loaded >= it.total)) n++;
    return n;
  };

  const lines = (): string[] => {
    const out: string[] = [];
    for (const stage of ORDER) {
      const s = of(stage);
      const done = doneCount(s);
      if (s.total !== null && done >= s.total) continue;
      if (s.total === null && s.items.size === 0) continue;
      switch (stage) {
        case "models": {
          const down = landed(s);
          if (s.total === null || down < s.total) {
            let loaded = 0, known = 0;
            for (const it of s.items.values()) {
              if (it.total !== null) {
                known += it.total;
                loaded += Math.min(it.loaded, it.total);
              }
            }
            const mb = known > 0 ? `, ${(loaded / 1048576).toFixed(1)} of ${(known / 1048576).toFixed(1)} MB` : "";
            out.push(`downloading models ${down} of ${s.total ?? "?"}${mb}`);
          }
          if (done < down) out.push(`decoding models ${done} of ${down}`);
          break;
        }
        case "ground":
          out.push(`ground and sound ${done} of ${s.total ?? "?"}`);
          break;
        case "shaders":
          out.push(s.total === null ? `compiling shaders ${done}` : `shaders ${done} of ${s.total}`);
          break;
        case "pipelines":
          out.push(`pipelines ${done} of ${s.total ?? s.items.size}`);
          break;
        case "world":
          out.push(`building the world ${done} of ${s.total ?? "?"}`);
          break;
      }
    }
    return out;
  };

  const view = (): ProgressView => {
    if (gated) return { bar: 1, lines: ["ready"], ready: true };
    let bar = 0;
    for (const stage of ORDER) {
      const f = fraction(stage);
      if (f !== null) bar += WEIGHT[stage] * f;
    }
    highest = Math.max(highest, bar);
    return { bar: highest, lines: lines(), ready: false };
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
