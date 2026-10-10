/**
 * The swell at a point: its height, its trochoidal displacement and slopes,
 * its envelope, its break and its white water, and how a headland shelters it.
 * Babylon-free (on BABYLON_FREE_FILES). The sea's shaders evaluate the same
 * maths from the same atlas (`shaders/oceanSurface.fx`: `oceanSwellSum`, and
 * `oceanFoamFromEnvelope` for the foam from its envelope); tests hold the two
 * in lockstep.
 *
 * Each component's phase is φ = Ψ(d, z) + k0x·coastlineX(z) + k0z·z + θ, Ψ
 * from the tables at the coast distance d = x − coastlineX(z) and θ =
 * phase0 − ωt the frame's phase (`swellPhases`): far out the plane wave
 * k0·x − ωt, near shore the crests turned to the contours. The bay's and the
 * cove's Ψ and kn blend by the phase weight wp (`OCEAN_PHASE_BLEND` wide), so
 * Ψ = Ψ_bay + (Ψ_cove − Ψ_bay)·wp(z), and the wavevector's z part carries what
 * that blend adds, (Ψ_cove − Ψ_bay)·dwp/dz, with the coastline's
 * (k0x − kn)·dcoastlineX/dz, so the slopes, the normal and the Q cap follow
 * the gradient of φ across the cove's ends as along the open coast. The depth, Weggel's a and b and the amplitude factor
 * blend by the cove's window wc instead. The local height before breaking is
 * twice the envelope |Σ A e^{iφ}| of the shoaled, refracted, sheltered
 * components, so it rises and falls with the sets; where it passes Weggel's
 * γ_b·h the wave has broken, and its components are scaled down to the bore's
 * OCEAN_BORE_RATIO·h over the transition to OCEAN_BREAK_FULL, h held at
 * OCEAN_DRY_DEPTH or more so the swell over dry sand is the shallowest
 * water's bore, a couple of centimetres. The white water
 * is a function of the crest's local phase: the roll on a broken crest's front,
 * the foam aged since the crest passed, the inner surf's floor.
 */
import { OCEAN_G, WEGGEL_GAMMA_MAX, WEGGEL_GAMMA_MIN } from "./oceanPhysics.js";
import {
  SWELL_COMPONENTS, SWELL_Q_SUM_MAX, swellComponents, swellStateFor, swellTravelDirection,
  type SwellComponent, type SwellState,
} from "./oceanSwell.js";
import {
  OCEAN_COAST_STEP, OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_DRY_DEPTH,
  OCEAN_ROW_BAY_FIRST, OCEAN_ROW_BAY_PROFILE, OCEAN_ROW_COAST, OCEAN_ROW_COMPONENTS,
  OCEAN_ROW_COVE_FIRST, OCEAN_ROW_COVE_PROFILE,
  buildOceanTables, coastProfilesFor, type OceanTables,
} from "./oceanTables.js";
import { coveFor } from "../sim/olympic.js";

/** A broken wave's height over its depth. */
export const OCEAN_BORE_RATIO = 0.42;
/** The ratio unbroken/(γ_b·h) at which the cap reaches the bore's. */
export const OCEAN_BREAK_FULL = 1.5;
/** The breaking intensity B = smoothstep(LO, HI, ratio). */
export const OCEAN_BREAK_FOAM_LO = 1.0;
export const OCEAN_BREAK_FOAM_HI = 1.3;
/** Seconds over which a broken crest's trailing foam thins. */
export const OCEAN_FOAM_LIFE = 20;
/** Radians of crest phase ahead of a broken crest that carry its roll. */
export const OCEAN_ROLL_WIDTH = 0.6;
/** The inner surf's foam floor under a broken wave. */
export const OCEAN_INNER_FOAM = 0.5;
/** What a headland's shadow leaves of the swell and of the wind sea, and the width (m) it fades in over. */
export const SHELTER_SWELL = 0.3;
export const SHELTER_CHOP = 0.15;
export const SHELTER_WIDTH = 40;

export type OceanField = {
  tables: OceanTables; components: SwellComponent[]; count: number; tp: number; hs: number;
  travel: [number, number]; tips: [number, number][];
};

