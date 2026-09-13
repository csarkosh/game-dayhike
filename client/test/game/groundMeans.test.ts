import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { LAYER_MEAN_RGB } from "../../src/game/terrainTexture.js";

/**
 * `terrainTexture.ts` divides each ground layer's texel by that layer's own
 * mean COLOUR so a flat texture is exactly neutral and the palette decides the
 * hue. Those means are measured off the committed WebPs, so they are only true
 * while those files are the ones on disk — a rebuilt or re-encoded texture
 * moves them and would silently re-tint the world (a "grass looks like
 * rocks" defect was once caused by exactly that, from the scalar the shader
 * used before). This recomputes them from the real files.
 */
const FILES: Record<keyof typeof LAYER_MEAN_RGB, string> = {
  grass: "ground.grass.webp",
  floor: "ground.forest_floor.webp",
  rock: "ground.rock.webp",
  sand: "ground.sand.webp",
  pebble: "ground.pebble.webp",
};

async function meanRgb(file: string): Promise<[number, number, number]> {
  const path = fileURLToPath(new URL(`../../assets/textures/${file}`, import.meta.url));
  const { channels } = await sharp(path).stats();
  return [channels[0]!.mean / 255, channels[1]!.mean / 255, channels[2]!.mean / 255];
}

describe("the ground layers' mean colours", () => {
  it("match the constants the blend divides by, per channel", async () => {
    for (const layer of Object.keys(FILES) as (keyof typeof LAYER_MEAN_RGB)[]) {
      const measured = await meanRgb(FILES[layer]);
      const pinned = LAYER_MEAN_RGB[layer];
      for (let c = 0; c < 3; c++) {
        expect(measured[c], `${layer} channel ${c}`).toBeCloseTo(pinned[c]!, 3);
      }
    }
  });

  it("still average to a target mean of 0.5 over RGB", async () => {
    // Each texture is normalised with one scalar gain until the mean over R,
    // G and B is 0.5. That is what makes LUMINANCE neutral; the per-channel
    // constants above are what make COLOUR neutral, and this asserts the
    // first has not drifted either.
    for (const file of Object.values(FILES)) {
      const [r, g, b] = await meanRgb(file);
      expect((r + g + b) / 3, file).toBeCloseTo(0.5, 2);
    }
  });

  it("are genuinely warm, so the per-channel divide is not a no-op", async () => {
    // If every layer were already neutral this whole mechanism would be dead
    // code that no test would catch. Grass and forest floor are the two that
    // carried the visible cast: red at least 15% above blue.
    for (const layer of ["grass", "floor"] as const) {
      const m = LAYER_MEAN_RGB[layer];
      expect(m[0] / m[2], layer).toBeGreaterThan(1.15);
    }
  });
});
