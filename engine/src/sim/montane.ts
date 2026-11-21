/**
 * The montane elevation pipeline: a low-frequency uplift field
 * decides where mountains are; everything else is a function of it. Six
 * stages: uplift (with a floor that keeps relief off zero) →
 * two-scale domain warp → hybrid multifractal (fBm↔ridged blended by uplift)
 * → derivative-aware erosion attenuation → talus bias → a reserved slot for
 * real hydraulic erosion.
 *
 * The whole pipeline is parameterized over `MontaneTunables`:
 * `sampleWith(cfg, reliefNorm, flags, seed, x, z)` reads every knob from
 * `cfg` instead of module constants, so a second config (denser terrain)
 * can reuse the same code with different numbers. `MONTANE_TUNABLES`
 * is today's values as one such config.
 *
 * THE CONTRACT OF THIS FILE: the returned `dx`/`dz` are the EXACT analytic
 * derivatives of the returned `h`, verified against numerical differentiation
 * in montane.test.ts. Exactness is what makes the mesh normals true
 * (smooth, not faceted) and what stage 4
 * is built on. Two structural rules keep it achievable:
 *
 *  - Everything inside the relief loop is a function of the WARPED coordinate
 *    q = W(p). The warp enters once, at the end, via its Jacobian.
 *  - The erosion/talus weights read the gradient of a GUIDE field —
 *    the unweighted running fBm sum — never of the weighted sum itself.
 *    Weighting the guide would need third derivatives and recurse forever;
 *    the guide needs only the second derivatives `gradientNoise2` provides.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 * Math.sqrt is IEEE-exact and allowed.
 */
import { fbm2d, gradientNoise2 } from "./field.js";
import { registerTerrainVariant, type TerrainSample } from "./terrain.js";

// ---- Tunables (starting points, not values to defend) ---------
export const UPLIFT_WAVELENGTH = 4096;
export const UPLIFT_OCTAVES = 3;
/** Exponent on uplift; implemented as repeated multiplication (no `**`). */
export const UPLIFT_POWER = 2;
export const WARP_COARSE_WAVELENGTH = 512;
export const WARP_COARSE_STRENGTH = 120;
export const WARP_FINE_WAVELENGTH = 96;
export const WARP_FINE_STRENGTH = 18;
export const WARP_OCTAVES = 2;
export const RELIEF_WAVELENGTH = 1024;
export const RELIEF_OCTAVES = 8;
export const PEAK_HEIGHT = 650;
export const EROSION_STRENGTH = 6;
/** tan(34°) — the angle of repose, as rise over run. */
export const REPOSE_SLOPE = 0.675;
export const TALUS_BAND = 0.35;
export const TALUS_STRENGTH = 0.85;
/** Softens |n| at ridge crests so the field stays differentiable there. */
export const RIDGE_EPSILON = 0.02;
/** Uplift range over which octaves blend from smooth fBm to ridged. */
export const RIDGE_BLEND_LO = 0.35;
export const RIDGE_BLEND_HI = 0.75;

/** New stage-1 knob: u′ = FLOOR + (1 − FLOOR)·u. At 0 this is
 * 0 + 1·u — IEEE-exact identity — which is what lets montaneSnapshot.test.ts
 * gate this refactor bit-for-bit. */
export const UPLIFT_FLOOR = 0;

/** Everything that steers the pipeline, as one value — the montane and dense
 * configs are two instances of this. */
export type MontaneTunables = {
  UPLIFT_WAVELENGTH: number; UPLIFT_OCTAVES: number; UPLIFT_POWER: number;
  UPLIFT_FLOOR: number;
  WARP_COARSE_WAVELENGTH: number; WARP_COARSE_STRENGTH: number;
  WARP_FINE_WAVELENGTH: number; WARP_FINE_STRENGTH: number; WARP_OCTAVES: number;
  RELIEF_WAVELENGTH: number; RELIEF_OCTAVES: number; PEAK_HEIGHT: number;
  EROSION_STRENGTH: number; REPOSE_SLOPE: number; TALUS_BAND: number;
  TALUS_STRENGTH: number; RIDGE_EPSILON: number;
  RIDGE_BLEND_LO: number; RIDGE_BLEND_HI: number;
};

