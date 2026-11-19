//! The field math of Day Hike's simulation, for WebAssembly: `client/src/sim/field.ts` (the hashes, the value
//! noise, the gradient noise with its first and second derivatives, and their octave sums) and the montane
//! elevation pipeline of `client/src/sim/montane.ts`, statement for statement and in the same order, so every
//! result is the same double the TypeScript returns. `client/test/sim/fieldKernel.test.ts` holds it to that.
//!
//! The simulation's determinism rule holds here as there: add, subtract, multiply, divide, floor and square root
//! only, which WebAssembly defines to the bit. Nothing here calls a function a platform rounds its own way
//! (no powers, no trigonometry, no exponentials), and nothing here reads a tunable of its own: the montane
//! pipeline's numbers are written into `cfg_ptr()` by the TypeScript that owns them.

const FNV_PRIME: i32 = 0x0100_0193;
const FNV_OFFSET: i32 = 0x811c_9dc5_u32 as i32;

/// ECMAScript's ToInt32, for the doubles a coordinate or a seed can be: finite, and whole or not.
#[inline(always)]
fn to_i32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    (x as i64) as i32
}

#[inline(always)]
fn mix(h: i32) -> u32 {
    let mut x = h as u32;
    x ^= x >> 15;
    x = x.wrapping_mul(0x2545_f491);
    x ^= x >> 13;
    x = x.wrapping_mul(0x27d4_eb2d);
    x ^= x >> 16;
    x
}

#[inline(always)]
fn hash2_of(x: f64, z: f64, seed: f64) -> f64 {
    let mut h = FNV_OFFSET ^ to_i32(seed);
    h = (h ^ to_i32(x)).wrapping_mul(FNV_PRIME);
    h = (h ^ to_i32(z)).wrapping_mul(FNV_PRIME);
    mix(h) as f64 / 4294967296.0
}

#[inline(always)]
fn hash3_of(x: f64, z: f64, i: f64, seed: f64) -> f64 {
    let mut h = FNV_OFFSET ^ to_i32(seed);
    h = (h ^ to_i32(x)).wrapping_mul(FNV_PRIME);
    h = (h ^ to_i32(z)).wrapping_mul(FNV_PRIME);
    h = (h ^ to_i32(i)).wrapping_mul(FNV_PRIME);
    mix(h) as f64 / 4294967296.0
}

