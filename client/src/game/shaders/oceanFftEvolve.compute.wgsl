// The wind sea's spectra at one time, one invocation a bin of each cascade
// (oceanGpuFft.ts). It mirrors evolveSpectrum in oceanFft.ts: each bin's
// starting amplitude turned by its frequency, and from it the eight fields,
// packed two real fields to a complex value, so that the inverse FFT of
// a + i b is a(x) + i b(x). Layer 2c of the spectra holds
// (height + i dx, dz + i slopeX), layer 2c + 1 (slopeZ + i ddx/dx,
// ddz/dz + i ddx/dz).

const N: u32 = 256u;
const PI: f32 = 3.14159265358979;

struct Params {
  // x: seconds folded into the sea's repeat, y: the choppiness.
  time: vec4<f32>,
  // The cascades' sizes, metres.
  sizes: vec4<f32>,
};

// Per bin: (h0 real, h0 imaginary, omega, 0), cascade by cascade.
@group(0) @binding(0) var<storage, read> h0: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> spectra: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

// FFT order: 0 .. N/2 - 1, then -N/2 .. -1.
fn waveIndex(m: u32) -> f32 {
  return select(f32(m), f32(m) - f32(N), m >= N / 2u);
}

// i times a.
fn timesI(a: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(-a.y, a.x);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let col = id.x;
  let row = id.y;
  let cascade = id.z;
  let base = cascade * N * N;
  let here = h0[base + row * N + col];
  let there = h0[base + ((N - row) % N) * N + (N - col) % N];
  // The phase folded to one turn before the sine, which is exact only near zero.
  let phase = 2.0 * PI * fract(here.z * params.time.x / (2.0 * PI));
  let c = cos(phase);
  let s = sin(phase);
  // h0(k) e^(-i w t) + conj(h0(-k)) e^(i w t)
  let h = vec2<f32>(
    here.x * c + here.y * s + there.x * c + there.y * s,
    here.y * c - here.x * s + there.x * s - there.y * c,
  );
  let dk = 2.0 * PI / params.sizes[cascade];
  let kx = dk * waveIndex(col);
  let kz = dk * waveIndex(row);
  let k = length(vec2<f32>(kx, kz));
  let inverse = select(0.0, 1.0 / k, k > 0.0);
  let ux = kx * inverse;
  let uz = kz * inverse;
  let ih = timesI(h);
  let dx = ux * ih;
  let dz = uz * ih;
  let sx = kx * ih;
  let sz = kz * ih;
  let dxdx = -kx * ux * h;
  let dzdz = -kz * uz * h;
  let dxdz = -kx * uz * h;
  let at = cascade * 2u * N * N + row * N + col;
  spectra[at] = vec4<f32>(h + timesI(dx), dz + timesI(sx));
  spectra[at + N * N] = vec4<f32>(sz + timesI(dxdx), dzdz + timesI(dxdz));
}