export const MONTANE_TUNABLES: MontaneTunables = Object.freeze({
  UPLIFT_WAVELENGTH, UPLIFT_OCTAVES, UPLIFT_POWER, UPLIFT_FLOOR,
  WARP_COARSE_WAVELENGTH, WARP_COARSE_STRENGTH,
  WARP_FINE_WAVELENGTH, WARP_FINE_STRENGTH, WARP_OCTAVES,
  RELIEF_WAVELENGTH, RELIEF_OCTAVES, PEAK_HEIGHT,
  EROSION_STRENGTH, REPOSE_SLOPE, TALUS_BAND, TALUS_STRENGTH,
  RIDGE_EPSILON, RIDGE_BLEND_LO, RIDGE_BLEND_HI,
});

const UPLIFT_SALT = 0x51ab;
const WARP_CX_SALT = 0x77a1;
const WARP_CZ_SALT = 0x77a2;
const WARP_FX_SALT = 0x77b1;
const WARP_FZ_SALT = 0x77b2;
const RELIEF_SALT = 0x2e19;

/** Σ amp over the relief octaves — normalizes the weighted sum to ≤ 1.
 * Same loop the old module-level IIFE ran, so same bits for 8 octaves. */
function reliefNormFor(octaves: number): number {
  let norm = 0;
  let amp = 1;
  for (let i = 0; i < octaves; i++) {
    norm += amp;
    amp *= 0.5;
  }
  return norm;
}

/** Smoothstep with its derivative; clamped flat (zero slope) outside. */
function smoothstepD(edge0: number, edge1: number, x: number): { v: number; d: number } {
  const span = edge1 - edge0;
  if (x <= edge0) return { v: 0, d: 0 };
  if (x >= edge1) return { v: 1, d: 0 };
  const t = (x - edge0) / span;
  return { v: t * t * (3 - 2 * t), d: (6 * t * (1 - t)) / span };
}

type Flags = {
  warp: number;
  erosion: number;
  talus: number;
  /** Negative disables; ≥ 0 pins uplift to that constant (for `ridged`). */
  upliftOverride: number;
};

