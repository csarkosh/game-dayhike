import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SLICE_ALTITUDES_DEG,
  SLICE_AZIMUTHS,
  SLICE_ELEVATIONS,
  buildSkyTables,
  buildSlice,
  type SkySlice,
} from "../../src/game/skyModel.js";
import {
  NOON_ALTITUDE_DEG,
  buildSkyTableSync,
  createSkyTable,
  sliceBracket,
  sliceOrder,
} from "../../src/game/skyTable.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A slice whose every texel holds `v`, every ring value v + 1, and whose derived colours are v + 2 to v + 4. */
function flatSlice(altitudeDeg: number, v: number): SkySlice {
  return {
    altitudeDeg,
    texels: new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3).fill(v),
    ring: new Float32Array(SLICE_AZIMUTHS * 3).fill(v + 1),
    zenith: { r: v + 2, g: v + 2, b: v + 2 },
    skyIrradiance: { r: v + 3, g: v + 3, b: v + 3 },
    sun: { r: v + 4, g: v + 4, b: v + 4 },
  };
}

/** Lets every promise already settled run its callbacks. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Stands in for queueMicrotask and keeps what is queued, so a test can see an error rethrown there. */
function captureMicrotasks(): (() => void)[] {
  const queued: (() => void)[] = [];
  vi.stubGlobal("queueMicrotask", (callback: () => void) => {
    queued.push(callback);
  });
  return queued;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the order the slices are made in", () => {
  it("knows the noon sun's altitude on the arc", () => {
    expect(NOON_ALTITUDE_DEG).toBeCloseTo(75.96376, 5);
  });

  it("brackets an altitude by one slice when it is a slice altitude or beyond the ends, else by the two either side", () => {
    expect(sliceBracket(NOON_ALTITUDE_DEG)).toEqual([91, 92]);
    expect(sliceBracket(10.2)).toEqual([56, 57]);
    expect(sliceBracket(10)).toEqual([56]);
    expect(sliceBracket(12.5)).toEqual([60, 61]);
    expect(sliceBracket(-18)).toEqual([0]);
    expect(sliceBracket(-40)).toEqual([0]);
    expect(sliceBracket(76)).toEqual([92]);
    expect(sliceBracket(80)).toEqual([92]);
  });

  it("makes the noon bracket first, then the start's, then outward from the start, below first", () => {
    expect(sliceOrder(10.2).slice(0, 10)).toEqual([91, 92, 56, 57, 55, 58, 54, 59, 53, 60]);
  });

  it("makes a start that is a slice altitude from that one slice", () => {
    expect(sliceOrder(10).slice(0, 9)).toEqual([91, 92, 56, 55, 57, 54, 58, 53, 59]);
  });

  it("skips the start's bracket when it is the noon bracket, and runs out downward", () => {
    expect(sliceOrder(75)).toEqual([91, 92, ...Array.from({ length: 91 }, (_, k) => 90 - k)]);
  });

  it("starts the night from the lowest slice and climbs", () => {
    expect(sliceOrder(-40)).toEqual([91, 92, ...Array.from({ length: 91 }, (_, k) => k)]);
  });

  it("lists every slice exactly once, from any start", () => {
    const every = Array.from({ length: 93 }, (_, k) => k);
    for (const start of [-90, -18, -17.75, 0, 10, 10.2, 12, 13, 50, 74, 75, NOON_ALTITUDE_DEG, 76, 90]) {
      expect([...sliceOrder(start)].sort((a, b) => a - b)).toEqual(every);
    }
  });
});

