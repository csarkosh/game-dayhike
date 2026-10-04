import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SLICE_ALTITUDES_DEG, SLICE_AZIMUTHS, SLICE_ELEVATIONS, type SkySlice } from "../../src/game/skyModel.js";
import { makeSlices, type SkyWorkerReply } from "../../src/game/sky.worker.js";
import { startSkySource } from "../../src/game/skyWorker.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A slice whose every value is `v`: what a worker's message would carry, without the model's cost. */
function flatSlice(altitudeDeg: number, v = 1): SkySlice {
  return {
    altitudeDeg,
    texels: new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3).fill(v),
    ring: new Float32Array(SLICE_AZIMUTHS * 3).fill(v),
    zenith: { r: v, g: v, b: v },
    skyIrradiance: { r: v, g: v, b: v },
    sun: { r: v, g: v, b: v },
  };
}

/** A Worker that records what it is sent and whether it was ended; the test answers for it. */
class FakeWorker {
  static made: FakeWorker[] = [];
  static refuse = false;
  readonly posted: unknown[] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<SkyWorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: URL, readonly options: WorkerOptions) {
    if (FakeWorker.refuse) throw new Error("no worker to be had");
    FakeWorker.made.push(this);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated++;
  }
  send(slice: SkySlice): void {
    this.onmessage?.({ data: { slice } } as MessageEvent<SkyWorkerReply>);
  }
}

/** Stands in for queueMicrotask and keeps what is queued, so a test can see an error rethrown there. */
function captureMicrotasks(): (() => void)[] {
  const queued: (() => void)[] = [];
  vi.stubGlobal("queueMicrotask", (callback: () => void) => {
    queued.push(callback);
  });
  return queued;
}

afterEach(() => {
  FakeWorker.made = [];
  FakeWorker.refuse = false;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the sky's worker", () => {
  it("makes the slices in sliceOrder, posting each as it is made, and stops when a post throws", () => {
    const made: number[] = [];
    expect(() =>
      makeSlices(10.2, (slice) => {
        made.push(slice.altitudeDeg);
        if (made.length === 5) throw new Error("enough");
      }),
    ).toThrow("enough");
    expect(made).toEqual([74, 76, 10, 10.5, 9.5]);
    // Under Node there is no worker scope: importing the module set no handler.
    expect((globalThis as { onmessage?: unknown }).onmessage).toBeUndefined();
  }, timeLimit(20_000));

  it("posts slices whose buffers are their own, so each transfers whole and alone", () => {
    const slices: SkySlice[] = [];
    expect(() =>
      makeSlices(0, (slice) => {
        slices.push(slice);
        if (slices.length === 2) throw new Error("enough");
      }),
    ).toThrow("enough");
    const buffers = new Set<ArrayBufferLike>();
    for (const slice of slices) {
      for (const values of [slice.texels, slice.ring]) {
        expect(values.byteOffset).toBe(0);
        expect(values.buffer.byteLength).toBe(values.byteLength);
        buffers.add(values.buffer);
      }
    }
    expect(buffers.size).toBe(4);
    const slice = slices[0] as SkySlice;
    const texels = new Float32Array(slice.texels);
    const reply: SkyWorkerReply = { slice };
    const moved = structuredClone(reply, { transfer: [slice.texels.buffer, slice.ring.buffer] });
    expect(moved.slice.texels).toEqual(texels);
    expect(moved.slice.zenith).toEqual(slice.zenith);
    expect(slice.texels.buffer.byteLength).toBe(0);
    expect(slice.ring.buffer.byteLength).toBe(0);
  }, timeLimit(20_000));
});