function sampleWith(
  cfg: MontaneTunables,
  reliefNorm: number,
  f: Flags,
  seed: number,
  x: number,
  z: number,
): TerrainSample {
  // ---- Stage 1: uplift, u ∈ [0, 1], with its p-space gradient -------------
  let u: number;
  let ux = 0;
  let uz = 0;
  if (f.upliftOverride >= 0) {
    u = f.upliftOverride;
  } else {
    const un = fbm2d(x / cfg.UPLIFT_WAVELENGTH, z / cfg.UPLIFT_WAVELENGTH, seed ^ UPLIFT_SALT, cfg.UPLIFT_OCTAVES);
    // Raise the floor under uplift so nothing sits at zero relief.
    // At UPLIFT_FLOOR = 0 both lines are exact identities (0 + 1·u; 1·0.5),
    // which is what keeps the montane/plain snapshots bit-identical.
    u = cfg.UPLIFT_FLOOR + (1 - cfg.UPLIFT_FLOOR) * (0.5 + 0.5 * un.v);
    const g = (1 - cfg.UPLIFT_FLOOR) * 0.5;
    ux = (g * un.dx) / cfg.UPLIFT_WAVELENGTH;
    uz = (g * un.dz) / cfg.UPLIFT_WAVELENGTH;
  }

  // ---- Stage 2: domain warp q = p + A·g(p), with Jacobian ∂q/∂p -----------
  let qx = x;
  let qz = z;
  let jxx = 1; // ∂qx/∂x
  let jxz = 0; // ∂qx/∂z
  let jzx = 0; // ∂qz/∂x
  let jzz = 1; // ∂qz/∂z
  if (f.warp !== 0) {
    const cx = fbm2d(x / cfg.WARP_COARSE_WAVELENGTH, z / cfg.WARP_COARSE_WAVELENGTH, seed ^ WARP_CX_SALT, cfg.WARP_OCTAVES);
    const cz = fbm2d(x / cfg.WARP_COARSE_WAVELENGTH, z / cfg.WARP_COARSE_WAVELENGTH, seed ^ WARP_CZ_SALT, cfg.WARP_OCTAVES);
    const fxn = fbm2d(x / cfg.WARP_FINE_WAVELENGTH, z / cfg.WARP_FINE_WAVELENGTH, seed ^ WARP_FX_SALT, cfg.WARP_OCTAVES);
    const fzn = fbm2d(x / cfg.WARP_FINE_WAVELENGTH, z / cfg.WARP_FINE_WAVELENGTH, seed ^ WARP_FZ_SALT, cfg.WARP_OCTAVES);
    qx = x + cfg.WARP_COARSE_STRENGTH * cx.v + cfg.WARP_FINE_STRENGTH * fxn.v;
    qz = z + cfg.WARP_COARSE_STRENGTH * cz.v + cfg.WARP_FINE_STRENGTH * fzn.v;
    const cc = cfg.WARP_COARSE_STRENGTH / cfg.WARP_COARSE_WAVELENGTH;
    const cf = cfg.WARP_FINE_STRENGTH / cfg.WARP_FINE_WAVELENGTH;
    jxx = 1 + cc * cx.dx + cf * fxn.dx;
    jxz = cc * cx.dz + cf * fxn.dz;
    jzx = cc * cz.dx + cf * fzn.dx;
    jzz = 1 + cc * cz.dz + cf * fzn.dz;
  }

  // ---- Stage 3 blend: 0 = smooth fBm valley, 1 = fully ridged peak --------
  const tS = smoothstepD(cfg.RIDGE_BLEND_LO, cfg.RIDGE_BLEND_HI, u);
  const t = tS.v;

  // ---- Stage 3: the relief loop, entirely in q-space ----------------------
  // Sum S with its q-gradient and ∂S/∂t. This stage adds the per-octave weights
  // (stages 4–5) and the guide field they read.
  let sv = 0;
  let sqx = 0;
  let sqz = 0;
  let st = 0;
  let su = 0;
  let amp = 1;
  let freq = 1 / cfg.RELIEF_WAVELENGTH;

  // Guide field: the UNWEIGHTED running fBm sum over octaves already visited,
  // with its q-gradient and Hessian. Stages 4–5 read this and never the
  // weighted sum they are building — see the note at the top of this file.
  let fgx = 0;
  let fgz = 0;
  let fxx = 0;
  let fxz = 0;
  let fzz = 0;

  // u^POWER and its derivative, by repeated multiplication (no `**`). After
  // the loop, up = u^P and upd = P·u^(P−1).
  //
  // Computed HERE, before the relief loop, rather than at the end where the
  // final scaling happens — because the guide field has to be scaled by the
  // same `up` the height is. Scaling the guide at full uplift while the
  // terrain is scaled at `up` made the attenuation measure a slope the ground
  // does not have: it overstated |∇|² by 1/u^(2P), a factor of 16 at the
  // median uplift, so stages 4 and 5 fired at full strength in valleys whose
  // real slope is a few percent and octaves 5–8 contributed under 1% of
  // nominal everywhere. That is what made the field read as four octaves of
  // fBm — soft, rounded, and flat-topped — instead of as mountains.
  let up = 1;
  let upd = 0;
  for (let k = 0; k < cfg.UPLIFT_POWER; k++) {
    upd = upd * u + up;
    up = up * u;
  }

  // Split so the u-derivative below can use the constant half. `guideScale`
  // now varies with position through `up`, which is the whole point.
  const guideBase = cfg.PEAK_HEIGHT / reliefNorm;
  const guideScale = guideBase * up;

  for (let i = 0; i < cfg.RELIEF_OCTAVES; i++) {
    // Stages 4–5. Weight, its q-gradient, and — since the guide is scaled by
    // u^POWER — its u-derivative.
    let w = 1;
    let wqx = 0;
    let wqz = 0;
    let wu = 0;
    if (i > 0 && (f.erosion !== 0 || f.talus !== 0)) {
      // m = |∇guide|² in real units. The guide is now scaled at the LOCAL
      // uplift, so m is a slope the ground actually has. This is the ONLY
      // place the noise's second derivatives are consumed.
      const gsq = guideScale * guideScale;
      const fsq = fgx * fgx + fgz * fgz;
      const m = gsq * fsq;
      const mqx = 2 * gsq * (fgx * fxx + fgz * fxz);
      const mqz = 2 * gsq * (fgx * fxz + fgz * fzz);
      // ∂m/∂u, from m = (guideBase·u^P)²·|∇f|². Written as a product rather
      // than as m·2·upd/up, which is algebraically the same away from zero
      // but is 0/0 at u = 0 and would need a guard.
      const mu = 2 * guideBase * guideBase * up * upd * fsq;

      // Each stage contributes a factor and a ∂/∂m; the chain rule then gives
      // every derivative of the combined weight from one shared ∂w/∂m, which
      // is what lets the u-derivative come along for free.
      let we = 1;
      let dwe = 0;
      if (f.erosion !== 0) {
        // Stage 4, Quílez's derivative-aware attenuation: detail stops
        // accumulating where the surface is already steep, so faces smooth
        // and ridges sharpen. It READS as erosion, is entirely local, and
        // costs one multiply-add per octave.
        we = 1 / (1 + cfg.EROSION_STRENGTH * m);
        // d/dm of 1/(1+k·m) is -k·(1+k·m)⁻² = -k·we².
        dwe = -cfg.EROSION_STRENGTH * we * we;
      }
      let wt = 1;
      let dwt = 0;
      if (f.talus !== 0) {
        // Stage 5, and an APPROXIMATION labelled as one: real
        // talus accumulates downslope and is therefore non-local. This only
        // biases steep faces toward the repose angle by damping further
        // detail once the guide slope passes it; it transports no material.
        // Compared in squared form so no square root is needed.
        const lo = cfg.REPOSE_SLOPE * cfg.REPOSE_SLOPE;
        const hi = (cfg.REPOSE_SLOPE + cfg.TALUS_BAND) * (cfg.REPOSE_SLOPE + cfg.TALUS_BAND);
        const s = smoothstepD(lo, hi, m);
        wt = 1 - cfg.TALUS_STRENGTH * s.v;
        dwt = -cfg.TALUS_STRENGTH * s.d;
      }
      // Product rule over the two stages, then the chain rule out to each
      // variable m depends on.
      w = we * wt;
      const dwdm = dwe * wt + we * dwt;
      wqx = dwdm * mqx;
      wqz = dwdm * mqz;
      wu = dwdm * mu;
    }

    const n = gradientNoise2(qx * freq, qz * freq, (seed ^ RELIEF_SALT) + i * 0x9e37);
    const ndx = n.dx * freq;
    const ndz = n.dz * freq;

    // Smooth channel: map to [0, 1]. Ridge channel: (1 − softabs(n))², the
    // canonical ridged shape, with |n| softened by RIDGE_EPSILON so the crest
    // line stays differentiable (the derivative test crosses crests).
    const sm = 0.5 + 0.5 * n.v;
    const smx = 0.5 * ndx;
    const smz = 0.5 * ndz;
    const a = Math.sqrt(n.v * n.v + cfg.RIDGE_EPSILON * cfg.RIDGE_EPSILON);
    const ax = (n.v / a) * ndx;
    const az = (n.v / a) * ndz;
    const r = (1 - a) * (1 - a);
    const rx = -2 * (1 - a) * ax;
    const rz = -2 * (1 - a) * az;

    const si = sm + t * (r - sm);
    const six = smx + t * (rx - smx);
    const siz = smz + t * (rz - smz);

    sv += w * amp * si;
    sqx += wqx * amp * si + w * amp * six;
    sqz += wqz * amp * si + w * amp * siz;
    st += w * amp * (r - sm);
    // ∂S/∂u, which exists only because the guide is scaled at the local
    // uplift. Zero for `plain` and `ridged`, whose weights are constant 1.
    su += wu * amp * si;

    // AFTER the weight was read: octave i joins the guide that damps octave
    // i+1, never itself. Hoisting this above the weight block would make each
    // octave damp itself — still self-consistent maths, so the derivative test
    // would stay green, but a different and much flatter landscape.
    fgx += amp * ndx;
    fgz += amp * ndz;
    fxx += amp * freq * freq * n.dxx;
    fxz += amp * freq * freq * n.dxz;
    fzz += amp * freq * freq * n.dzz;

    amp *= 0.5;
    freq *= 2;
  }

  const rv = sv / reliefNorm;
  const rqx = sqx / reliefNorm;
  const rqz = sqz / reliefNorm;
  const rt = st / reliefNorm;
  const ru = su / reliefNorm;

  // Chain rule back to p-space. R now depends on u twice over — through the
  // ridge blend t(u), and through the attenuation weights, which read a guide
  // scaled by u^POWER:
  //   ∂R/∂px = Rqx·∂qx/∂px + Rqz·∂qz/∂px + (Rt·t'(u) + Ru)·∂u/∂px.
  const rpx = jxx * rqx + jzx * rqz + (rt * tS.d + ru) * ux;
  const rpz = jxz * rqx + jzz * rqz + (rt * tS.d + ru) * uz;

  // h = PEAK · u^POWER · R; `up` and `upd` were computed before the loop,
  // because the guide scaling needs them.
  return {
    h: cfg.PEAK_HEIGHT * up * rv,
    dx: cfg.PEAK_HEIGHT * (upd * ux * rv + up * rpx),
    dz: cfg.PEAK_HEIGHT * (upd * uz * rv + up * rpz),
  };
}

