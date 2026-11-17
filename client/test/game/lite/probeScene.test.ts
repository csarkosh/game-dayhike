import { describe, expect, it, vi } from "vitest";
import "../../../src/sim/passes/index.js";
import { PROBE_FRAMES, PROBE_HOUR, PROBE_QUIET_MS, PROBE_WARMUP_FRAMES, probePose } from "../../../src/game/frameProbe.js";
import { buildLiteProbeScene, liteProbeReady, runLiteProbeStep, type ProbeRendererMaker } from "../../../src/game/lite/probeScene.js";
import type { FreecamView, Renderer } from "../../../src/game/renderer.js";
import { createSkyTable } from "../../../src/game/skyTable.js";
import { WEATHER_PRESETS } from "../../../src/game/weather.js";
import { skyFixture } from "../helpers/skyFixture.js";
import { asHtml, installStandInDom } from "../helpers/standInDom.js";
import { timeLimit } from "../../helpers/timeLimit.js";

/** A renderer that draws nothing, runs its loop when told, and says what it was asked. */
function fake(over: { failOn?: string; made?: Promise<boolean>; watched?: boolean } = {}) {
  const log: string[] = [];
  const state = {
    waiting: 0, view: null as FreecamView | null, loops: new Set<() => void>(), compiled: new Set<() => void>(), disposed: 0, options: null as unknown,
    /** Who watches the renderer's device, and how many have stopped. */
    watchers: new Set<(reason: "pipeline" | "lost") => void>(), unwatched: 0,
  };
  let skyIn: () => void = () => undefined;
  const sky = new Promise<void>((resolve) => { skyIn = resolve; });
  const renderer = {
    setWeather: (w: unknown) => {
      if (over.failOn === "weather") throw new Error("no weather");
      log.push(`weather ${w === WEATHER_PRESETS.mist ? "mist" : "other"}`);
    },
    setHour: (h: number) => void log.push(`hour ${h}`),
    setFreecam: (v: FreecamView | null) => { state.view = v; },
    sync: (_state: unknown, localId: number, alpha: number) => void log.push(`sync ${localId} ${alpha}`),
    drawFrame: () => void log.push("draw"),
    skyReady: () => sky,
    waitingItems: () => state.waiting,
    onShaderCompiled: (fn: () => void) => { state.compiled.add(fn); return () => void state.compiled.delete(fn); },
    runLoop: (fn: () => void) => void state.loops.add(fn),
    stopLoop: (fn?: () => void) => { if (fn === undefined) state.loops.clear(); else state.loops.delete(fn); },
    dispose: () => { state.disposed += 1; },
    // A renderer that makes its own engine says whether it came to stand, and keeps the watch on its device.
    ...(over.made === undefined ? {} : { whenMade: over.made }),
    engine: { isDisposed: false, dispose: () => undefined },
    ownWatch: over.watched !== true ? null : (_engine: unknown, onFailure: (reason: "pipeline" | "lost") => void) => {
      state.watchers.add(onFailure);
      return () => { state.watchers.delete(onFailure); state.unwatched += 1; };
    },
  };
  const make: ProbeRendererMaker = (_canvas, _level, _forest, options) => {
    state.options = options;
    return renderer as unknown as Renderer;
  };
  /** One frame of the page: every loop function the renderer was given. */
  const tick = (): void => { for (const fn of [...state.loops]) fn(); };
  return { make, log, state, skyIn, tick };
}

