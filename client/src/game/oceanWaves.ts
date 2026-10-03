/**
 * The swell at a point: its height, its trochoidal displacement and slopes,
 * its envelope, its break and its white water, and how a headland shelters it.
 * Babylon-free (on BABYLON_FREE_FILES). The sea's shaders evaluate the same
 * maths from the same atlas (`shaders/oceanSurface.fx`: `oceanSwellSum`,
 * `oceanSwellEval`); tests hold the two in lockstep.
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
};

export type Crest = {
  height: number; period: number; direction: [number, number]; phase: number; depth: number; slope: number;
  offshoreHeight: number; offshoreLength: number; broken: boolean; iribarren: number;
};

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

type Evaluation = {
  sample: SwellSample; scale: number; offshore: number; direction: [number, number]; wc: number; column: number;
};

function evaluate(field: OceanField, phases: Float32Array, x: number, z: number): Evaluation {
  const t = field.tables;
  const [cx, cdz, wc, wp, wpDz] = coastRead(t, z);
  const d = x - cx;
  const column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
  const deep = Math.min(d - OCEAN_D_MIN, 0);
  const bay = atlasRead(t, OCEAN_ROW_BAY_PROFILE, column);
  const cove = atlasRead(t, OCEAN_ROW_COVE_PROFILE, column);
  const h = bay[0] + (cove[0] - bay[0]) * wc;
  const a = bay[1] + (cove[1] - bay[1]) * wc;
  const b = bay[2] + (cove[2] - bay[2]) * wc;
  const shelter = shelterAt(field, x, z, SHELTER_SWELL);

  const n = field.count;
  const phi = new Float64Array(n);
  const amp = new Float64Array(n);
  const q0 = new Float64Array(n);
  const kx = new Float64Array(n);
  const kz = new Float64Array(n);
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  for (let c = 0; c < n; c++) {
    const k = atlasRead(t, OCEAN_ROW_COMPONENTS, 2 * c);
    const q = atlasRead(t, OCEAN_ROW_COMPONENTS, 2 * c + 1);
    const rb = atlasRead(t, OCEAN_ROW_BAY_FIRST + c, column);
    const rc = atlasRead(t, OCEAN_ROW_COVE_FIRST + c, column);
    const k0x = k[0];
    const k0z = k[1];
    const dPsi = rc[0] - rb[0];
    const psi = rb[0] + dPsi * wp + k0x * deep;
    const kn = rb[1] + (rc[1] - rb[1]) * wp;
    const K = rb[2] + (rc[2] - rb[2]) * wc;
    const p = psi + k0x * cx + k0z * z + (phases[c] as number);
    phi[c] = p;
    kx[c] = kn;
    kz[c] = k0z + (k0x - kn) * cdz + dPsi * wpDz;
    const A = k[3] * K * shelter;
    amp[c] = A;
    q0[c] = q[0];
    sx += A * Math.cos(p);
    sy += A * Math.sin(p);
    ox += k[3] * Math.cos(p);
    oy += k[3] * Math.sin(p);
  }
  const envelope = Math.hypot(sx, sy);
  const unbroken = 2 * envelope;
  const crestPhase = Math.atan2(sy, sx);

  // The break on the depth held at OCEAN_DRY_DEPTH or more: over dry sand the
  // swell is capped as in the shallowest water, so it falls to the bore's
  // couple of centimetres and meets the waterline without a step.
  const hc = Math.max(h, OCEAN_DRY_DEPTH);
  const gamma = Math.min(WEGGEL_GAMMA_MAX, Math.max(WEGGEL_GAMMA_MIN, b - (a * unbroken) / (OCEAN_G * field.tp * field.tp)));
  const ratio = unbroken / (gamma * hc);
  let scale = 1;
  if (ratio > 1) {
    const cap = gamma + (OCEAN_BORE_RATIO - gamma) * smoothstep(1, OCEAN_BREAK_FULL, ratio);
    scale = (hc * cap) / unbroken;
  }
  const breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);

  let steepness = 0;
  for (let c = 0; c < n; c++) {
    amp[c] = (amp[c] as number) * scale;
    steepness += (q0[c] as number) * Math.hypot(kx[c] as number, kz[c] as number) * (amp[c] as number);
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
  for (let c = 0; c < n; c++) {
    const A = amp[c] as number;
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
  }
  const foamAge = mod(-crestPhase, TWO_PI) / (TWO_PI / field.tp);
  const roll = breaking * (1 - smoothstep(0, OCEAN_ROLL_WIDTH, mod(crestPhase, TWO_PI)));
  const trailing = breaking * Math.exp(-foamAge / OCEAN_FOAM_LIFE);
  const wl = Math.hypot(wx, wz);
  return {
    sample: {
      height, dx, dz, slopeX, slopeZ, normalY: 1 - fold,
      depth: h, envelope, unbroken, ratio, broken: ratio > 1, breaking,
      crestPhase, foamAge, foam: Math.max(roll, trailing, breaking * OCEAN_INNER_FOAM),
      reach, steepness: steepness * s,
    },
    scale,
    offshore: 2 * Math.hypot(ox, oy),
    direction: wl > 0 ? [wx / wl, wz / wl] : [1, 0],
    wc,
    column,
  };
}

/**
 * The swell at the undisplaced point (x, z) under the frame's phases. Its slopes
 * are the gradient of the phase the evaluation sums: −∂height/∂x = Σ A·kn·sin φ
 * and −∂height/∂z = Σ A·Kv.z·sin φ, Kv.z carrying the coastline's turn and the
 * phase weight's change along z.
 */
export function swellAt(field: OceanField, phases: Float32Array, x: number, z: number): SwellSample {
  return evaluate(field, phases, x, z).sample;
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
  const e = evaluate(field, phases, x, z);
  const t = field.tables;
  const depthAt = (column: number): number => {
    const bay = atlasRead(t, OCEAN_ROW_BAY_PROFILE, column)[0];
    const cove = atlasRead(t, OCEAN_ROW_COVE_PROFILE, column)[0];
    return bay + (cove - bay) * e.wc;
  };
  const slope = Math.abs(depthAt(e.column - 1) - depthAt(e.column + 1)) / (2 * OCEAN_D_STEP);
  const offshoreLength = (OCEAN_G * field.tp * field.tp) / TWO_PI;
  return {
    height: e.sample.unbroken * e.scale,
    period: field.tp,
    direction: e.direction,
    phase: e.sample.crestPhase,
    depth: e.sample.depth,
    slope,
    offshoreHeight: e.offshore,
    offshoreLength,
    broken: e.sample.broken,
    iribarren: slope / Math.sqrt(Math.max(e.offshore, 1e-6) / offshoreLength),
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