function variantTunables(cfg: MontaneTunables, flags: Flags): Readonly<Record<string, number>> {
  return {
    ...cfg,
    WARP_ENABLED: flags.warp,
    EROSION_ENABLED: flags.erosion,
    TALUS_ENABLED: flags.talus,
    UPLIFT_OVERRIDE: flags.upliftOverride,
  };
}

function defineVariant(name: string, cfg: MontaneTunables, flags: Flags): void {
  const norm = reliefNormFor(cfg.RELIEF_OCTAVES);
  registerTerrainVariant({
    name,
    tunables: variantTunables(cfg, flags),
    sample: (seed, x, z) => sampleWith(cfg, norm, flags, seed, x, z),
  });
}

const MONTANE_FLAGS: Flags = { warp: 1, erosion: 1, talus: 1, upliftOverride: -1 };
const MONTANE_NORM = reliefNormFor(MONTANE_TUNABLES.RELIEF_OCTAVES);

/** The montane pipeline as a plain function — `olympic.ts` composes with it
 * and must get bit-identical answers to the registered variant. */
export function montaneSample(seed: number, x: number, z: number): TerrainSample {
  return sampleWith(MONTANE_TUNABLES, MONTANE_NORM, MONTANE_FLAGS, seed, x, z);
}

/** Montane's full tunables record — the olympic variant embeds these so its
 * level id moves whenever the underlying pipeline's constants do. */