describe("the sky table", () => {
  it("holds slices by altitude, replacing one of the same altitude", () => {
    const table = createSkyTable();
    expect(table.count).toBe(0);
    table.add(flatSlice(10, 1));
    table.add(flatSlice(-3, 1));
    table.add(flatSlice(10, 5));
    expect(table.count).toBe(2);
    expect(table.blendAt(10).texels[0]).toBe(5);
  });

  it("refuses a slice of the wrong size", () => {
    const table = createSkyTable();
    expect(() => table.add({ ...flatSlice(10, 1), texels: new Float32Array(3) })).toThrow("texels");
    expect(() => table.add({ ...flatSlice(10, 1), ring: new Float32Array(3) })).toThrow("ring");
    expect(() => table.add(flatSlice(Number.NaN, 1))).toThrow("finite altitude");
    expect(table.count).toBe(0);
  });

  it("has an altitude when its bracketing slices are held, or a slice at it exactly", () => {
    const table = createSkyTable();
    table.add(flatSlice(10, 1));
    expect(table.has(10)).toBe(true);
    expect(table.has(10.2)).toBe(false);
    table.add(flatSlice(10.5, 1));
    expect(table.has(10.2)).toBe(true);
    expect(table.has(10.5)).toBe(true);
    expect(table.has(10.7)).toBe(false);
    expect(table.has(11)).toBe(false);
    // Off the grid, a slice held at the altitude itself is enough.
    table.add(flatSlice(33.3, 1));
    expect(table.has(33.3)).toBe(true);
    // Beyond the ends, the end slice.
    expect(table.has(-40)).toBe(false);
    table.add(flatSlice(-18, 1));
    expect(table.has(-40)).toBe(true);
  });

  it("blends linearly between the held slices nearest below and above", () => {
    const table = createSkyTable();
    table.add(flatSlice(10, 2));
    table.add(flatSlice(12, 6));
    table.add(flatSlice(-6, 100));
    const mid = table.blendAt(11);
    expect(mid.altitudeDeg).toBe(11);
    expect(mid.texels.every((v) => v === 4)).toBe(true);
    expect(mid.ring.every((v) => v === 5)).toBe(true);
    expect(mid.zenith).toEqual({ r: 6, g: 6, b: 6 });
    expect(mid.skyIrradiance).toEqual({ r: 7, g: 7, b: 7 });
    expect(mid.sun).toEqual({ r: 8, g: 8, b: 8 });
    const quarter = table.blendAt(10.5);
    expect(quarter.texels[100]).toBe(3);
    expect(quarter.sun.g).toBe(7);
  });

  it("gives the held slice's own values at its altitude, and the nearest end's outside the held range", () => {
    const table = createSkyTable();
    const low = flatSlice(-6, 1);
    const high = flatSlice(20, 9);
    table.add(low);
    table.add(high);
    const exact = table.blendAt(-6);
    expect(exact).toEqual(low);
    for (const [altitude, held] of [[-40, low], [-6.0001, low], [20.5, high], [76, high]] as const) {
      const out = table.blendAt(altitude);
      expect(out.altitudeDeg).toBe(altitude);
      expect(out.texels).toEqual(held.texels);
      expect(out.ring).toEqual(held.ring);
      expect(out.zenith).toEqual(held.zenith);
      expect(out.skyIrradiance).toEqual(held.skyIrradiance);
      expect(out.sun).toEqual(held.sun);
    }
  });

  it("returns a new slice every call, sharing nothing with the table", () => {
    const table = createSkyTable();
    const held = flatSlice(10, 2);
    table.add(held);
    table.add(flatSlice(12, 6));
    for (const altitude of [10, 11, -40]) {
      const first = table.blendAt(altitude);
      const second = table.blendAt(altitude);
      for (const out of [first, second]) {
        expect(out.texels).not.toBe(held.texels);
        expect(out.ring).not.toBe(held.ring);
        expect(out.zenith).not.toBe(held.zenith);
        expect(out.skyIrradiance).not.toBe(held.skyIrradiance);
        expect(out.sun).not.toBe(held.sun);
      }
      expect(second.texels).not.toBe(first.texels);
      first.texels.fill(-1);
      first.zenith.r = -1;
      expect(table.blendAt(altitude).texels[0]).toBe(second.texels[0]);
      expect(table.blendAt(altitude).zenith.r).toBe(second.zenith.r);
    }
    expect(held.texels[0]).toBe(2);
  });

  it("throws when it holds nothing", () => {
    expect(() => createSkyTable().blendAt(10)).toThrow("no slice");
  });

  it("resolves whenReady once the altitude's slices are held, and at once when they already are", async () => {
    const table = createSkyTable();
    let ready = false;
    const waited = table.whenReady(10.2).then(() => {
      ready = true;
    });
    table.add(flatSlice(10, 1));
    await settle();
    expect(ready).toBe(false);
    table.add(flatSlice(10.5, 1));
    await waited;
    expect(ready).toBe(true);
    await expect(table.whenReady(10)).resolves.toBeUndefined();
  });

  it("calls its listeners after every add, until each unsubscribes", () => {
    const table = createSkyTable();
    const seen: number[] = [];
    const other: number[] = [];
    const stop = table.onChange(() => seen.push(table.count));
    const stopSelf: () => void = table.onChange(() => {
      other.push(table.count);
      stopSelf();
    });
    table.add(flatSlice(10, 1));
    table.add(flatSlice(10.5, 1));
    stop();
    table.add(flatSlice(11, 1));
    expect(seen).toEqual([1, 2]);
    expect(other).toEqual([1]);
  });

  it("skips a listener that a sibling unsubscribed earlier in the same pass", () => {
    const table = createSkyTable();
    const calls: string[] = [];
    let stopSecond: () => void = () => {};
    table.onChange(() => {
      calls.push("first");
      stopSecond();
    });
    stopSecond = table.onChange(() => calls.push("second"));
    table.onChange(() => calls.push("third"));
    table.add(flatSlice(10, 1));
    expect(calls).toEqual(["first", "third"]);
    table.add(flatSlice(10.5, 1));
    expect(calls).toEqual(["first", "third", "first", "third"]);
  });

  it("holds the slice and calls the other listeners when one throws, and rethrows its error from a microtask", () => {
    const queued = captureMicrotasks();
    const table = createSkyTable();
    const seen: number[] = [];
    table.onChange(() => {
      throw new Error("listener failed");
    });
    table.onChange(() => seen.push(table.count));
    expect(() => table.add(flatSlice(10, 1))).not.toThrow();
    expect(table.count).toBe(1);
    expect(table.has(10)).toBe(true);
    expect(seen).toEqual([1]);
    expect(queued.length).toBe(1);
    expect(() => (queued[0] as () => void)()).toThrow("listener failed");
    expect(() => table.add(flatSlice(10.5, 1))).not.toThrow();
    expect(seen).toEqual([1, 2]);
    expect(queued.length).toBe(2);
  });

  it("still throws for a slice it cannot hold, and calls no listener for it", () => {
    const queued = captureMicrotasks();
    const table = createSkyTable();
    const seen: number[] = [];
    table.onChange(() => seen.push(table.count));
    expect(() => table.add({ ...flatSlice(10, 1), ring: new Float32Array(3) })).toThrow("ring");
    expect(seen).toEqual([]);
    expect(queued.length).toBe(0);
  });
});

describe("a table built in this thread", () => {
  it("holds the slices asked for, as the model makes them", () => {
    const table = buildSkyTableSync([10, 10.5]);
    expect(table.count).toBe(2);
    expect(table.has(10.2)).toBe(true);
    expect(table.has(11)).toBe(false);
    const made = buildSlice(buildSkyTables(), 10);
    const held = table.blendAt(10);
    expect(held.texels).toEqual(made.texels);
    expect(held.ring).toEqual(made.ring);
    expect(held.zenith).toEqual(made.zenith);
    expect(held.sun).toEqual(made.sun);
  }, timeLimit(20_000));

  it("holds every slice altitude by default", () => {
    const table = buildSkyTableSync();
    expect(table.count).toBe(SLICE_ALTITUDES_DEG.length);
    for (const altitude of SLICE_ALTITUDES_DEG) expect(table.has(altitude)).toBe(true);
  }, timeLimit(60_000));
});