export type SwellSample = {
  /** Displacement: up, and across (x, z). */
  height: number; dx: number; dz: number;
  /** The Gerstner normal's terms, unnormalised: (slopeX, normalY, slopeZ). */
  slopeX: number; slopeZ: number; normalY: number;
  depth: number; envelope: number; unbroken: number; ratio: number; broken: boolean; breaking: number;
  crestPhase: number; foamAge: number; foam: number;
  /** Σ Q·A, the most the surface moves across here, and Σ Q·|K|·A, held to SWELL_Q_SUM_MAX. */
  reach: number; steepness: number;
  /** The local wavelength (m): 2π over the length of the amplitude-weighted wavevector Σ A·K / Σ A, the deep
   * wavelength g·Tp²/2π where every amplitude is 0. */
  wavelength: number;
  /** The cap's scale on every component: 1 unbroken, falling to the bore's by `ratio` = OCEAN_BREAK_FULL. */
  scale: number;
};

export type Crest = {
  height: number; period: number; direction: [number, number]; phase: number; depth: number; slope: number;
  offshoreHeight: number; offshoreLength: number; broken: boolean; iribarren: number;
};

/**
 * A sample's scratch: made once by the caller (`swellScratch`), refilled by `swellAtInto`, so a caller that
 * samples every frame allocates nothing. After a call it holds that point's terms, one a component: `amp` the
 * amplitude before the cap (shoaled, refracted, sheltered), `kx`, `kz` the wavevector, `q` the steepness Q0,
 * `phase` the phase φ under the frame's phases; and the blended Weggel coefficients `weggelA`, `weggelB` the
 * break reads. Under all-zero phases `phase` is the part of φ that does not change with time.
 */
export type SwellScratch = {
  amp: Float64Array; kx: Float64Array; kz: Float64Array; q: Float64Array; phase: Float64Array;
  weggelA: number; weggelB: number;
  sample: SwellSample;
};

function makeScratch(n: number): SwellScratch {
  return {
    amp: new Float64Array(n), kx: new Float64Array(n), kz: new Float64Array(n), q: new Float64Array(n),
    phase: new Float64Array(n), weggelA: 0, weggelB: 0,
    sample: {
      height: 0, dx: 0, dz: 0, slopeX: 0, slopeZ: 0, normalY: 1, depth: 0, envelope: 0, unbroken: 0, ratio: 0,
      broken: false, breaking: 0, crestPhase: 0, foamAge: 0, foam: 0, reach: 0, steepness: 0, wavelength: 0, scale: 1,
    },
  };
}

/** A scratch for samples of `field`: long enough for any field's components. */
export function swellScratch(field: OceanField): SwellScratch {
  return makeScratch(Math.max(field.count, SWELL_COMPONENTS));
}

const TWO_PI = 2 * Math.PI;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mod(x: number, m: number): number {
  return x - m * Math.floor(x / m);
}

/** The ocean of a world: its swell, the tables about its cove, the travel direction and the headlands' tips. */
export function oceanFieldFor(seed: number, count: number = SWELL_COMPONENTS): OceanField {
  return oceanFieldFromState(seed, swellStateFor(seed), count);
}

/** The same with the sea state given: the world's coast under any swell. */
export function oceanFieldFromState(seed: number, state: SwellState, count: number = SWELL_COMPONENTS): OceanField {
  const components = swellComponents(seed, state);
  const profiles = coastProfilesFor(seed);
  const n = Math.min(Math.max(count, 0), components.length);
  return {
    tables: buildOceanTables(profiles, components, coveFor(seed).z0),
    components,
    count: n,
    tp: state.tp,
    hs: state.hs,
    travel: swellTravelDirection(components.slice(0, n)),
    tips: profiles.headlandTips,
  };
}

/** The frame's phases θ_c = (phase0 − ω·t) mod 2π, folded in double precision; zeros past the count. Written
 * into `out` (SWELL_COMPONENTS long) when one is given, as the renderer's binding is each frame, else into a new
 * array; either is returned. */
export function swellPhases(field: OceanField, seconds: number, out?: Float32Array): Float32Array {
  const phases = out ?? new Float32Array(SWELL_COMPONENTS);
  for (let c = 0; c < field.count; c++) {
    const comp = field.components[c] as SwellComponent;
    phases[c] = mod(comp.phase0 - comp.omega * seconds, TWO_PI);
  }
  phases.fill(0, field.count);
  return phases;
}

/**
 * One atlas row read at a fractional column, by hand: linear between the two
 * nearest texels, the column clamped to [0, width − 1]. The shaders read the
 * nearest-sampled texture at the same two texel centres, (i + 0.5)/width, and
 * mix by the same fraction, so the two agree texel centre for texel centre.
 */
