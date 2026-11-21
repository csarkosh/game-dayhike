import { describe, expect, it, vi } from "vitest";
import "../../src/game/dayhikeAssets.js";
import {
  GROUND_ALBEDOS, GROUND_LAYERS, GROUND_LAYER_URLS, GROUND_MAP_SIZE, NEUTRAL_NORMAL, NEUTRAL_RAH,
  decodeGroundLayer, flipRowsY, interleaveLayers,
} from "../../src/game/groundLayers.js";

describe("the ground's layers", () => {
  it("are six, each with an albedo read under its own sampler, in layer order", () => {
    expect(GROUND_LAYERS).toBe(6);
    expect(Object.keys(GROUND_ALBEDOS)).toEqual(["grass", "floor", "rock", "sand", "pebble", "asphalt"]);
    expect(Object.values(GROUND_ALBEDOS).map((a) => a.sampler)).toEqual([
      "terrainGrass", "terrainFloor", "terrainRock", "terrainSand", "terrainPebble", "roadAsphalt",
    ]);
    const files = ["grass", "forest_floor", "rock", "sand", "pebble", "asphalt"];
    expect(Object.values(GROUND_ALBEDOS).map((a) => /ground\.([a-z_]+)\.webp/.exec(a.url)?.[1])).toEqual(files);
  });

  it("have a normal and an RAH image each, in the same order, for arrays 512 texels a side", () => {
    expect(GROUND_MAP_SIZE).toBe(512);
    const files = ["grass", "forest_floor", "rock", "sand", "pebble", "asphalt"];
    expect(GROUND_LAYER_URLS.normal.map((u) => /ground\.([a-z_]+)\.normal\.webp/.exec(u)?.[1])).toEqual(files);
    expect(GROUND_LAYER_URLS.rah.map((u) => /ground\.([a-z_]+)\.rah\.webp/.exec(u)?.[1])).toEqual(files);
  });

  it("stand as one neutral texel a layer until the images land", () => {
    const placeholder = interleaveLayers(new Array<Uint8ClampedArray>(GROUND_LAYERS).fill(NEUTRAL_NORMAL), 1);
    expect(placeholder).toHaveLength(GROUND_LAYERS * 4);
    expect(Array.from(placeholder.subarray(20))).toEqual([128, 128, 255, 255]);
    expect(Array.from(NEUTRAL_RAH)).toEqual([128, 128, 128, 255]);
  });
});

describe("a layer's decode", () => {
  it("reads the image as data, at the array's side, and turns its rows over", async () => {
    const top = [1, 1, 1, 255, 2, 2, 2, 255];
    const bottom = [3, 3, 3, 255, 4, 4, 4, 255];
    const closed = vi.fn();
    const options: unknown[] = [];
    const drawn: unknown[][] = [];
    vi.stubGlobal("fetch", async () => ({ ok: true, blob: async () => new Blob([]) }));
    vi.stubGlobal("createImageBitmap", async (_blob: Blob, o: unknown) => {
      options.push(o);
      return { close: closed };
    });
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(readonly width: number, readonly height: number) {}
      getContext() {
        return {
          drawImage: (...args: unknown[]) => { drawn.push(args.slice(1)); },
          getImageData: () => ({ data: Uint8ClampedArray.from([...top, ...bottom]) }),
        };
      }
    });
    try {
      const data = await decodeGroundLayer("ground.webp", 2);
      expect(Array.from(data)).toEqual([...bottom, ...top]);
      expect(Array.from(data)).toEqual(Array.from(flipRowsY(Uint8ClampedArray.from([...top, ...bottom]), 2)));
      expect(options).toEqual([{ colorSpaceConversion: "none", premultiplyAlpha: "none" }]);
      expect(drawn).toEqual([[0, 0, 2, 2]]);
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails on a response that is not ok, naming the image", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    try {
      await expect(decodeGroundLayer("ground.webp", 2)).rejects.toThrow("ground.webp: HTTP 404");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
