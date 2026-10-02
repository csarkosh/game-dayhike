/**
 * The coast the swell meets, and the tables it is evaluated from. Babylon-free
 * (on BABYLON_FREE_FILES); the atlas texture is made from `OceanTables.data`
 * elsewhere, and the shaders read it exactly as `oceanWaves.ts` does.
 *
 * Across each bay and across the cove's middle the bed is a function of the
 * signed coast distance d = x − coastlineX(z) alone (negative at sea): the
 * terrain's `shoreProfileD` and `coveProfileD`, blended across the cove's ends
 * by its along-shore window. So a component's phase is integrated once along d
 * for each profile, Ψ(d) = ∫ kn, with kn the onshore wavenumber Snell's law
 * leaves it at each depth; far out Ψ is the plane wave's k0x·d. Past the shelf
 * break the tables take deep water (`deepWeight`), so the open swell is as long
 * as the real coast's rather than the 25 m floor's. The two profiles' phases
 * differ by tens of radians near shore (the cove is deeper, so a crest runs
 * ahead of the bay's), and a crest cannot change its phase by that over the
 * cove's 60 m end blend: the phase passes from the bay's to the cove's over the
 * wider OCEAN_PHASE_BLEND, by its own weight (`phaseWeight`).
 *
 * The atlas (RGBA32F, OCEAN_TABLE_SAMPLES wide, OCEAN_ATLAS_ROWS tall), column
 * i at d_i = OCEAN_D_MIN + i·OCEAN_D_STEP:
 * - rows 0 and 1, the bay's and the cove's profile: depth (positive at sea,
 *   negative on land), Weggel's a and b for the local slope, deepWeight;
 * - rows 2..13 (bay) and 14..25 (cove), one a component: Ψ, kn, the amplitude
 *   factor K_s·K_r (blended to 1 in deep water), 0; landward of the last wet
 *   sample each holds that sample's values;
 * - row 26, the components: texel 2c (k0x, k0z, ω, a0), texel 2c + 1 (q0, 0, 0, 0);
 * - row 27, the coastline along z from coastOriginZ every OCEAN_COAST_STEP:
 *   coastlineX, its slope dx/dz, the cove's weight (depth, Weggel's a and b and
 *   the amplitude factor blend by it), the phase weight (Ψ and kn blend by it).
 */
import {
  COVE_END_BLEND, SHELF_BREAK_DEPTH, SHELF_BREAK_WIDTH, coveFor, coveProfileD, shoreProfileD,
} from "../sim/olympic.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import { refraction, shoalingFactor, waveNumber, weggelCoefficients } from "./oceanPhysics.js";
import { SWELL_COMPONENTS, type SwellComponent } from "./oceanSwell.js";

export const OCEAN_D_MIN = -1000;
export const OCEAN_D_STEP = 1;
export const OCEAN_TABLE_SAMPLES = 1040;
/** The coastline row: OCEAN_COAST_SAMPLES texels, OCEAN_COAST_STEP m apart along z (4,160 m). */
export const OCEAN_COAST_STEP = 4;
export const OCEAN_COAST_SAMPLES = 1040;
/** The coastline row is recentred when the camera is this far (m) from its centre. */
export const OCEAN_COAST_RECENTRE = 1000;
export const OCEAN_ATLAS_ROWS = 28;
export const OCEAN_ROW_BAY_PROFILE = 0;
export const OCEAN_ROW_COVE_PROFILE = 1;
export const OCEAN_ROW_BAY_FIRST = 2;
export const OCEAN_ROW_COVE_FIRST = 14;
export const OCEAN_ROW_COMPONENTS = 26;
export const OCEAN_ROW_COAST = 27;
/**
 * The along-shore span (m) over which a crest's phase passes from the bay's to
 * the cove's: about the scale over which refraction smooths a crest built over a
 * few hundred metres. The phase weight falls from 1 to 0 across the cove's end
 * widened by this on each side, where the depth, a, b and the amplitude factor
 * blend across it widened by COVE_END_BLEND.
 */
export const OCEAN_PHASE_BLEND = 250;
/** At or below this depth (m) a sample is dry: the phase rows hold, the break is off. */
export const OCEAN_DRY_DEPTH = 0.05;
/** Sub-intervals of Simpson's rule in each table step of the phase integral. */
export const OCEAN_PHASE_SUBSTEPS = 4;

