// One direction of the wind sea's inverse FFT (oceanGpuFft.ts): a workgroup
// a line of N values, every line of every layer in one dispatch. The line is
// read into workgroup memory, transformed by a radix-2 Stockham FFT of
// STAGES stages, each reading one half of the scratch and writing the other
// with a barrier between, and written back in place. Each value is a vec4,
// two complex values that share every twiddle. It mirrors fftInverseLine in
// oceanFft.ts: the lines marked stockham are the same as its own.

const N: u32 = 256u;
const HALF: u32 = 128u;
const STAGES: u32 = 8u;
const PI: f32 = 3.14159265358979;

@group(0) @binding(0) var<storage, read_write> spectra: array<vec4<f32>>;

// Two halves of N vec4: 2 x 256 x 16 bytes = 8 KiB, inside the 16 KiB a workgroup may hold.
var<workgroup> scratch: array<vec4<f32>, 512>;

fn complexTimes(a: vec2<f32>, w: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * w.x - a.y * w.y, a.x * w.y + a.y * w.x);
}

fn transform(j: u32, offset: u32, stride: u32) {
  scratch[j] = spectra[offset + j * stride];
  scratch[j + HALF] = spectra[offset + (j + HALF) * stride];
  workgroupBarrier();
  for (var stage = 0u; stage < STAGES; stage++) {
    let src = (stage & 1u) * N; // stockham: src
    let dst = N - src; // stockham: dst
    let span = 1u << stage; // stockham: span
    let r = j & (span - 1u); // stockham: r
    let angle = (PI * f32(r)) / f32(span); // stockham: angle
    let dest = ((j >> stage) << (stage + 1u)) + r; // stockham: dest
    let w = vec2<f32>(cos(angle), sin(angle));
    let a = scratch[src + j];
    let c = scratch[src + j + HALF];
    let b = vec4<f32>(complexTimes(c.xy, w), complexTimes(c.zw, w));
    scratch[dst + dest] = a + b;
    scratch[dst + dest + span] = a - b;
    workgroupBarrier();
  }
  let out = (STAGES & 1u) * N;
  spectra[offset + j * stride] = scratch[out + j];
  spectra[offset + (j + HALF) * stride] = scratch[out + j + HALF];
}

// Workgroup (line, layer): the line's N values are consecutive.
@compute @workgroup_size(128, 1, 1)
fn rows(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) j: u32) {
  transform(j, group.y * N * N + group.x * N, 1u);
}

// Workgroup (column, layer): the column's N values are N apart.
@compute @workgroup_size(128, 1, 1)
fn columns(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) j: u32) {
  transform(j, group.y * N * N + group.x, N);
}