#[inline(always)]
fn fade(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

#[inline(always)]
fn value_noise2_of(x: f64, z: f64, seed: f64) -> f64 {
    let xi = x.floor();
    let zi = z.floor();
    let u = fade(x - xi);
    let v = fade(z - zi);
    let a = hash2_of(xi, zi, seed);
    let b = hash2_of(xi + 1.0, zi, seed);
    let c = hash2_of(xi, zi + 1.0, seed);
    let d = hash2_of(xi + 1.0, zi + 1.0, seed);
    let top = a + (b - a) * u;
    let bot = c + (d - c) * u;
    top + (bot - top) * v
}

#[inline(always)]
fn fbm2_of(x: f64, z: f64, seed: f64, octaves: i32) -> f64 {
    let mut sum = 0.0;
    let mut norm = 0.0;
    let mut amp = 1.0;
    let mut freq = 1.0;
    for i in 0..octaves {
        sum += amp * value_noise2_of(x * freq, z * freq, seed + (i as f64) * 40503.0);
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / norm
}

#[derive(Clone, Copy)]
struct Noise {
    v: f64,
    dx: f64,
    dz: f64,
    dxx: f64,
    dxz: f64,
    dzz: f64,
}

const SQ: f64 = core::f64::consts::FRAC_1_SQRT_2;
const GRAD_X: [f64; 8] = [1.0, -1.0, 0.0, 0.0, SQ, SQ, -SQ, -SQ];
const GRAD_Z: [f64; 8] = [0.0, 0.0, 1.0, -1.0, SQ, -SQ, SQ, -SQ];
const NOISE_NORM: f64 = core::f64::consts::SQRT_2;

#[inline(always)]
fn gradient_noise2_of(x: f64, z: f64, seed: f64) -> Noise {
    let xi = x.floor();
    let zi = z.floor();
    let fx = x - xi;
    let fz = z - zi;

    let ia = ((hash2_of(xi, zi, seed) * 8.0) as i32 & 7) as usize;
    let ib = ((hash2_of(xi + 1.0, zi, seed) * 8.0) as i32 & 7) as usize;
    let ic = ((hash2_of(xi, zi + 1.0, seed) * 8.0) as i32 & 7) as usize;
    let id = ((hash2_of(xi + 1.0, zi + 1.0, seed) * 8.0) as i32 & 7) as usize;
    let (gax, gaz) = (GRAD_X[ia], GRAD_Z[ia]);
    let (gbx, gbz) = (GRAD_X[ib], GRAD_Z[ib]);
    let (gcx, gcz) = (GRAD_X[ic], GRAD_Z[ic]);
    let (gdx, gdz) = (GRAD_X[id], GRAD_Z[id]);

    let va = gax * fx + gaz * fz;
    let vb = gbx * (fx - 1.0) + gbz * fz;
    let vc = gcx * fx + gcz * (fz - 1.0);
    let vd = gdx * (fx - 1.0) + gdz * (fz - 1.0);

    let u = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    let du = 30.0 * fx * fx * (fx - 1.0) * (fx - 1.0);
    let ddu = 60.0 * fx * (2.0 * fx - 1.0) * (fx - 1.0);
    let w = fz * fz * fz * (fz * (fz * 6.0 - 15.0) + 10.0);
    let dw = 30.0 * fz * fz * (fz - 1.0) * (fz - 1.0);
    let ddw = 60.0 * fz * (2.0 * fz - 1.0) * (fz - 1.0);

    let b = vb - va;
    let c = vc - va;
    let d = va - vb - vc + vd;
    let bx = gbx - gax;
    let cx = gcx - gax;
    let dx_ = gax - gbx - gcx + gdx;
    let bz = gbz - gaz;
    let cz = gcz - gaz;
    let dz_ = gaz - gbz - gcz + gdz;

    let value = va + u * b + w * c + u * w * d;
    let dx = gax + u * bx + w * cx + u * w * dx_ + du * (b + w * d);
    let dz = gaz + u * bz + w * cz + u * w * dz_ + dw * (c + u * d);
    let dxx = 2.0 * du * (bx + w * dx_) + ddu * (b + w * d);
    let dzz = 2.0 * dw * (cz + u * dz_) + ddw * (c + u * d);
    let dxz = du * (bz + dw * d + w * dz_) + dw * (cx + u * dx_);

    Noise {
        v: value * NOISE_NORM,
        dx: dx * NOISE_NORM,
        dz: dz * NOISE_NORM,
        dxx: dxx * NOISE_NORM,
        dxz: dxz * NOISE_NORM,
        dzz: dzz * NOISE_NORM,
    }
}

#[inline(always)]
fn fbm2d_of(x: f64, z: f64, seed: f64, octaves: i32) -> Noise {
    let (mut v, mut dx, mut dz, mut dxx, mut dxz, mut dzz) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    let mut amp = 1.0;
    let mut freq = 1.0;
    let mut norm = 0.0;
    for i in 0..octaves {
        let n = gradient_noise2_of(x * freq, z * freq, seed + (i as f64) * 40503.0);
        v += amp * n.v;
        dx += amp * freq * n.dx;
        dz += amp * freq * n.dz;
        dxx += amp * freq * freq * n.dxx;
        dxz += amp * freq * freq * n.dxz;
        dzz += amp * freq * freq * n.dzz;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    Noise { v: v / norm, dx: dx / norm, dz: dz / norm, dxx: dxx / norm, dxz: dxz / norm, dzz: dzz / norm }
}

// ---- The montane pipeline (montane.ts's sampleWith) ---------------------------------------------------------------

/// A config's numbers, in the order `client/src/sim/fieldKernel.ts` writes them (MONTANE_KERNEL_FIELDS).
const CFG_LEN: usize = 23;
/// How many configs can be held at once.
const SLOTS: usize = 16;

#[derive(Clone, Copy)]
struct Cfg {
    uplift_wavelength: f64,
    uplift_octaves: i32,
    uplift_power: i32,
    uplift_floor: f64,
    warp_coarse_wavelength: f64,
    warp_coarse_strength: f64,
    warp_fine_wavelength: f64,
    warp_fine_strength: f64,
    warp_octaves: i32,
    relief_wavelength: f64,
    relief_octaves: i32,
    peak_height: f64,
    erosion_strength: f64,
    repose_slope: f64,
    talus_band: f64,
    talus_strength: f64,
    ridge_epsilon: f64,
    ridge_blend_lo: f64,
    ridge_blend_hi: f64,
    warp: f64,
    erosion: f64,
    talus: f64,
    uplift_override: f64,
    relief_norm: f64,
}

static mut CFG: [f64; SLOTS * CFG_LEN] = [0.0; SLOTS * CFG_LEN];

#[inline(always)]
fn cfg_of(slot: i32) -> Cfg {
    let base = (slot as usize % SLOTS) * CFG_LEN;
    let at = |i: usize| -> f64 { unsafe { *(core::ptr::addr_of!(CFG) as *const f64).add(base + i) } };
    let relief_octaves = at(10) as i32;
    // The sum of the relief octaves' amplitudes, by montane.ts's own loop (reliefNormFor).
    let mut relief_norm = 0.0;
    let mut amp = 1.0;
    for _ in 0..relief_octaves {
        relief_norm += amp;
        amp *= 0.5;
    }
    Cfg {
        uplift_wavelength: at(0),
        uplift_octaves: at(1) as i32,
        uplift_power: at(2) as i32,
        uplift_floor: at(3),
        warp_coarse_wavelength: at(4),
        warp_coarse_strength: at(5),
        warp_fine_wavelength: at(6),
        warp_fine_strength: at(7),
        warp_octaves: at(8) as i32,
        relief_wavelength: at(9),
        relief_octaves,
        peak_height: at(11),
        erosion_strength: at(12),
        repose_slope: at(13),
        talus_band: at(14),
        talus_strength: at(15),
        ridge_epsilon: at(16),
        ridge_blend_lo: at(17),
        ridge_blend_hi: at(18),
        warp: at(19),
        erosion: at(20),
        talus: at(21),
        uplift_override: at(22),
        relief_norm,
    }
}

const UPLIFT_SALT: i32 = 0x51ab;
const WARP_CX_SALT: i32 = 0x77a1;
const WARP_CZ_SALT: i32 = 0x77a2;
const WARP_FX_SALT: i32 = 0x77b1;
const WARP_FZ_SALT: i32 = 0x77b2;
const RELIEF_SALT: i32 = 0x2e19;

#[inline(always)]
fn smoothstep_d(edge0: f64, edge1: f64, x: f64) -> (f64, f64) {
    let span = edge1 - edge0;
    if x <= edge0 {
        return (0.0, 0.0);
    }
    if x >= edge1 {
        return (1.0, 0.0);
    }
    let t = (x - edge0) / span;
    (t * t * (3.0 - 2.0 * t), (6.0 * t * (1.0 - t)) / span)
}

#[inline(always)]
fn montane_of(cfg: &Cfg, seed: f64, x: f64, z: f64) -> (f64, f64, f64) {
    let s = to_i32(seed);

    // Stage 1: uplift, with its gradient.
    let u;
    let mut ux = 0.0;
    let mut uz = 0.0;
    if cfg.uplift_override >= 0.0 {
        u = cfg.uplift_override;
    } else {
        let un = fbm2d_of(x / cfg.uplift_wavelength, z / cfg.uplift_wavelength, (s ^ UPLIFT_SALT) as f64, cfg.uplift_octaves);
        u = cfg.uplift_floor + (1.0 - cfg.uplift_floor) * (0.5 + 0.5 * un.v);
        let g = (1.0 - cfg.uplift_floor) * 0.5;
        ux = (g * un.dx) / cfg.uplift_wavelength;
        uz = (g * un.dz) / cfg.uplift_wavelength;
    }

    // Stage 2: the domain warp and its Jacobian.
    let mut qx = x;
    let mut qz = z;
    let mut jxx = 1.0;
    let mut jxz = 0.0;
    let mut jzx = 0.0;
    let mut jzz = 1.0;
    if cfg.warp != 0.0 {
        let cx = fbm2d_of(x / cfg.warp_coarse_wavelength, z / cfg.warp_coarse_wavelength, (s ^ WARP_CX_SALT) as f64, cfg.warp_octaves);
        let cz = fbm2d_of(x / cfg.warp_coarse_wavelength, z / cfg.warp_coarse_wavelength, (s ^ WARP_CZ_SALT) as f64, cfg.warp_octaves);
        let fxn = fbm2d_of(x / cfg.warp_fine_wavelength, z / cfg.warp_fine_wavelength, (s ^ WARP_FX_SALT) as f64, cfg.warp_octaves);
        let fzn = fbm2d_of(x / cfg.warp_fine_wavelength, z / cfg.warp_fine_wavelength, (s ^ WARP_FZ_SALT) as f64, cfg.warp_octaves);
        qx = x + cfg.warp_coarse_strength * cx.v + cfg.warp_fine_strength * fxn.v;
        qz = z + cfg.warp_coarse_strength * cz.v + cfg.warp_fine_strength * fzn.v;
        let cc = cfg.warp_coarse_strength / cfg.warp_coarse_wavelength;
        let cf = cfg.warp_fine_strength / cfg.warp_fine_wavelength;
        jxx = 1.0 + cc * cx.dx + cf * fxn.dx;
        jxz = cc * cx.dz + cf * fxn.dz;
        jzx = cc * cz.dx + cf * fzn.dx;
        jzz = 1.0 + cc * cz.dz + cf * fzn.dz;
    }

    // Stage 3's blend.
    let (t, td) = smoothstep_d(cfg.ridge_blend_lo, cfg.ridge_blend_hi, u);

    let (mut sv, mut sqx, mut sqz, mut st, mut su) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let mut amp = 1.0;
    let mut freq = 1.0 / cfg.relief_wavelength;
    let (mut fgx, mut fgz, mut fxx, mut fxz, mut fzz) = (0.0, 0.0, 0.0, 0.0, 0.0);

    let mut up = 1.0;
    let mut upd = 0.0;
    for _ in 0..cfg.uplift_power {
        upd = upd * u + up;
        up = up * u;
    }

    let guide_base = cfg.peak_height / cfg.relief_norm;
    let guide_scale = guide_base * up;
    let relief_seed = (s ^ RELIEF_SALT) as f64;

    for i in 0..cfg.relief_octaves {
        let mut w = 1.0;
        let mut wqx = 0.0;
        let mut wqz = 0.0;
        let mut wu = 0.0;
        if i > 0 && (cfg.erosion != 0.0 || cfg.talus != 0.0) {
            let gsq = guide_scale * guide_scale;
            let fsq = fgx * fgx + fgz * fgz;
            let m = gsq * fsq;
            let mqx = 2.0 * gsq * (fgx * fxx + fgz * fxz);
            let mqz = 2.0 * gsq * (fgx * fxz + fgz * fzz);
            let mu = 2.0 * guide_base * guide_base * up * upd * fsq;

            let mut we = 1.0;
            let mut dwe = 0.0;
            if cfg.erosion != 0.0 {
                we = 1.0 / (1.0 + cfg.erosion_strength * m);
                dwe = -cfg.erosion_strength * we * we;
            }
            let mut wt = 1.0;
            let mut dwt = 0.0;
            if cfg.talus != 0.0 {
                let lo = cfg.repose_slope * cfg.repose_slope;
                let hi = (cfg.repose_slope + cfg.talus_band) * (cfg.repose_slope + cfg.talus_band);
                let (s_v, s_d) = smoothstep_d(lo, hi, m);
                wt = 1.0 - cfg.talus_strength * s_v;
                dwt = -cfg.talus_strength * s_d;
            }
            w = we * wt;
            let dwdm = dwe * wt + we * dwt;
            wqx = dwdm * mqx;
            wqz = dwdm * mqz;
            wu = dwdm * mu;
        }

        let n = gradient_noise2_of(qx * freq, qz * freq, relief_seed + (i as f64) * 40503.0);
        let ndx = n.dx * freq;
        let ndz = n.dz * freq;

        let sm = 0.5 + 0.5 * n.v;
        let smx = 0.5 * ndx;
        let smz = 0.5 * ndz;
        let a = (n.v * n.v + cfg.ridge_epsilon * cfg.ridge_epsilon).sqrt();
        let ax = (n.v / a) * ndx;
        let az = (n.v / a) * ndz;
        let r = (1.0 - a) * (1.0 - a);
        let rx = -2.0 * (1.0 - a) * ax;
        let rz = -2.0 * (1.0 - a) * az;

        let si = sm + t * (r - sm);
        let six = smx + t * (rx - smx);
        let siz = smz + t * (rz - smz);

        sv += w * amp * si;
        sqx += wqx * amp * si + w * amp * six;
        sqz += wqz * amp * si + w * amp * siz;
        st += w * amp * (r - sm);
        su += wu * amp * si;

        fgx += amp * ndx;
        fgz += amp * ndz;
        fxx += amp * freq * freq * n.dxx;
        fxz += amp * freq * freq * n.dxz;
        fzz += amp * freq * freq * n.dzz;

        amp *= 0.5;
        freq *= 2.0;
    }

    let rv = sv / cfg.relief_norm;
    let rqx = sqx / cfg.relief_norm;
    let rqz = sqz / cfg.relief_norm;
    let rt = st / cfg.relief_norm;
    let ru = su / cfg.relief_norm;

    let rpx = jxx * rqx + jzx * rqz + (rt * td + ru) * ux;
    let rpz = jxz * rqx + jzz * rqz + (rt * td + ru) * uz;

    (
        cfg.peak_height * up * rv,
        cfg.peak_height * (upd * ux * rv + up * rpx),
        cfg.peak_height * (upd * uz * rv + up * rpz),
    )
}

// ---- The boundary -------------------------------------------------------------------------------------------------

/// A grid's side at most, in samples: `OUT` holds three doubles a sample.
const MAX_SIDE: usize = 257;
static mut OUT: [f64; 3 * MAX_SIDE * MAX_SIDE] = [0.0; 3 * MAX_SIDE * MAX_SIDE];

#[inline(always)]
fn out() -> *mut f64 {
    core::ptr::addr_of_mut!(OUT) as *mut f64
}

/// Where results that are more than one double are left: a noise sample's six, a montane sample's three, a grid's.
#[no_mangle]
pub extern "C" fn out_ptr() -> *mut f64 {
    out()
}

/// The most samples a grid may hold.
#[no_mangle]
pub extern "C" fn out_samples() -> i32 {
    (MAX_SIDE * MAX_SIDE) as i32
}

/// Where the montane configs are written: `cfg_slots()` of them, `cfg_len()` doubles each.
#[no_mangle]
pub extern "C" fn cfg_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(CFG) as *mut f64
}

#[no_mangle]
pub extern "C" fn cfg_slots() -> i32 {
    SLOTS as i32
}

#[no_mangle]
pub extern "C" fn cfg_len() -> i32 {
    CFG_LEN as i32
}

#[no_mangle]
pub extern "C" fn hash2(x: f64, z: f64, seed: f64) -> f64 {
    hash2_of(x, z, seed)
}

#[no_mangle]
pub extern "C" fn hash3(x: f64, z: f64, i: f64, seed: f64) -> f64 {
    hash3_of(x, z, i, seed)
}

#[no_mangle]
pub extern "C" fn value_noise2(x: f64, z: f64, seed: f64) -> f64 {
    value_noise2_of(x, z, seed)
}

#[no_mangle]
pub extern "C" fn fbm2(x: f64, z: f64, seed: f64, octaves: i32) -> f64 {
    fbm2_of(x, z, seed, octaves)
}

#[inline(always)]
fn leave(n: Noise) -> f64 {
    let o = out();
    unsafe {
        *o = n.v;
        *o.add(1) = n.dx;
        *o.add(2) = n.dz;
        *o.add(3) = n.dxx;
        *o.add(4) = n.dxz;
        *o.add(5) = n.dzz;
    }
    n.v
}

/// The value, and all six of the sample at `out_ptr()`.
#[no_mangle]
pub extern "C" fn gradient_noise2(x: f64, z: f64, seed: f64) -> f64 {
    leave(gradient_noise2_of(x, z, seed))
}

/// The value, and all six of the sample at `out_ptr()`.
#[no_mangle]
pub extern "C" fn fbm2d(x: f64, z: f64, seed: f64, octaves: i32) -> f64 {
    leave(fbm2d_of(x, z, seed, octaves))
}

/// One montane sample of the config in `slot`: the height, and h, dx, dz at `out_ptr()`.
#[no_mangle]
pub extern "C" fn montane(slot: i32, seed: f64, x: f64, z: f64) -> f64 {
    let s = montane_of(&cfg_of(slot), seed, x, z);
    let o = out();
    unsafe {
        *o = s.0;
        *o.add(1) = s.1;
        *o.add(2) = s.2;
    }
    s.0
}

/// A grid of montane samples in one call, row by row along z: sample (i, j) is at (ox + i * step, oz + j * step),
/// its h, dx, dz at `out_ptr()` + 3 * (j * nx + i). Returns the samples written, 0 if the grid does not fit.
#[no_mangle]
pub extern "C" fn montane_grid(slot: i32, seed: f64, ox: f64, oz: f64, step: f64, nx: i32, nz: i32) -> i32 {
    if nx <= 0 || nz <= 0 || (nx as usize) * (nz as usize) > MAX_SIDE * MAX_SIDE {
        return 0;
    }
    let cfg = cfg_of(slot);
    let o = out();
    let mut k = 0usize;
    for j in 0..nz {
        for i in 0..nx {
            let s = montane_of(&cfg, seed, ox + (i as f64) * step, oz + (j as f64) * step);
            unsafe {
                *o.add(k) = s.0;
                *o.add(k + 1) = s.1;
                *o.add(k + 2) = s.2;
            }
            k += 3;
        }
    }
    nx * nz
}
