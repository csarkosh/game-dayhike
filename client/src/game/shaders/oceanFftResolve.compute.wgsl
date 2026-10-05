// The wind sea's fields out of the transformed spectra, one invocation a
// texel of each cascade (oceanGpuFft.ts): disp holds (height, dx, dz,
// Jacobian) with the displacement scaled by the choppiness, slope holds
// (slopeX, slopeZ, 0, 0), a layer a cascade. It mirrors windSeaFields in
// oceanFft.ts.

const N: u32 = 256u;

struct Params {
  // x: seconds folded into the sea's repeat, y: the choppiness.
  time: vec4<f32>,
  // The cascades' sizes, metres.
  sizes: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> spectra: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var disp: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var slope: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let z = id.y;
  let cascade = id.z;
  let at = cascade * 2u * N * N + z * N + x;
  // (height, dx, dz, slopeX) and (slopeZ, ddx/dx, ddz/dz, ddx/dz)
  let a = spectra[at];
  let b = spectra[at + N * N];
  let l = params.time.y;
  let jacobian = (1.0 + l * b.y) * (1.0 + l * b.z) - l * l * b.w * b.w;
  textureStore(disp, vec2<u32>(x, z), cascade, vec4<f32>(a.x, l * a.y, l * a.z, jacobian));
  textureStore(slope, vec2<u32>(x, z), cascade, vec4<f32>(a.w, b.x, 0.0, 0.0));
}