export function atlasRead(tables: OceanTables, row: number, column: number): [number, number, number, number] {
  const c = Math.min(Math.max(column, 0), tables.width - 1);
  const i0 = Math.floor(c);
  const i1 = Math.min(i0 + 1, tables.width - 1);
  const f = c - i0;
  const o0 = (row * tables.width + i0) * 4;
  const o1 = (row * tables.width + i1) * 4;
  const d = tables.data;
  return [
    (d[o0] as number) + ((d[o1] as number) - (d[o0] as number)) * f,
    (d[o0 + 1] as number) + ((d[o1 + 1] as number) - (d[o0 + 1] as number)) * f,
    (d[o0 + 2] as number) + ((d[o1 + 2] as number) - (d[o0 + 2] as number)) * f,
    (d[o0 + 3] as number) + ((d[o1 + 3] as number) - (d[o0 + 3] as number)) * f,
  ];
}

/**
 * The coastline row at z: [coastlineX, its slope dx/dz, the cove's weight wc,
 * the phase weight wp, dwp/dz]. The first four are the linear read of the row's
 * four channels; dwp/dz is the difference of the two texels that read mixes
 * divided by OCEAN_COAST_STEP, the derivative of the linear read exactly (at a
 * texel's own z, the one to its +z side), and 0 where the read is clamped.
 */
export function coastRead(tables: OceanTables, z: number): [number, number, number, number, number] {
  const column = (z - tables.coastOriginZ) / OCEAN_COAST_STEP;
  const r = atlasRead(tables, OCEAN_ROW_COAST, column);
  const i0 = Math.floor(Math.min(Math.max(column, 0), tables.width - 1));
  const i1 = Math.min(i0 + 1, tables.width - 1);
  const row = OCEAN_ROW_COAST * tables.width;
  const here = tables.data[(row + i0) * 4 + 3] as number;
  const next = tables.data[(row + i1) * 4 + 3] as number;
  return [r[0], r[1], r[2], r[3], column < 0 ? 0 : (next - here) / OCEAN_COAST_STEP];
}

/**
 * What the headlands leave of a wave at (x, z): `keep` deep in a shadow, 1 out
 * of every shadow, the product over the tips. The swell travels along the
 * unit u (the field's travel). A tip T's shadow lies
 * - downstream of the tip: along = u·(P − T) ≥ 0;
 * - on the ridge's lee side, the side the travel's along-shore part points
 *   to: (P − T).z·side ≥ 0 with side = +1 when u.z ≥ 0, else −1 (the ridge
 *   runs along x at the tip's z, and on that line the ground is the ridge
 *   itself, so this edge falls on land);
 * - past the swell's line through the tip: λ = −cross(u, P − T)·side > 0,
 *   cross(u, r) = u.x·r.z − u.z·r.x, the distance into the shadow;
 * and the wave fades to `keep` over SHELTER_WIDTH m of λ. So under a swell
 * from south of the shore's normal (u.z > 0) the headland at the cove's −z
 * end shelters the cove behind it and the +z headland the open coast beyond
 * the cove; from north of it the other way round; square on, neither.
 */
export function shelterAt(field: OceanField, x: number, z: number, keep: number): number {
  const [ux, uz] = field.travel;
  const side = uz >= 0 ? 1 : -1;
  let factor = 1;
  for (const [tx, tz] of field.tips) {
    const rx = x - tx;
    const rz = z - tz;
    if (ux * rx + uz * rz < 0 || rz * side < 0) continue;
    const lambda = -(ux * rz - uz * rx) * side;
    factor *= 1 - (1 - keep) * smoothstep(0, SHELTER_WIDTH, lambda);
  }
  return factor;
}

/** One atlas row read at a fractional column into `out`: `atlasRead`'s arithmetic, with no array made. */
function readRow(tables: OceanTables, row: number, column: number, out: Float64Array): void {
  const c = Math.min(Math.max(column, 0), tables.width - 1);
  const i0 = Math.floor(c);
  const i1 = Math.min(i0 + 1, tables.width - 1);
  const f = c - i0;
  const o0 = (row * tables.width + i0) * 4;
  const o1 = (row * tables.width + i1) * 4;
  const d = tables.data;
  out[0] = (d[o0] as number) + ((d[o1] as number) - (d[o0] as number)) * f;
  out[1] = (d[o0 + 1] as number) + ((d[o1 + 1] as number) - (d[o0 + 1] as number)) * f;
  out[2] = (d[o0 + 2] as number) + ((d[o1 + 2] as number) - (d[o0 + 2] as number)) * f;
  out[3] = (d[o0 + 3] as number) + ((d[o1 + 3] as number) - (d[o0 + 3] as number)) * f;
}

