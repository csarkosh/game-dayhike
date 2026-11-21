import { afterEach, describe, expect, it } from "vitest";
import "../../src/game/dayhikeAssets.js";
import { modelBytes, modelUrl } from "@csarkosh/engine/game/assetUrls";
import { createLoadProgress, markedProgress, type LoadProgress, type Stage } from "@csarkosh/engine/game/loadProgress";
import {
  GROUND_STAGE_TOTAL, expectModels, modelLoadTold, reportGroundImage, reportLayer, reportModel, reportProgress, setLoadProgress,
} from "@csarkosh/engine/game/loadReport";
import * as groundMaps from "@csarkosh/engine/game/groundLayers";

/** A progress model that says what it was told. */
function told(): LoadProgress & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    total: (stage: Stage, n: number) => void log.push(`total ${stage} ${n}`),
    start: (stage: Stage, id: string, bytes?: number) => void log.push(`start ${stage} ${id}${bytes === undefined ? "" : ` ${bytes}`}`),
    bytes: (stage: Stage, id: string, loaded: number, total?: number) => void log.push(`bytes ${stage} ${id} ${loaded} ${total}`),
    done: (stage: Stage, id: string) => void log.push(`done ${stage} ${id}`),
    gate: () => undefined,
    view: () => ({ bar: 0, lines: [], ready: false }),
  };
}

const live = (): AbortSignal => new AbortController().signal;
const FIR = modelUrl("models/tree.giant_fir.glb");
const PINE = modelUrl("models/tree.giant_pine.glb");
const RAVEN = modelUrl("models/wildlife.raven.glb");

describe("where the loads report to", () => {
  afterEach(() => setLoadProgress(null));

  it("is nothing until a bar is up, and every hook is quiet then", async () => {
    expect(reportProgress()).toBeNull();
    reportLayer("start", "normal.grass");
    reportLayer("done", "normal.grass");
    expectModels([FIR]);
    const model = reportModel(FIR, live());
    model.fetched(10);
    model.landed();
    reportGroundImage("grass.webp", live()).landed();
    expect(await modelLoadTold(PINE, live(), async (fetched) => (fetched(3), "made"))).toBe("made");
    expect(reportProgress()).toBeNull();
  });

  it("tells the bar nothing of the models as it is set: their total is the count of the models asked for", () => {
    const p = told();
    setLoadProgress(p);
    expect(reportProgress()).toBe(p);
    expect(p.log).toEqual([]);
    reportModel(FIR, live());
    reportModel(PINE, live());
    // The same file asked for again (a renderer made again under the same bar) is the same model.
    reportModel(FIR, live());
    expect(p.log.filter((line) => line.startsWith("total"))).toEqual(["total models 1", "total models 2", "total models 2"]);
  });

  it("tells a model by its url with the catalog's bytes: its start, its bytes when they are in, its landing", async () => {
    const p = told();
    setLoadProgress(p);
    const bytes = modelBytes(FIR) as number;
    expect(bytes).toBeGreaterThan(100_000);
    const made = await modelLoadTold(FIR, live(), async (fetched) => {
      expect(p.log).toEqual(["total models 1", `start models ${FIR} ${bytes}`]);
      fetched(bytes);
      return "made";
    });
    expect(made).toBe("made");
    expect(p.log).toEqual(["total models 1", `start models ${FIR} ${bytes}`, `bytes models ${FIR} ${bytes} ${bytes}`, `done models ${FIR}`]);
  });

  it("holds the models a loader names ahead in the total before it asks for the first", () => {
    const p = told();
    setLoadProgress(p);
    reportModel(FIR, live());
    expectModels([RAVEN, PINE]);
    expect(p.log.at(-1)).toBe("total models 3");
    // Asked for in its turn, a model named ahead adds nothing to the total.
    reportModel(RAVEN, live());
    expect(p.log.slice(-2)).toEqual(["total models 3", `start models ${RAVEN} ${modelBytes(RAVEN)}`]);
  });

  it("lands a model that could not be fetched or read, so the bar does not wait for it", async () => {
    const p = told();
    setLoadProgress(p);
    await expect(modelLoadTold(FIR, live(), () => Promise.reject(new Error(`${FIR}: HTTP 503`)))).rejects.toThrow("HTTP 503");
    expect(p.log.at(-1)).toBe(`done models ${FIR}`);
  });

  it("does not land a load its owner ended: the file asked for again under the same bar lands it", async () => {
    const p = told();
    setLoadProgress(p);
    const loads = new AbortController();
    const ended = modelLoadTold(FIR, loads.signal, (fetched) => new Promise((_, reject) => {
      loads.signal.addEventListener("abort", () => {
        fetched(1);
        reject(loads.signal.reason as Error);
      });
    }));
    const image = reportGroundImage("grass.webp", loads.signal);
    loads.abort(new Error("the renderer has gone"));
    await expect(ended).rejects.toThrow("the renderer has gone");
    image.landed();
    expect(p.log.filter((line) => line.startsWith("done") || line.startsWith("bytes"))).toEqual([]);
    await modelLoadTold(FIR, live(), async () => "made");
    expect(p.log.at(-1)).toBe(`done models ${FIR}`);
  });

  it("tells nothing after the bar a load started under has gone, to no bar and to the next hike's", async () => {
    const first = told();
    setLoadProgress(first);
    const model = reportModel(FIR, live());
    const image = reportGroundImage("grass.webp", live());
    let settle: (value: string) => void = () => undefined;
    const pending = modelLoadTold(PINE, live(), (fetched) => new Promise<string>((resolve) => {
      settle = (value) => {
        fetched(5);
        resolve(value);
      };
    }));
    const before = [...first.log];
    // The hike is left mid-load.
    setLoadProgress(null);
    model.fetched(9);
    model.landed();
    image.landed();
    expect(first.log).toEqual(before);
    // The next hike's bar is up before the old loads settle.
    const next = told();
    setLoadProgress(next);
    model.landed();
    image.landed();
    settle("made");
    expect(await pending).toBe("made");
    expect(first.log).toEqual(before);
    expect(next.log).toEqual([]);
    // And the next hike's total starts from nothing.
    reportModel(RAVEN, live());
    expect(next.log[0]).toBe("total models 1");
  });

  it("tells the ground's stage of 24 by name: twelve maps, six albedos and six calls", () => {
    const p = told();
    setLoadProgress(p);
    reportLayer("start", "call.elk_bugle");
    reportLayer("done", "call.elk_bugle");
    expect(p.log).toEqual([`total ground ${GROUND_STAGE_TOTAL}`, "start ground call.elk_bugle", `total ground ${GROUND_STAGE_TOTAL}`, "done ground call.elk_bugle"]);
    expect(GROUND_STAGE_TOTAL).toBe(groundMaps.GROUND_LAYERS * 2 + groundMaps.GROUND_LAYERS + 6);
    // And the bar's own model takes them: a stage part done.
    const bar = createLoadProgress();
    setLoadProgress(bar);
    reportLayer("start", "a");
    reportLayer("done", "a");
    expect(bar.view().lines).toContain(`ground and sound 1 of ${GROUND_STAGE_TOTAL}`);
  });

  it("tells each of the ground's images as its fetch starts and as it is decoded", () => {
    const p = told();
    setLoadProgress(p);
    const image = reportGroundImage("ground.grass.webp", live());
    expect(p.log).toEqual([`total ground ${GROUND_STAGE_TOTAL}`, "start ground ground.grass.webp"]);
    image.landed();
    expect(p.log.at(-1)).toBe("done ground ground.grass.webp");
  });
});