export type CoastProfiles = {
  /** From `shoreProfileD`: depth = −v (positive at sea), slope = |dv/dd|. */
  bayDepth(d: number): { depth: number; slope: number };
  /** From `coveProfileD`, likewise. */
  coveDepth(d: number): { depth: number; slope: number };
  /** 1 − smootherstep(halfWidth − COVE_END_BLEND, halfWidth + COVE_END_BLEND, |z − z0|): the sim's along-shore window. */
  coveWeight(z: number): number;
  /** 1 − smootherstep(halfWidth − OCEAN_PHASE_BLEND, halfWidth + OCEAN_PHASE_BLEND, |z − z0|): the weight of the cove's phase against the bay's. */
  phaseWeight(z: number): number;
  /** x − coastDistance(seed, x, z), the same for any x. */
  coastlineX(z: number): number;
  /** Where each profile reaches SHELF_BREAK_DEPTH. */
  shelfBreakD: { bay: number; cove: number };
  /** (x, z) of each headland's seaward tip. */
  headlandTips: [number, number][];
};

export type OceanTables = { data: Float32Array; width: number; rows: number; coastOriginZ: number };

/** Quintic smootherstep, the sim's `smootherstepD` value. */
function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The d (m) at which a monotone profile reaches `depth`, by bisection over [OCEAN_D_MIN, 0]. */
function depthCrossing(profile: (d: number) => { depth: number }, depth: number): number {
  let lo = OCEAN_D_MIN;
  let hi = 0;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (profile(mid).depth > depth) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** The world's coast as the swell sees it: the two profiles, the cove's window, the coastline and the headlands' tips. */
export function coastProfilesFor(seed: number): CoastProfiles {
  const variant = activeTerrainVariant();
  const coastDistance = variant.coastDistance;
  if (coastDistance === undefined) throw new Error(`terrain variant "${variant.name}" has no coast`);
  const cove = coveFor(seed);
  const bayDepth = (d: number): { depth: number; slope: number } => {
    const p = shoreProfileD(d);
    return { depth: -p.v, slope: Math.abs(p.dd) };
  };
  const coveDepth = (d: number): { depth: number; slope: number } => {
    const p = coveProfileD(d);
    return { depth: -p.v, slope: Math.abs(p.dd) };
  };
  const coastlineX = (z: number): number => -coastDistance(seed, 0, z);
  return {
    bayDepth,
    coveDepth,
    coveWeight: (z) =>
      1 - smootherstep(cove.halfWidth - COVE_END_BLEND, cove.halfWidth + COVE_END_BLEND, Math.abs(z - cove.z0)),
    phaseWeight: (z) =>
      1 - smootherstep(cove.halfWidth - OCEAN_PHASE_BLEND, cove.halfWidth + OCEAN_PHASE_BLEND, Math.abs(z - cove.z0)),
    coastlineX,
    shelfBreakD: { bay: depthCrossing(bayDepth, SHELF_BREAK_DEPTH), cove: depthCrossing(coveDepth, SHELF_BREAK_DEPTH) },
    headlandTips: cove.heads.map((h): [number, number] => [coastlineX(h.z) - h.reach, h.z]),
  };
}

/** 0 at the shelf break and shoreward, 1 at shelfBreakD − SHELF_BREAK_WIDTH and seaward, smootherstep between. */
export function deepWeight(d: number, shelfBreakD: number): number {
  return smootherstep(shelfBreakD, shelfBreakD - SHELF_BREAK_WIDTH, d);
}

/** One component's onshore wavenumber and amplitude factor at d over one profile. */
function waveAt(
  c: SwellComponent, k0: number, depth: (d: number) => { depth: number }, shelfBreakD: number, d: number,
): { kn: number; amp: number } {
  const w = deepWeight(d, shelfBreakD);
  if (w === 1) return { kn: c.k0x, amp: 1 };
  const h = Math.max(depth(d).depth, OCEAN_DRY_DEPTH);
  const r = refraction(k0, c.k0z, (1 - w) * waveNumber(c.omega, h) + w * k0);
  return { kn: r.kn, amp: ((1 - w) * shoalingFactor(c.omega, h) + w) * r.kr };
}

function writeProfileRow(
  data: Float32Array, width: number, row: number, depth: (d: number) => { depth: number; slope: number }, shelfBreakD: number,
): void {
  for (let i = 0; i < width; i++) {
    const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
    const p = depth(d);
    const wg = weggelCoefficients(p.slope);
    const o = (row * width + i) * 4;
    data[o] = p.depth;
    data[o + 1] = wg.a;
    data[o + 2] = wg.b;
    data[o + 3] = deepWeight(d, shelfBreakD);
  }
}

/** Ψ, kn and K for one component over one profile. Ψ is the plane wave's k0x·d
 * while the sample is in deep water, then integrated step by step by Simpson's
 * rule; landward of the last wet sample all three hold. */
function writePhaseRow(
  data: Float32Array, width: number, row: number, c: SwellComponent,
  depth: (d: number) => { depth: number }, shelfBreakD: number,
): void {
  const k0 = Math.hypot(c.k0x, c.k0z);
  const sub = OCEAN_D_STEP / OCEAN_PHASE_SUBSTEPS;
  let psi = 0;
  let kn = c.k0x;
  let amp = 1;
  let wet = true;
  for (let i = 0; i < width; i++) {
    const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
    if (wet && depth(d).depth <= OCEAN_DRY_DEPTH) wet = false;
    if (wet) {
      const here = waveAt(c, k0, depth, shelfBreakD, d);
      if (deepWeight(d, shelfBreakD) === 1) {
        psi = c.k0x * d;
      } else {
        let sum = kn + here.kn;
        for (let j = 1; j < OCEAN_PHASE_SUBSTEPS; j++) {
          sum += (j % 2 === 1 ? 4 : 2) * waveAt(c, k0, depth, shelfBreakD, d - OCEAN_D_STEP + j * sub).kn;
        }
        psi += (sum * sub) / 3;
      }
      kn = here.kn;
      amp = here.amp;
    }
    const o = (row * width + i) * 4;
    data[o] = psi;
    data[o + 1] = kn;
    data[o + 2] = amp;
    data[o + 3] = 0;
  }
}

/** The atlas's data: the profiles, each component's phase rows, the components and the coastline row about coastCentreZ.
 * The profile rows carry Weggel's a and b; the breaker index combines them with the local height and the swell's peak
 * period where the swell is evaluated, so no period is read here. */
export function buildOceanTables(
  profiles: CoastProfiles, components: readonly SwellComponent[], coastCentreZ: number,
): OceanTables {
  const width = OCEAN_TABLE_SAMPLES;
  const data = new Float32Array(width * OCEAN_ATLAS_ROWS * 4);
  const tables: OceanTables = { data, width, rows: OCEAN_ATLAS_ROWS, coastOriginZ: 0 };
  writeProfileRow(data, width, OCEAN_ROW_BAY_PROFILE, profiles.bayDepth, profiles.shelfBreakD.bay);
  writeProfileRow(data, width, OCEAN_ROW_COVE_PROFILE, profiles.coveDepth, profiles.shelfBreakD.cove);
  const count = Math.min(components.length, SWELL_COMPONENTS);
  for (let c = 0; c < count; c++) {
    const comp = components[c] as SwellComponent;
    writePhaseRow(data, width, OCEAN_ROW_BAY_FIRST + c, comp, profiles.bayDepth, profiles.shelfBreakD.bay);
    writePhaseRow(data, width, OCEAN_ROW_COVE_FIRST + c, comp, profiles.coveDepth, profiles.shelfBreakD.cove);
    const o = (OCEAN_ROW_COMPONENTS * width + 2 * c) * 4;
    data[o] = comp.k0x;
    data[o + 1] = comp.k0z;
    data[o + 2] = comp.omega;
    data[o + 3] = comp.a0;
    data[o + 4] = comp.q0;
  }
  writeCoastRow(tables, profiles, coastCentreZ);
  return tables;
}

/** Refills the coastline row (only) about coastCentreZ, and its origin: a recentre. */
export function writeCoastRow(tables: OceanTables, profiles: CoastProfiles, coastCentreZ: number): void {
  const origin =
    Math.round(coastCentreZ / OCEAN_COAST_STEP) * OCEAN_COAST_STEP - (OCEAN_COAST_SAMPLES / 2) * OCEAN_COAST_STEP;
  tables.coastOriginZ = origin;
  let before = profiles.coastlineX(origin - OCEAN_COAST_STEP);
  let here = profiles.coastlineX(origin);
  for (let j = 0; j < OCEAN_COAST_SAMPLES; j++) {
    const z = origin + j * OCEAN_COAST_STEP;
    const after = profiles.coastlineX(z + OCEAN_COAST_STEP);
    const o = (OCEAN_ROW_COAST * tables.width + j) * 4;
    tables.data[o] = here;
    tables.data[o + 1] = (after - before) / (2 * OCEAN_COAST_STEP);
    tables.data[o + 2] = profiles.coveWeight(z);
    tables.data[o + 3] = profiles.phaseWeight(z);
    before = here;
    here = after;
  }
}
