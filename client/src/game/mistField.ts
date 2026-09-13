import { hash2, hash3 } from "../sim/field.js";
import { elevationSampleAt } from "../sim/terrain.js";

/**
 * Jittered-grid placement of valley mist banks, in the forestField discipline:
 * pure, Babylon-free, deterministic per (seed, cell). Presentation only — sits
 * in game/, reads sim/, never feeds back into it.
 *
 * No memoizing collector on purpose: one collection scans ~pi x 10^2 = 314
 * cells, three orders of magnitude below the forest's 112k-cell disc that
 * needed one. Revisit only if MIST_RADIUS grows past ~3 km.
 */
export const MIST_CELL = 96;
export const MIST_RADIUS = 960;
export const MIST_CAP = 12;
export const MIST_ALT_MIN = 2;
export const MIST_ALT_MAX = 60;
export const MIST_SLOPE_MAX = 0.35;
export const MIST_DENSITY = 0.35;
export const MIST_SALT = 0x4d495354; // "MIST"
export const MIST_WIDTH_MIN = 60;
export const MIST_WIDTH_MAX = 110;
export const MIST_HEIGHT_MIN = 18;
export const MIST_HEIGHT_MAX = 30;
/** Fraction of the cell the bank centre may wander from the cell centre. */
export const MIST_JITTER = 0.6;
export const MIST_TEX_SIZE = 128;

export type MistBank = {
  x: number;
  z: number;
  /** Quad centre height: ground plus a fraction of the bank height. */
  y: number;
  width: number;
  height: number;
  hash: number;
};

export function mistBankInCell(seed: number, cx: number, cz: number): MistBank | null {
  const s = seed ^ MIST_SALT;
  if (hash2(cx, cz, s) >= MIST_DENSITY) return null;
  const x = (cx + 0.5 + (hash3(cx, cz, 1, s) - 0.5) * MIST_JITTER) * MIST_CELL;
  const z = (cz + 0.5 + (hash3(cx, cz, 2, s) - 0.5) * MIST_JITTER) * MIST_CELL;
  const g = elevationSampleAt(seed, x, z);
  if (g.h < MIST_ALT_MIN || g.h > MIST_ALT_MAX) return null;
  if (g.dx * g.dx + g.dz * g.dz > MIST_SLOPE_MAX * MIST_SLOPE_MAX) return null;
  const width = MIST_WIDTH_MIN + (MIST_WIDTH_MAX - MIST_WIDTH_MIN) * hash3(cx, cz, 3, s);
  const height = MIST_HEIGHT_MIN + (MIST_HEIGHT_MAX - MIST_HEIGHT_MIN) * hash3(cx, cz, 4, s);
  return { x, z, y: g.h + height * 0.35, width, height, hash: hash3(cx, cz, 5, s) };
}

/** Banks within MIST_RADIUS of the camera, nearest first, at most MIST_CAP. */
export function collectMistBanks(seed: number, camX: number, camZ: number): MistBank[] {
  const c0x = Math.floor((camX - MIST_RADIUS) / MIST_CELL);
  const c1x = Math.floor((camX + MIST_RADIUS) / MIST_CELL);
  const c0z = Math.floor((camZ - MIST_RADIUS) / MIST_CELL);
  const c1z = Math.floor((camZ + MIST_RADIUS) / MIST_CELL);
  const r2 = MIST_RADIUS * MIST_RADIUS;
  const found: { bank: MistBank; d2: number }[] = [];
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const bank = mistBankInCell(seed, cx, cz);
      if (bank === null) continue;
      const d2 = (bank.x - camX) * (bank.x - camX) + (bank.z - camZ) * (bank.z - camZ);
      if (d2 <= r2) found.push({ bank, d2 });
    }
  }
  // Distance ties are all but impossible under jitter; the hash tie-break keeps
  // the order deterministic anyway.
  found.sort((a, b) => a.d2 - b.d2 || a.bank.hash - b.bank.hash);
  return found.slice(0, MIST_CAP).map((f) => f.bank);
}

/**
 * RGBA radial falloff sprite: white RGB, alpha (1-r^2)^2. Computed in plain
 * arithmetic so the shell can build a RawTexture headlessly — a DynamicTexture
 * needs a 2D canvas, which NullEngine test runs do not have.
 */
export function mistAlphaMap(size: number = MIST_TEX_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const r2 = nx * nx + ny * ny;
      const a = r2 >= 1 ? 0 : (1 - r2) * (1 - r2);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return data;
}