describe("the bar under a hike's loads", () => {
  afterEach(() => setLoadProgress(null));

  /** Every model the hike asks for at once, by url, with one that fails. */
  const AT_ONCE = ["models/tree.giant_fir.glb", "models/tree.giant_pine.glb", "models/clutter.rock_a.glb", "models/cliff.wall_a.glb"].map(modelUrl);
  const BIRDS = ["models/wildlife.raven.glb", "models/wildlife.gull.glb"].map(modelUrl);
  const IMAGES = [...Object.values(groundMaps.GROUND_ALBEDOS).map((albedo) => albedo.url), ...groundMaps.GROUND_LAYER_URLS.normal, ...groundMaps.GROUND_LAYER_URLS.rah];

  it("moves through the models and the ground's images in the order they land, never back, and is full only at the gate", async () => {
    const bar = createLoadProgress();
    const marks: Stage[] = [];
    setLoadProgress(markedProgress(bar, (stage) => void marks.push(stage)));
    const seen: number[] = [];
    const look = (): { bar: number; lines: string[] } => {
      const view = bar.view();
      seen.push(view.bar);
      expect(view.ready).toBe(false);
      return view;
    };
    expect(look()).toEqual({ bar: 0, lines: [], ready: false });

    // The world's first two items and the six calls, as a hike's start tells them.
    const world = reportProgress() as LoadProgress;
    world.total("world", 11);
    for (const id of ["trail", "check"]) world.done("world", id);
    for (let call = 0; call < 6; call++) {
      reportLayer("start", `call.${call}`);
      reportLayer("done", `call.${call}`);
    }
    expect(look().lines).toEqual(["ground and sound 6 of 24", "building the world 2 of 11"]);

    // The renderer stands its world: four models and the eighteen images asked for at once, the birds named ahead.
    const loads = new AbortController();
    const settles = new Map<string, { fetched(): void; made(): void; failed(): void }>();
    const ask = (url: string): Promise<unknown> => modelLoadTold(url, loads.signal, (fetched) => new Promise((resolve, reject) => {
      settles.set(url, { fetched: () => fetched(modelBytes(url) as number), made: () => resolve(url), failed: () => reject(new Error(`${url}: HTTP 503`)) });
    })).catch(() => undefined);
    const asked = AT_ONCE.map(ask);
    expectModels(BIRDS);
    const images = IMAGES.map((url) => reportGroundImage(url, loads.signal));
    expect(IMAGES.length).toBe(18);
    const standing = look();
    expect(standing.lines[0]).toMatch(/^downloading models 0 of 6, 0\.0 of \d+\.\d MB$/);
    expect(standing.lines.slice(1)).toEqual(["ground and sound 6 of 24", "building the world 2 of 11"]);

    // The images land, each a step of the ground's tenth.
    let last = standing.bar;
    for (const image of images) {
      image.landed();
      const now = look().bar;
      expect(now).toBeGreaterThan(last);
      last = now;
    }
    expect(look().lines.some((line) => line.startsWith("ground and sound"))).toBe(false);

    // A model's bytes come in, then it is made: the bar moves at the bytes, the line at each.
    const fir = settles.get(AT_ONCE[0] as string) as { fetched(): void; made(): void };
    fir.fetched();
    const fetched = look();
    expect(fetched.bar).toBeGreaterThan(last);
    expect(fetched.lines[0]).toMatch(/^downloading models 1 of 6, /);
    expect(fetched.lines[1]).toBe("decoding models 0 of 1");
    fir.made();
    await asked[0];
    expect(look().lines[1]).toBe("building the world 2 of 11");
    last = look().bar;

    // One fails after its tries: it lands all the same, and the bar goes on.
    (settles.get(AT_ONCE[1] as string) as { failed(): void }).failed();
    await asked[1];
    const afterFailure = look();
    expect(afterFailure.bar).toBeGreaterThan(last);
    expect(afterFailure.lines[0]).toMatch(/^downloading models 2 of 6, /);
    last = afterFailure.bar;

    for (const url of AT_ONCE.slice(2)) {
      const model = settles.get(url) as { fetched(): void; made(): void };
      model.fetched();
      model.made();
    }
    await Promise.all(asked);
    expect(look().lines[0]).toMatch(/^downloading models 4 of 6, /);
    expect(look().bar).toBeGreaterThan(last);
    last = look().bar;

    // The birds, one after another.
    for (const url of BIRDS) {
      const bird = ask(url);
      const model = settles.get(url) as { fetched(): void; made(): void };
      model.fetched();
      model.made();
      await bird;
      const now = look().bar;
      expect(now).toBeGreaterThan(last);
      last = now;
    }
    // Every model and image is in: their shares are whole and their lines gone; the world's stage is what is left.
    expect(look().lines).toEqual(["building the world 2 of 11"]);
    expect(look().bar).toBeCloseTo(0.6 + 0.1 + 0.1 * (2 / 11), 9);
    for (let item = 2; item < 11; item++) world.done("world", `item${item}`);
    expect(look().lines).toEqual([]);
    expect(look().bar).toBeCloseTo(0.8, 9);

    // Never back, in the whole of it; and full only at the gate.
    for (let i = 1; i < seen.length; i++) expect(seen[i] as number).toBeGreaterThanOrEqual(seen[i - 1] as number);
    expect(Math.max(...seen)).toBeLessThan(1);
    world.gate();
    expect(bar.view()).toEqual({ bar: 1, lines: ["ready"], ready: true });
    expect(marks).toEqual(["ground", "models"]);
  });

  it("holds its value while a ranger asked for later raises the total, and goes on when it lands", async () => {
    const bar = createLoadProgress();
    setLoadProgress(bar);
    await Promise.all(AT_ONCE.map((url) => modelLoadTold(url, live(), async (fetched) => fetched(modelBytes(url) as number))));
    const whole = bar.view().bar;
    expect(whole).toBeCloseTo(0.6, 9);
    expect(bar.view().lines).toEqual([]);
    let made: () => void = () => undefined;
    const ranger = modelUrl("models/ranger.nathan.glb");
    const pending = modelLoadTold(ranger, live(), (fetched) => new Promise<void>((resolve) => {
      made = () => {
        fetched(modelBytes(ranger) as number);
        resolve();
      };
    }));
    expect(bar.view().bar).toBe(whole);
    expect(bar.view().lines[0]).toMatch(/^downloading models 4 of 5, /);
    made();
    await pending;
    expect(bar.view().bar).toBe(whole);
    expect(bar.view().lines).toEqual([]);
  });
});