/** `coastRead` into `out` (five long), with no array made. */
function coastReadInto(tables: OceanTables, z: number, out: Float64Array): void {
  const column = (z - tables.coastOriginZ) / OCEAN_COAST_STEP;
  readRow(tables, OCEAN_ROW_COAST, column, out);
  const i0 = Math.floor(Math.min(Math.max(column, 0), tables.width - 1));
  const i1 = Math.min(i0 + 1, tables.width - 1);
  const row = OCEAN_ROW_COAST * tables.width;
  const here = tables.data[(row + i0) * 4 + 3] as number;
  const next = tables.data[(row + i1) * 4 + 3] as number;
  out[4] = column < 0 ? 0 : (next - here) / OCEAN_COAST_STEP;
}

/**
 * The break at a point: the ratio unbroken/(γ_b·h) and the cap's scale on every component, h held at
 * OCEAN_DRY_DEPTH or more and γ_b Weggel's index from the blended coefficients a and b, clamped to
 * [WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX]. Written into `out`.
 */
export function swellBreakInto(
  unbroken: number, depth: number, a: number, b: number, tp: number, out: { ratio: number; scale: number },
): void {
  // The break on the depth held at OCEAN_DRY_DEPTH or more: over dry sand the
  // swell is capped as in the shallowest water, so it falls to the bore's
  // couple of centimetres and meets the waterline without a step.
  const hc = Math.max(depth, OCEAN_DRY_DEPTH);
  const gamma = Math.min(WEGGEL_GAMMA_MAX, Math.max(WEGGEL_GAMMA_MIN, b - (a * unbroken) / (OCEAN_G * tp * tp)));
  const ratio = unbroken / (gamma * hc);
  let scale = 1;
  if (ratio > 1) {
    const cap = gamma + (OCEAN_BORE_RATIO - gamma) * smoothstep(1, OCEAN_BREAK_FULL, ratio);
    scale = (hc * cap) / unbroken;
  }
  out.ratio = ratio;
  out.scale = scale;
}

/** The reads one evaluation needs, made once. */
const COAST = new Float64Array(5);
const BAY = new Float64Array(4);
const COVE = new Float64Array(4);
const COMP_K = new Float64Array(4);
const COMP_Q = new Float64Array(4);
const ROW_BAY = new Float64Array(4);
const ROW_COVE = new Float64Array(4);
const BREAK = { ratio: 0, scale: 1 };
/** What `crestAt` reads of the last evaluation beyond its sample. */
const EXTRA = { offshore: 0, dirX: 1, dirZ: 0, wc: 0, column: 0 };

