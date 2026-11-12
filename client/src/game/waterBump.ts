/**
 * The water's ripple bump as data: a 256² normal map from `fbm2` finite
 * differences, RGBA. A constant: no world's seed enters it. Babylon-free, so
 * the world's worker can make it ahead of the build (`preparedScene.ts`);
 * the renderer makes the texture (`createWaterBump`).
 */
import { fbm2 } from "../sim/field.js";

/** The bump's side, texels. */
export const WATER_BUMP_SIZE = 256;

/** The picture, `WATER_BUMP_SIZE`² RGBA bytes: a new array each call. */
export function waterBumpData(): Uint8Array {
  const size = WATER_BUMP_SIZE;
  const data = new Uint8Array(size * size * 4);
  const f = 12 / size; // ~12 ripples per WATER_UV_SCALE tile
  const amp = 2.5;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const h0 = fbm2(x * f, z * f, 0x77aa, 3);
      const nx = (fbm2((x + 1) * f, z * f, 0x77aa, 3) - h0) * amp * size * f;
      const nz = (fbm2(x * f, (z + 1) * f, 0x77aa, 3) - h0) * amp * size * f;
      const inv = 1 / Math.hypot(nx, nz, 1);
      const at = (z * size + x) * 4;
      data[at] = Math.round((-nx * inv * 0.5 + 0.5) * 255);
      data[at + 1] = Math.round((-nz * inv * 0.5 + 0.5) * 255);
      data[at + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[at + 3] = 255;
    }
  }
  return data;
}
