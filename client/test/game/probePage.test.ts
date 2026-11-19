import { afterEach, describe, expect, it, vi } from "vitest";
import { pageProbe, type StepMeasure } from "../../src/game/probePage.js";
import type { ProbeReading } from "../../src/game/quality.js";
import { createSkyTable } from "../../src/game/skyTable.js";
import type { SkySource } from "../../src/game/skyWorker.js";

describe("the page's half of the startup probe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const container = { clientWidth: 1600, clientHeight: 900 } as HTMLElement;
  const reading: ProbeReading = { tier: "high", frames: 120, meanMs: 16.7, p95Ms: 17.1, pixels: 1_440_000, engine: "webgpu" };
  /** A frame, then the timer `afterNextPaint` waits for. */
  const paints = (): void => void vi.stubGlobal("requestAnimationFrame", (paint: () => void) => setTimeout(paint, 0));
  function sky() {
    const started: number[] = [];
    const count = { stopped: 0 };
    const table = createSkyTable();
    const start = (startDeg: number): SkySource => {
      started.push(startDeg);
      return { table, dispose: () => void (count.stopped += 1) };
    };
    return { started, count, table, start };
  }

  it("hands each step the probe's one sky, started at the first step at the probe's noon, and its bound on the page's clock", async () => {
    paints();
    const s = sky();
    const steps: { tier: string; readyBy: number; sky: unknown; stopped: boolean }[] = [];
    const measure: StepMeasure = async (tier, step) => {
      steps.push({ tier, readyBy: step.readyBy, sky: step.sky, stopped: step.stopped() });
      return null;
    };
    const probe = pageProbe(container, measure, s.start);
    expect(probe.pixels()).toBe(1_440_000);
    // No sky before a step asks for one.
    expect(s.started).toEqual([]);
    // The page's clock, held: a step's bound is counted from when it is asked for.
    vi.stubGlobal("performance", { now: () => 5_000 });
    expect(await probe.runStep("high", () => false, 10_000)).toBeNull();
    expect(await probe.runStep("medium", () => false, 4_000)).toBeNull();
    expect(steps.map((step) => step.tier)).toEqual(["high", "medium"]);
    expect(steps.every((step) => step.sky === s.table && !step.stopped)).toBe(true);
    expect(steps.map((step) => step.readyBy)).toEqual([15_000, 9_000]);
    expect(s.started).toHaveLength(1);
    expect(s.started[0]).toBeCloseTo(75.96375653207352, 10);
    // The probe ends: its sky goes, once.
    expect(s.count.stopped).toBe(0);
    probe.endProbe!();
    expect(s.count.stopped).toBe(1);
    probe.abort();
    expect(s.count.stopped).toBe(1);
  });

  it("says a step's reading in the console, and nothing for a step that read none", async () => {
    paints();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const answers: (ProbeReading | null)[] = [reading, null];
    const probe = pageProbe(container, async () => answers.shift() ?? null, sky().start);
    expect(await probe.runStep("high", () => false, 10_000)).toEqual(reading);
    expect(await probe.runStep("medium", () => false, 10_000)).toBeNull();
    expect(info.mock.calls).toEqual([["quality probe: high 16.70 ms mean, 17.1 p95, 120 frames, 1600×900, webgpu → holds"]]);
    info.mockRestore();
  });

  it("measures nothing for a step the page has moved on from before its paint, and stops a step in hand as the abort reaches it", async () => {
    paints();
    const s = sky();
    let measured = 0;
    /** The step in hand: resolved by the abort it is handed. */
    const measure: StepMeasure = (_tier, step) =>
      new Promise((resolve) => {
        measured += 1;
        step.signal.addEventListener("abort", () => resolve(null));
      });
    const probe = pageProbe(container, measure, s.start);
    // Cancelled while the screen paints: no sky is started and nothing is measured.
    let cancelled = true;
    expect(await probe.runStep("high", () => cancelled, 10_000)).toBeNull();
    expect(measured).toBe(0);
    expect(s.started).toEqual([]);
    cancelled = false;
    const step = probe.runStep("high", () => cancelled, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(measured).toBe(1);
    probe.abort();
    expect(await step).toBeNull();
    expect(s.count.stopped).toBe(1);
    // After the abort a step asked for is stopped before it measures.
    expect(await probe.runStep("medium", () => false, 10_000)).toBeNull();
    expect(measured).toBe(1);
    expect(s.started).toHaveLength(1);
  });

  it("waits for the tab to be seen, and gives up the wait when the page moves on", async () => {
    const listeners = new Map<string, () => void>();
    const doc = { visibilityState: "hidden", addEventListener: (name: string, fn: () => void) => void listeners.set(name, fn), removeEventListener: (name: string) => void listeners.delete(name) };
    vi.stubGlobal("document", doc);
    const seen = pageProbe(container, async () => null, sky().start);
    const wait = seen.whenVisible();
    expect(listeners.has("visibilitychange")).toBe(true);
    doc.visibilityState = "visible";
    listeners.get("visibilitychange")!();
    expect(await wait).toBe(true);
    expect(listeners.size).toBe(0);
    // Hidden again, and the page moves on.
    doc.visibilityState = "hidden";
    const gone = pageProbe(container, async () => null, sky().start);
    const never = gone.whenVisible();
    gone.abort();
    expect(await never).toBe(false);
    expect(listeners.size).toBe(0);
    expect(await gone.whenVisible()).toBe(false);
    // A tab already seen is not waited for.
    doc.visibilityState = "visible";
    expect(await pageProbe(container, async () => null, sky().start).whenVisible()).toBe(true);
  });
});