function evaluateInto(field: OceanField, phases: Float32Array, x: number, z: number, scratch: SwellScratch): SwellSample {
  const t = field.tables;
  coastReadInto(t, z, COAST);
  const cx = COAST[0] as number;
  const cdz = COAST[1] as number;
  const wc = COAST[2] as number;
  const wp = COAST[3] as number;
  const wpDz = COAST[4] as number;
  const d = x - cx;
  const column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
  const deep = Math.min(d - OCEAN_D_MIN, 0);
  readRow(t, OCEAN_ROW_BAY_PROFILE, column, BAY);
  readRow(t, OCEAN_ROW_COVE_PROFILE, column, COVE);
  const h = (BAY[0] as number) + ((COVE[0] as number) - (BAY[0] as number)) * wc;
  const a = (BAY[1] as number) + ((COVE[1] as number) - (BAY[1] as number)) * wc;
  const b = (BAY[2] as number) + ((COVE[2] as number) - (BAY[2] as number)) * wc;
  const shelter = shelterAt(field, x, z, SHELTER_SWELL);

  const n = field.count;
  const phi = scratch.phase;
  const amp = scratch.amp;
  const q0 = scratch.q;
  const kx = scratch.kx;
  const kz = scratch.kz;
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  for (let c = 0; c < n; c++) {
    readRow(t, OCEAN_ROW_COMPONENTS, 2 * c, COMP_K);
    readRow(t, OCEAN_ROW_COMPONENTS, 2 * c + 1, COMP_Q);
    readRow(t, OCEAN_ROW_BAY_FIRST + c, column, ROW_BAY);
    readRow(t, OCEAN_ROW_COVE_FIRST + c, column, ROW_COVE);
    const k0x = COMP_K[0] as number;
    const k0z = COMP_K[1] as number;
    const a0 = COMP_K[3] as number;
    const dPsi = (ROW_COVE[0] as number) - (ROW_BAY[0] as number);
    const psi = (ROW_BAY[0] as number) + dPsi * wp + k0x * deep;
    const kn = (ROW_BAY[1] as number) + ((ROW_COVE[1] as number) - (ROW_BAY[1] as number)) * wp;
    const K = (ROW_BAY[2] as number) + ((ROW_COVE[2] as number) - (ROW_BAY[2] as number)) * wc;
    const p = psi + k0x * cx + k0z * z + (phases[c] as number);
    phi[c] = p;
    kx[c] = kn;
    kz[c] = k0z + (k0x - kn) * cdz + dPsi * wpDz;
    const A = a0 * K * shelter;
    amp[c] = A;
    q0[c] = COMP_Q[0] as number;
    sx += A * Math.cos(p);
    sy += A * Math.sin(p);
    ox += a0 * Math.cos(p);
    oy += a0 * Math.sin(p);
  }
  const envelope = Math.hypot(sx, sy);
  const unbroken = 2 * envelope;
  const crestPhase = Math.atan2(sy, sx);
  swellBreakInto(unbroken, h, a, b, field.tp, BREAK);
  const ratio = BREAK.ratio;
  const scale = BREAK.scale;
  const breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);

  // The capped amplitude is amp·scale wherever it is read: the scratch keeps the amplitude before the cap.
  let steepness = 0;
  for (let c = 0; c < n; c++) {
    steepness += (q0[c] as number) * Math.hypot(kx[c] as number, kz[c] as number) * ((amp[c] as number) * scale);
  }
  const s = steepness > SWELL_Q_SUM_MAX ? SWELL_Q_SUM_MAX / steepness : 1;

  let height = 0;
  let dx = 0;
  let dz = 0;
  let slopeX = 0;
  let slopeZ = 0;
  let fold = 0;
  let reach = 0;
  let wx = 0;
  let wz = 0;
  let sumA = 0;
  let kwx = 0;
  let kwz = 0;
  for (let c = 0; c < n; c++) {
    const A = (amp[c] as number) * scale;
    const Q = (q0[c] as number) * s;
    const Kx = kx[c] as number;
    const Kz = kz[c] as number;
    const kmag = Math.hypot(Kx, Kz);
    const sin = Math.sin(phi[c] as number);
    const cos = Math.cos(phi[c] as number);
    height += A * cos;
    dx -= (Q * A * Kx * sin) / kmag;
    dz -= (Q * A * Kz * sin) / kmag;
    slopeX += A * Kx * sin;
    slopeZ += A * Kz * sin;
    fold += Q * A * kmag * cos;
    reach += Q * A;
    wx += (A * A * Kx) / kmag;
    wz += (A * A * Kz) / kmag;
    sumA += A;
    kwx += A * Kx;
    kwz += A * Kz;
  }
  const foamAge = mod(-crestPhase, TWO_PI) / (TWO_PI / field.tp);
  const roll = breaking * (1 - smoothstep(0, OCEAN_ROLL_WIDTH, mod(crestPhase, TWO_PI)));
  const trailing = breaking * Math.exp(-foamAge / OCEAN_FOAM_LIFE);
  const wl = Math.hypot(wx, wz);
  const km = Math.hypot(kwx, kwz) / sumA;

  scratch.weggelA = a;
  scratch.weggelB = b;
  const out = scratch.sample;
  out.height = height;
  out.dx = dx;
  out.dz = dz;
  out.slopeX = slopeX;
  out.slopeZ = slopeZ;
  out.normalY = 1 - fold;
  out.depth = h;
  out.envelope = envelope;
  out.unbroken = unbroken;
  out.ratio = ratio;
  out.broken = ratio > 1;
  out.breaking = breaking;
  out.crestPhase = crestPhase;
  out.foamAge = foamAge;
  out.foam = Math.max(roll, trailing, breaking * OCEAN_INNER_FOAM);
  out.reach = reach;
  out.steepness = steepness * s;
  out.wavelength = km > 0 ? TWO_PI / km : (OCEAN_G * field.tp * field.tp) / TWO_PI;
  out.scale = scale;

  EXTRA.offshore = 2 * Math.hypot(ox, oy);
  EXTRA.dirX = wl > 0 ? wx / wl : 1;
  EXTRA.dirZ = wl > 0 ? wz / wl : 0;
  EXTRA.wc = wc;
  EXTRA.column = column;
  return out;
}