describe("the startup probe's scene on the hike's own renderer", () => {
  it("puts the camera on the canopy pose at the tier asked, in mist at the probe's hour, and draws a frame of a world nothing steps", () => {
    const f = fake();
    const sky = createSkyTable();
    const probe = buildLiteProbeScene({} as HTMLCanvasElement, "medium", sky, f.make);
    expect(f.state.options).toEqual({ tier: "medium", skyTable: sky });
    expect(f.log).toEqual(["weather mist", `hour ${PROBE_HOUR}`]);
    probe.frame();
    expect(f.state.view).toEqual(probePose());
    expect(f.log.slice(2)).toEqual(["sync -1 0", "draw"]);
    probe.dispose();
    expect(f.state.disposed).toBe(1);
    // With no sky handed in the renderer makes its own.
    const own = fake();
    buildLiteProbeScene({} as HTMLCanvasElement, "low", undefined, own.make).dispose();
    expect(own.state.options).toEqual({ tier: "low" });
  }, timeLimit(60_000));

  it("lets go of a renderer whose scene could not be set up", () => {
    const f = fake({ failOn: "weather" });
    expect(() => buildLiteProbeScene({} as HTMLCanvasElement, "low", undefined, f.make)).toThrow(/no weather/);
    expect(f.state.disposed).toBe(1);
  }, timeLimit(60_000));

  it("is ready once the sky's first slices are in and nothing is left to land, and stays ready once the meter has found it so", () => {
    expect(liteProbeReady(false, false, { waitingItems: () => 0 })).toBe(false);
    expect(liteProbeReady(false, true, { waitingItems: () => 2 })).toBe(false);
    expect(liteProbeReady(false, true, { waitingItems: () => 0 })).toBe(true);
    expect(liteProbeReady(true, false, { waitingItems: () => 5 })).toBe(true);
  });
});

