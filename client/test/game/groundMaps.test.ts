import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { flipRowsY, interleaveLayers, loadGroundArrays, NEUTRAL_NORMAL, NEUTRAL_RAH } from "../../src/game/groundMaps.js";

describe("interleaveLayers", () => {
  it("concatenates six RGBA planes in layer order", () => {
    const layers = [0, 1, 2, 3, 4, 5].map((i) => Uint8ClampedArray.from([i, i, i, 255]));
    expect(Array.from(interleaveLayers(layers, 1))).toEqual([0,0,0,255, 1,1,1,255, 2,2,2,255, 3,3,3,255, 4,4,4,255, 5,5,5,255]);
  });
  it("refuses a plane of the wrong size or the wrong count", () => {
    expect(() => interleaveLayers([new Uint8ClampedArray(3)], 1)).toThrow(/6 layers/);
    expect(() => interleaveLayers(new Array(6).fill(new Uint8ClampedArray(3)), 1)).toThrow(/layer 0: 3 bytes/);
  });
});

describe("neutral texels", () => {
  it("are a flat +Z normal and mid-rough, AO-neutral, flat height", () => {
    expect(Array.from(NEUTRAL_NORMAL)).toEqual([128, 128, 255, 255]);
    // All three RAH channels share one packed neutral byte (128 raw), since
    // packRAH centres each of roughness/AO/height on its own mean of 0.5 — the
    // shader's `ao / 0.5` divide turns AO's 128 into ≈1.0, a no-op multiplier.
    expect(Array.from(NEUTRAL_RAH)).toEqual([128, 128, 128, 255]);
  });
});

describe("flipRowsY", () => {
  it("reverses row order of a 2x2 RGBA buffer, leaving each row's own bytes untouched", () => {
    const row0 = [1, 1, 1, 255, 2, 2, 2, 255];
    const row1 = [3, 3, 3, 255, 4, 4, 4, 255];
    const data = Uint8ClampedArray.from([...row0, ...row1]);
    expect(Array.from(flipRowsY(data, 2))).toEqual([...row1, ...row0]);
  });
  it("is its own inverse and leaves a single row (size 1) unchanged", () => {
    const data = Uint8ClampedArray.from([9, 9, 9, 255]);
    expect(Array.from(flipRowsY(data, 1))).toEqual([9, 9, 9, 255]);
    const twoByTwo = Uint8ClampedArray.from([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]);
    expect(Array.from(flipRowsY(flipRowsY(twoByTwo, 2), 2))).toEqual(Array.from(twoByTwo));
  });
});

describe("loadGroundArrays under NullEngine", () => {
  it("resolves ready after every layer decodes, and swaps the placeholders exactly once", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    let calls = 0;
    const decode = async () => { calls++; return new Uint8ClampedArray(2 * 2 * 4).fill(7); };
    const created: number[] = [];
    const arrays = loadGroundArrays(scene, undefined, decode, {
      size: 2,
      // NullEngine cannot create a 2D-array texture; the factory is the seam the
      // real loader and this test share.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      createArray: (data: Uint8Array, size: number, depth: number) => { created.push(data.length); return { dispose() {}, name: `arr${created.length}`, isReady: () => true } as never; },
    });
    expect(created).toEqual([1 * 1 * 6 * 4, 1 * 1 * 6 * 4]); // two 1×1×6 placeholders
    await arrays.ready;
    expect(calls).toBe(12);
    expect(created).toEqual([24, 24, 2 * 2 * 6 * 4, 2 * 2 * 6 * 4]);
    expect(arrays.normals.name).toBe("arr3");
    expect(arrays.rah.name).toBe("arr4");
    arrays.dispose();
    engine.dispose();
  });
  it("keeps the placeholders if a decode fails, and says so once", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const warnings: string[] = [];
    const arrays = loadGroundArrays(scene, undefined, async () => { throw new Error("nope"); }, {
      size: 2, createArray: () => ({ dispose() {}, name: "p", isReady: () => true }) as never, warn: (m: string) => warnings.push(m),
    });
    await arrays.ready;
    expect(arrays.normals.name).toBe("p");
    expect(warnings).toHaveLength(1);
    engine.dispose();
  });
  it("disposed mid-load: the late textures are never created, and both placeholders are disposed", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const resolvers: Array<(value: Uint8ClampedArray) => void> = [];
    const decode = () => new Promise<Uint8ClampedArray>((resolve) => { resolvers.push(resolve); });
    const created: number[] = [];
    const disposedNames: string[] = [];
    const arrays = loadGroundArrays(scene, undefined, decode, {
      size: 2,
      createArray: (data: Uint8Array) => {
        const name = `arr${created.push(data.length)}`;
        return { dispose() { disposedNames.push(name); }, name, isReady: () => true } as never;
      },
    });
    expect(created).toEqual([1 * 1 * 6 * 4, 1 * 1 * 6 * 4]); // two 1×1×6 placeholders
    arrays.dispose();
    expect(disposedNames).toEqual(["arr1", "arr2"]); // both placeholders disposed synchronously
    expect(resolvers).toHaveLength(12); // all twelve decodes were in flight
    resolvers.forEach((resolve) => resolve(new Uint8ClampedArray(2 * 2 * 4).fill(7)));
    await arrays.ready;
    expect(created).toEqual([1 * 1 * 6 * 4, 1 * 1 * 6 * 4]); // no late texture was ever created
    engine.dispose();
  });
});
