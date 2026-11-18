/**
 * The sky's capture as the scene's image-based light on Babylon Lite: the
 * dome drawn into a cube of the scene's own (Lite's `createCustomEnvironment`),
 * which every PBR material of the scene reads its reflection of the sky
 * from.
 *
 * The cube is the probe's (`skyProbeParams.ts`): its size, its six layers
 * in the cube map's own layout, the world's axes as they stand, each face
 * drawn by a pass of this module's own with the dome's radiance
 * (`SKY_RADIANCE_WGSL`, the disc capped) as the probe sees it toward the
 * centre of each texel: from the world's origin, the dome riding with the
 * eye of the frame it is captured in (`probeDomeDirection`). It is captured
 * on the probe's schedule: again for each new sky state, all six faces at
 * once, submitted before the frame that reads them.
 *
 * What Babylon.js does with its probe, the cube does here:
 *
 * - **Linear light.** The game's probe holds the sky raised to 1/2.2, as a
 *   gamma-flagged texture that every material raises to 2.2 again; the cube
 *   holds the sky as it is, which Lite's materials read as it is.
 * - **One level.** Babylon.js reads a probe at its top level whatever a
 *   material's roughness, so the cube has no smaller levels and a material's
 *   roughness moves no lookup (a level-of-detail scale of 0).
 * - **No diffuse light.** No irradiance is worked for the game's probe:
 *   the cube's is left at zero.
 * - **The scene's share of it.** Babylon.js multiplies a material's own
 *   share of the image-based light (`environmentIntensity`, the trees'
 *   cut by the canopy) by the scene's, which the weather's dread collapses
 *   (`SceneLights.environmentIntensity`). Lite reads a material's own
 *   alone, so the scene's is drawn into the cube: the same product, and no
 *   material is written when it moves.
 *
 * The reflectance table the materials weigh the cube by is a file of the
 * game's (`environmentBrdf.png`). The cube goes with the scene.
 */
import { createCustomEnvironment, getGpuDevice, type CustomEnvironment, type EngineContext, type SceneContext, type Texture2D } from "@babylonjs/lite";
// The environment BRDF table of Babylon.js 9.18.0 (Apache-2.0), as that library ships it: the split sum of the
// reflectance over the view's angle and the roughness, 256 by 256, a PNG. Lite reads it from a URL: its bytes are
// carried in the page's chunk as a data URL.
import environmentBrdf from "./environmentBrdf.png?inline";
import { SKY_DOME_SIZE } from "../skyDomeParams.js";
import { SKY_PROBE_FACES, SKY_PROBE_SIZE } from "../skyProbeParams.js";
import type { Vec3 } from "../sky.js";
import type { SkyState } from "../skyState.js";
import { SKY_RADIANCE_WGSL } from "./skyDome.js";
import { wgslFloat } from "./forestPlugins.js";

/** WebGPU's buffer usages the capture's buffers take (`GPUBufferUsage`), by their values. */
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;

/** The sky's values a capture reads: six vectors, a scalar in the fourth place of each of the first four. */
const SKY_FLOATS = 24;
/** The bytes a capture writes: the sky's values. */
export const SKY_CAPTURE_BYTES = SKY_FLOATS * 4;

/**
 * The capture's pass: a triangle over the face, each fragment the dome's
 * radiance toward its texel's centre, times the scene's share. `sky` holds
 * the way to the sun and the table's scale, the deck's zenith and the
 * cloud, the night floor and the mist's weight, the air at the horizon and
 * the scene's share, the disc, and the eye the dome rides with; `face` the
 * face's axes. `probeDomeDirection` (`skyProbeParams.ts`) is
 * `skyProbeDome`, statement for statement.
 */
export const SKY_CAPTURE_WGSL = /* wgsl */ `
struct Sky{sunDir:vec4<f32>,deckZenith:vec4<f32>,night:vec4<f32>,mistAir:vec4<f32>,disc:vec4<f32>,eye:vec4<f32>}
struct Face{normal:vec4<f32>,across:vec4<f32>,down:vec4<f32>}
@group(0)@binding(0)var<uniform>sky:Sky;
@group(0)@binding(1)var skyTable:texture_2d<f32>;
@group(0)@binding(2)var skyTableSampler:sampler;
@group(0)@binding(3)var<uniform>face:Face;
${SKY_RADIANCE_WGSL}
const SKY_DOME_HALF:f32=${wgslFloat(SKY_DOME_SIZE / 2)};
fn skyProbeDome(ray:vec3<f32>,eye:vec3<f32>)->vec3<f32>{
  let along=select(vec3<f32>(3.0e38),(eye+sign(ray)*SKY_DOME_HALF)/ray,abs(ray)>vec3<f32>(1.0e-8));
  let t=min(along.x,min(along.y,along.z));
  return normalize(ray*t-eye);
}
@vertex fn faceVertex(@builtin(vertex_index)i:u32)->@builtin(position)vec4<f32>{
  var corners=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
  return vec4<f32>(corners[i],0.0,1.0);
}
@fragment fn faceFragment(@builtin(position)at:vec4<f32>)->@location(0)vec4<f32>{
  let a=2.0*at.x/${wgslFloat(SKY_PROBE_SIZE)}-1.0;
  let b=2.0*at.y/${wgslFloat(SKY_PROBE_SIZE)}-1.0;
  let d=skyProbeDome(normalize(face.normal.xyz+face.across.xyz*a+face.down.xyz*b),sky.eye.xyz);
  let radiance=skyRadiance(d,sky.sunDir.xyz,sky.sunDir.w,sky.deckZenith.w,sky.deckZenith.xyz,sky.night.xyz,sky.disc.xyz,sky.mistAir.xyz,sky.night.w,1.0);
  return vec4<f32>(radiance*sky.mistAir.w,1.0);
}`;