describe("a probe step on the hike's own renderer", () => {
  function step(f: ReturnType<typeof fake>, over: { cancelled?: () => boolean; signal?: AbortSignal; readyBy?: number } = {}) {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    Object.assign(container, { clientWidth: 1470, clientHeight: 956 });
    const clock = { ms: 1000 };
    const reading = runLiteProbeStep(asHtml(container), "high", { cancelled: over.cancelled ?? (() => false), make: f.make, now: () => clock.ms, sky: skyFixture(), ...(over.signal ? { signal: over.signal } : {}), ...(over.readyBy !== undefined ? { readyBy: over.readyBy } : {}) });
    return { container, clock, reading };
  }

  it("waits for the sky and the models, warms up, measures the frames' intervals, and leaves no renderer or canvas behind", async () => {
    const f = fake();
    const { container, clock, reading } = step(f);
    expect(container.querySelector("canvas")).not.toBeNull();
    f.state.waiting = 4;
    f.skyIn();
    await Promise.resolve();
    // Not ready while a model is still to land: frames are drawn and none is counted.
    for (let i = 0; i < 10; i++) { clock.ms += 16; f.tick(); }
    f.state.waiting = 0;
    // Ready once no shader has compiled for the quiet time; then the warm-up, then the measured frames at 16 ms.
    clock.ms += PROBE_QUIET_MS;
    for (let i = 0; i < PROBE_WARMUP_FRAMES + PROBE_FRAMES + 8 && f.state.loops.size > 0; i++) { clock.ms += 16; f.tick(); }
    const got = await reading;
    expect(got).not.toBeNull();
    expect(got?.tier).toBe("high");
    expect(got?.engine).toBe("webgpu");
    expect(got?.pixels).toBe(1470 * 956);
    expect(got?.meanMs).toBeCloseTo(16, 6);
    expect(got?.frames).toBe(PROBE_FRAMES);
    expect(f.state.disposed).toBe(1);
    expect(f.state.loops.size).toBe(0);
    expect(f.state.compiled.size).toBe(0);
    expect(container.querySelector("canvas")).toBeNull();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("starts the warm-up again when a shader compiles late", async () => {
    const f = fake();
    const { clock, reading } = step(f);
    f.skyIn();
    await Promise.resolve();
    clock.ms += PROBE_QUIET_MS;
    for (let i = 0; i < PROBE_WARMUP_FRAMES + 20; i++) { clock.ms += 16; f.tick(); }
    const drawn = f.log.filter((line) => line === "draw").length;
    // A compile: the frames measured so far are no measure of the tier.
    for (const fn of [...f.state.compiled]) fn();
    clock.ms += PROBE_QUIET_MS;
    for (let i = 0; i < PROBE_WARMUP_FRAMES + PROBE_FRAMES + 8 && f.state.loops.size > 0; i++) { clock.ms += 16; f.tick(); }
    expect(await reading).not.toBeNull();
    // More frames than one warm-up and one measurement after the compile, less the twenty it threw away.
    expect(f.log.filter((line) => line === "draw").length - drawn).toBeGreaterThanOrEqual(PROBE_WARMUP_FRAMES + PROBE_FRAMES);
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("measures nothing when the page has moved on, when it is stopped, and when the scene never readies", async () => {
    const gone = fake();
    expect(await step(gone, { cancelled: () => true }).reading).toBeNull();
    expect(gone.state.options).toBeNull();
    const stopped = fake();
    const aborts = new AbortController();
    const s = step(stopped, { signal: aborts.signal });
    stopped.tick();
    aborts.abort();
    expect(await s.reading).toBeNull();
    // The renderer is let go before the abort returns.
    expect(stopped.state.disposed).toBe(1);
    expect(s.container.querySelector("canvas")).toBeNull();
    const never = fake();
    const n = step(never, { readyBy: 1000 + 500 });
    never.state.waiting = 1;
    for (let i = 0; i < 60 && never.state.loops.size > 0; i++) { n.clock.ms += 20; never.tick(); }
    expect(await n.reading).toBeNull();
    expect(never.state.disposed).toBe(1);
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("reads nothing, at once, where the renderer could not be made: it stays empty, its sky comes in and nothing is left to land, and its frames draw nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = fake({ made: Promise.resolve(false) });
    const { container, clock, reading } = step(f);
    // Everything a standing renderer's step waits for, as an empty renderer answers it.
    f.skyIn();
    clock.ms += PROBE_QUIET_MS;
    expect(await reading).toBeNull();
    expect(warn).toHaveBeenCalledWith("quality probe: the renderer could not be made.");
    expect(f.state.disposed).toBe(1);
    expect(f.state.loops.size).toBe(0);
    expect(container.querySelector("canvas")).toBeNull();
    // A renderer that came to stand is measured as ever.
    const stood = fake({ made: Promise.resolve(true) });
    const s = step(stood);
    stood.skyIn();
    await Promise.resolve();
    s.clock.ms += PROBE_QUIET_MS;
    for (let i = 0; i < PROBE_WARMUP_FRAMES + PROBE_FRAMES + 8 && stood.state.loops.size > 0; i++) { s.clock.ms += 16; stood.tick(); }
    expect((await s.reading)?.frames).toBe(PROBE_FRAMES);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("keeps the renderer's own watch on its device, and reads nothing once the device fails under the step", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = fake({ watched: true });
    const { container, clock, reading } = step(f);
    expect(f.state.watchers.size).toBe(1);
    f.skyIn();
    await Promise.resolve();
    clock.ms += PROBE_QUIET_MS;
    for (let i = 0; i < PROBE_WARMUP_FRAMES + 20; i++) { clock.ms += 16; f.tick(); }
    // The device is lost: the renderer draws no more, and the frames after would read as a tier that holds.
    for (const lost of [...f.state.watchers]) lost("lost");
    expect(await reading).toBeNull();
    expect(warn).toHaveBeenCalledWith("quality probe: the renderer's device failed (lost).");
    expect(f.state.disposed).toBe(1);
    expect(f.state.unwatched).toBe(1);
    expect(container.querySelector("canvas")).toBeNull();
    // A step that ends with a reading lets the watch go before it lets go of the renderer.
    const whole = fake({ watched: true });
    const w = step(whole);
    whole.skyIn();
    await Promise.resolve();
    w.clock.ms += PROBE_QUIET_MS;
    for (let i = 0; i < PROBE_WARMUP_FRAMES + PROBE_FRAMES + 8 && whole.state.loops.size > 0; i++) { w.clock.ms += 16; whole.tick(); }
    expect(await w.reading).not.toBeNull();
    expect(whole.state.unwatched).toBe(1);
    expect(whole.state.watchers.size).toBe(0);
    warn.mockRestore();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("ends quietly on a renderer that cannot be built or a frame that throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unbuilt = fake({ failOn: "weather" });
    const u = step(unbuilt);
    expect(await u.reading).toBeNull();
    expect(u.container.querySelector("canvas")).toBeNull();
    const thrown = fake();
    const t = step(thrown);
    thrown.log.push = () => { throw new Error("a frame failed"); };
    thrown.tick();
    expect(await t.reading).toBeNull();
    expect(thrown.state.disposed).toBe(1);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));
});