describe("the sky's source", () => {
  it("starts a module worker in the form Vite bundles", () => {
    const text = readFileSync(new URL("../../src/game/skyWorker.ts", import.meta.url), "utf8");
    // The code alone: the form is also written in the doc comment, which would pass whatever the call said.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain('new Worker(new URL("./sky.worker.ts", import.meta.url), { type: "module" })');
  });

  it("without a Worker, makes the slices in this thread, one per timer, in sliceOrder, until disposed", () => {
    vi.useFakeTimers();
    const source = startSkySource(10.2);
    // Nothing is made before the first timer: the caller's frame is not held.
    expect(source.table.count).toBe(0);
    const expected = [74, 76, 10, 10.5];
    for (let k = 0; k < expected.length; k++) {
      vi.advanceTimersToNextTimer();
      expect(source.table.count).toBe(k + 1);
      expect(source.table.has(expected[k] as number)).toBe(true);
    }
    expect(source.table.has(10.2)).toBe(true);
    source.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(source.table.count).toBe(4);
  }, timeLimit(20_000));

  it("asks the worker for the start altitude, holds what it sends, and ends it when every slice is in", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const source = startSkySource(10.2);
    const worker = FakeWorker.made.at(-1) as FakeWorker;
    expect(String(worker.url)).toMatch(/\/sky\.worker\.ts$/);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.posted).toEqual([{ startDeg: 10.2 }]);
    worker.send(flatSlice(74));
    expect(source.table.count).toBe(1);
    expect(worker.terminated).toBe(0);
    for (const altitude of SLICE_ALTITUDES_DEG) worker.send(flatSlice(altitude));
    expect(source.table.count).toBe(93);
    expect(worker.terminated).toBe(1);
    source.dispose();
  });

  it("ends the worker on dispose and ignores a slice that arrives after", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const source = startSkySource(10.2);
    const worker = FakeWorker.made.at(-1) as FakeWorker;
    const send = worker.onmessage;
    source.dispose();
    expect(worker.terminated).toBe(1);
    send?.({ data: { slice: flatSlice(74) } } as MessageEvent<SkyWorkerReply>);
    expect(source.table.count).toBe(0);
  });

  it("makes the rest in this thread when the worker fails partway, skipping what it sent", () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const source = startSkySource(10.2);
    const worker = FakeWorker.made.at(-1) as FakeWorker;
    worker.send(flatSlice(74, 7));
    worker.send(flatSlice(76, 7));
    worker.onerror?.({ message: "failed" } as ErrorEvent);
    expect(worker.terminated).toBe(1);
    vi.advanceTimersToNextTimer();
    expect(source.table.count).toBe(3);
    expect(source.table.has(10)).toBe(true);
    // The worker's slices stay as it sent them.
    expect(source.table.blendAt(74).texels[0]).toBe(7);
    source.dispose();
    expect(vi.getTimerCount()).toBe(0);
  }, timeLimit(20_000));

  it("keeps taking the worker's slices when a listener throws, and rethrows its error", () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const queued = captureMicrotasks();
    const source = startSkySource(10.2);
    const worker = FakeWorker.made.at(-1) as FakeWorker;
    source.table.onChange(() => {
      throw new Error("listener failed");
    });
    worker.send(flatSlice(74));
    worker.send(flatSlice(76));
    expect(source.table.count).toBe(2);
    expect(worker.terminated).toBe(0);
    // The worker is not taken for a failed one: nothing is made in this thread.
    expect(vi.getTimerCount()).toBe(0);
    expect(queued.length).toBe(2);
    expect(() => (queued[0] as () => void)()).toThrow("listener failed");
    for (const altitude of SLICE_ALTITUDES_DEG) worker.send(flatSlice(altitude));
    expect(source.table.count).toBe(93);
    expect(worker.terminated).toBe(1);
    // Two adds above, then the 91 altitudes below them: the worker is ended on the last new one.
    expect(queued.length).toBe(93);
    source.dispose();
  });

  it("makes every slice in this thread when a listener throws on each, and rethrows each error", () => {
    vi.useFakeTimers();
    const queued = captureMicrotasks();
    const source = startSkySource(10.2);
    source.table.onChange(() => {
      throw new Error("listener failed");
    });
    vi.advanceTimersToNextTimer();
    expect(source.table.count).toBe(1);
    // The chain goes on: the next timer is set before the slice is added.
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(source.table.count).toBe(93);
    expect(vi.getTimerCount()).toBe(0);
    expect(queued.length).toBe(93);
    expect(() => (queued[92] as () => void)()).toThrow("listener failed");
    source.dispose();
  }, timeLimit(20_000));

  it("stops the fallback's chain when a listener disposes the source", () => {
    vi.useFakeTimers();
    const source = startSkySource(10.2);
    source.table.onChange(() => {
      if (source.table.count === 2) source.dispose();
    });
    vi.runAllTimers();
    expect(source.table.count).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  }, timeLimit(20_000));

  it("makes the slices in this thread when no worker can be made", () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.refuse = true;
    const source = startSkySource(-40);
    vi.advanceTimersToNextTimer();
    expect(source.table.count).toBe(1);
    expect(source.table.has(74)).toBe(true);
    source.dispose();
  }, timeLimit(20_000));
});