/**
 * The sky's values for a capture of `s` at the scene's `share` with the eye
 * at `eye`, as the pass reads them, into `out`: the table's scale is 1, the
 * slice going up already in the scene's units with the dome's
 * (`skyDome.ts`).
 */
export function skyCaptureValues(s: SkyState, share: number, eye: Vec3, out: Float32Array = new Float32Array(SKY_FLOATS)): Float32Array {
  out[0] = s.sunDir.x;
  out[1] = s.sunDir.y;
  out[2] = s.sunDir.z;
  out[3] = 1;
  out[4] = s.deckZenith.r;
  out[5] = s.deckZenith.g;
  out[6] = s.deckZenith.b;
  out[7] = s.cloud;
  out[8] = s.nightFloor.r;
  out[9] = s.nightFloor.g;
  out[10] = s.nightFloor.b;
  out[11] = s.mistWeight;
  out[12] = s.mistAir.r;
  out[13] = s.mistAir.g;
  out[14] = s.mistAir.b;
  out[15] = share;
  out[16] = s.discColour.r;
  out[17] = s.discColour.g;
  out[18] = s.discColour.b;
  out[19] = 0;
  out[20] = eye.x;
  out[21] = eye.y;
  out[22] = eye.z;
  out[23] = 0;
  return out;
}

/** A face's axes as the pass reads them: three vectors, each padded to four. */
export function faceValues(face: number): Float32Array {
  const f = SKY_PROBE_FACES[face];
  if (f === undefined) throw new Error(`a cube has six faces: ${face} is not one`);
  return Float32Array.from([f.normal.x, f.normal.y, f.normal.z, 0, f.across.x, f.across.y, f.across.z, 0, f.down.x, f.down.y, f.down.z, 0]);
}

/** The capture as it stands in a scene. */
export type LiteSkyCapture = {
  readonly environment: CustomEnvironment;
  /** Draws the six faces for `s` at the scene's `share` of the image-based light, the dome round `eye`, and hands the
   * cube to the materials. */
  capture(s: SkyState, share: number, eye: Vec3): void;
};

/**
 * The capture of the dome whose table is `table`, as `scene`'s environment:
 * made before the scene is registered, as Lite's environments are. Nothing
 * is lit by it until the first capture.
 */
export async function createLiteSkyCapture(engine: EngineContext, scene: SceneContext, table: Texture2D): Promise<LiteSkyCapture> {
  const environment = await createCustomEnvironment(scene, { size: SKY_PROBE_SIZE, brdfUrl: environmentBrdf, lodGenerationScale: 0, mipmaps: false });
  // The capture's passes are drawn on the engine's device, as Lite's own are.
  const device = getGpuDevice(engine);
  const module = device.createShaderModule({ label: "sky capture", code: SKY_CAPTURE_WGSL });
  const pipeline = device.createRenderPipeline({
    label: "sky capture",
    layout: "auto",
    vertex: { module, entryPoint: "faceVertex" },
    fragment: { module, entryPoint: "faceFragment", targets: [{ format: "rgba16float" }] },
  });
  const values = new Float32Array(SKY_FLOATS);
  const skyBuffer = device.createBuffer({ label: "sky capture", size: SKY_CAPTURE_BYTES, usage: UNIFORM | COPY_DST });
  const groups = SKY_PROBE_FACES.map((_, face) => {
    const axes = faceValues(face);
    const faceBuffer = device.createBuffer({ label: `sky capture face ${face}`, size: axes.byteLength, usage: UNIFORM, mappedAtCreation: true });
    new Float32Array(faceBuffer.getMappedRange()).set(axes);
    faceBuffer.unmap();
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: skyBuffer } },
        { binding: 1, resource: table.view },
        { binding: 2, resource: table.sampler },
        { binding: 3, resource: { buffer: faceBuffer } },
      ],
    });
  });

  return {
    environment,
    capture(s, share, eye) {
      device.queue.writeBuffer(skyBuffer, 0, skyCaptureValues(s, share, eye, values));
      const encoder = device.createCommandEncoder({ label: "sky capture" });
      for (let face = 0; face < groups.length; face++) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: environment.faceViews[face] as GPUTextureView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, groups[face] as GPUBindGroup);
        pass.draw(3);
        pass.end();
      }
      device.queue.submit([encoder.finish()]);
      // No polynomial: the probe gives no diffuse light.
      environment.update();
    },
  };
}