export const MONTANE_VARIANT_TUNABLES = variantTunables(MONTANE_TUNABLES, MONTANE_FLAGS);

// `plain` is the control — stages 1–3 only, for seeing what the
// erosion and talus stages actually contribute. `ridged` isolates the mountain
// primitive at constant full uplift. `montane` is uplift-driven terrain with
// stages 4–5 turned on.
defineVariant("montane", MONTANE_TUNABLES, MONTANE_FLAGS);
defineVariant("plain", MONTANE_TUNABLES, { warp: 1, erosion: 0, talus: 0, upliftOverride: -1 });
defineVariant("ridged", MONTANE_TUNABLES, { warp: 0, erosion: 0, talus: 0, upliftOverride: 1 });

/** Amended by the measured PEAK result: ranges every ~1.8 km instead of ~4
 * (the view window spans four-plus uplift wavelengths, so several ranges are
 * always in view). PEAK_HEIGHT is 1100, not montane's 650, because the
 * field's statistical ceiling is only ~0.42 × PEAK_HEIGHT — fBm octaves never
 * sum near 1 — so 650 capped real peaks at ~320 m, short of the census's
 * max > 400 promise. The uplift floor stays at montane's 0: a 24-config
 * sweep showed a non-zero floor collapses flat lowland while barely raising
 * peaks, so it is deliberately left un-overridden rather than tuned up.
 * Starting points, not values to defend — tuned by eye in the running game and
 * the density census in dense.test.ts keeps them honest. */
export const DENSE_TUNABLES: MontaneTunables = Object.freeze({
  ...MONTANE_TUNABLES,
  UPLIFT_WAVELENGTH: 1792,
  PEAK_HEIGHT: 1100,
  // Crisper mountains: ridged character extends
  // further down-flank, crests sharpen, steeps keep more bite. Starting
  // points, not values to defend — tuned by eye in the running game and the
  // dense census keeps them honest; if a census bound breaks, the census
  // wins and the value retreats toward montane's.
  RIDGE_BLEND_LO: 0.25,
  EROSION_STRENGTH: 8,
  TALUS_STRENGTH: 0.7,
});

const DENSE_NORM = reliefNormFor(DENSE_TUNABLES.RELIEF_OCTAVES);

/** The dense pipeline as a plain function — the olympic variant composes
 * its inland half with this. */
export function denseSample(seed: number, x: number, z: number): TerrainSample {
  return sampleWith(DENSE_TUNABLES, DENSE_NORM, MONTANE_FLAGS, seed, x, z);
}

/** Dense's full tunables record, for the olympic variant's registry entry. */
export const DENSE_VARIANT_TUNABLES = variantTunables(DENSE_TUNABLES, MONTANE_FLAGS);

defineVariant("dense", DENSE_TUNABLES, MONTANE_FLAGS);