/** The scratch `swellAt`, `crestAt` and `boreArrivals` sample through. */
const SCRATCH = makeScratch(SWELL_COMPONENTS);

/**
 * `swellAt` without allocation: the swell at (x, z) under the frame's phases, written into `scratch.sample`
 * (and the point's terms into the scratch's arrays), which is returned. The same numbers as `swellAt`.
 */
export function swellAtInto(
  field: OceanField, phases: Float32Array, x: number, z: number, scratch: SwellScratch,
): SwellSample {
  return evaluateInto(field, phases, x, z, scratch);
}

/** The sample at a point and its cap's scale, through the module's scratch: read at once, the next call overwrites it. */
function evaluate(field: OceanField, phases: Float32Array, x: number, z: number): { sample: SwellSample; scale: number } {
  const sample = evaluateInto(field, phases, x, z, SCRATCH);
  return { sample, scale: sample.scale };
}

/**
 * The swell at the undisplaced point (x, z) under the frame's phases. Its slopes
 * are the gradient of the phase the evaluation sums: −∂height/∂x = Σ A·kn·sin φ
 * and −∂height/∂z = Σ A·Kv.z·sin φ, Kv.z carrying the coastline's turn and the
 * phase weight's change along z.
 */
export function swellAt(field: OceanField, phases: Float32Array, x: number, z: number): SwellSample {
  return { ...evaluateInto(field, phases, x, z, SCRATCH) };
}

/** The unit normal of a sample's Gerstner terms. */
export function swellNormal(s: SwellSample): [number, number, number] {
  const len = Math.hypot(s.slopeX, s.normalY, s.slopeZ);
  return [s.slopeX / len, s.normalY / len, s.slopeZ / len];
}

/**
 * The crest at a shore point, for the breaker: its local height (shoaled,
 * refracted, sheltered, capped where broken), the peak period, the direction
 * it travels and its phase, the depth and bed slope, the height the same
 * group has offshore (twice its envelope at deep amplitudes) and the deep
 * wavelength g·T²/2π, whether it has broken, and the Iribarren number
 * slope/√(H0/L0).
 */
export function crestAt(field: OceanField, phases: Float32Array, x: number, z: number): Crest {
  const sample = evaluateInto(field, phases, x, z, SCRATCH);
  const { offshore, dirX, dirZ, wc, column } = EXTRA;
  const t = field.tables;
  const depthAt = (col: number): number => {
    const bay = atlasRead(t, OCEAN_ROW_BAY_PROFILE, col)[0];
    const cove = atlasRead(t, OCEAN_ROW_COVE_PROFILE, col)[0];
    return bay + (cove - bay) * wc;
  };
  const slope = Math.abs(depthAt(column - 1) - depthAt(column + 1)) / (2 * OCEAN_D_STEP);
  const offshoreLength = (OCEAN_G * field.tp * field.tp) / TWO_PI;
  return {
    height: sample.unbroken * sample.scale,
    period: field.tp,
    direction: [dirX, dirZ],
    phase: sample.crestPhase,
    depth: sample.depth,
    slope,
    offshoreHeight: offshore,
    offshoreLength,
    broken: sample.broken,
    iribarren: slope / Math.sqrt(Math.max(offshore, 1e-6) / offshoreLength),
  };
}

/**
 * The times in [from, to) a broken crest passes (x, z), and its height there:
 * for swash at the face's toe. Sampled every `step` s; a crest passes where
 * the crest phase, falling with time, wraps through 0, the time found by
 * linear interpolation between the two samples either side.
 */
export function boreArrivals(
  field: OceanField, x: number, z: number, from: number, to: number, step: number,
): { t: number; height: number }[] {
  const out: { t: number; height: number }[] = [];
  let prev: { t: number; q: number; broken: boolean; height: number } | null = null;
  for (let i = 0; from + i * step < to; i++) {
    const t = from + i * step;
    const e = evaluate(field, swellPhases(field, t), x, z);
    const here = { t, q: mod(e.sample.crestPhase, TWO_PI), broken: e.sample.broken, height: e.sample.unbroken * e.scale };
    if (prev !== null && here.q - prev.q > Math.PI && (prev.broken || here.broken)) {
      const f = prev.q / (prev.q + TWO_PI - here.q);
      out.push({ t: prev.t + f * step, height: Math.max(prev.height, here.height) });
    }
    prev = here;
  }
  return out;
}
