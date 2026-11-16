/**
 * The haunt's figures in their mask on Babylon Lite: a shade, a lunge or the
 * Hollow itself drawn as a flat shape through smoke of its own into a
 * target of its own, which the grade reads back through a wide blur and
 * darkens the frame by, as the game draws it on Babylon.js
 * (`shadeSilhouette.ts`, `shadeSmoke.ts`), from what the game draws it with
 * (`shadeMaskParams.ts`: the mask's size, a figure's colour and its smoke's
 * numbers; `entityPoses.ts`: how far in each figure is, how soft and how
 * near).
 *
 * - **A pass of the hike's own frame, before the scene's, on the frames with
 *   a figure in it.** The mask is a render task with a target, a camera and
 *   a list of its own: the figure's body, the Hollow's model less its eyes,
 *   each primitive drawn with the mask's material in place of its own. The
 *   camera is the frame's without the anti-aliasing's jitter, at the frame's
 *   own shape whatever the target's. A frame with no figure skips the pass
 *   whole, and the grade then reads none of the mask.
 * - **The body is drawn nowhere else.** On Babylon.js the mask's camera sees
 *   a layer the frame's does not. Lite has no layers and leaves a hidden
 *   mesh out of every pass, so the body stands shown, and its own material
 *   puts every vertex of it at one point outside the view: the frame's pass
 *   rasterises nothing of it (`unseenPlugin`).
 * - **One material for every figure, a figure's own values an instance's.**
 *   Babylon.js makes a material a figure and writes each its colour and its
 *   smoke's uniforms. Here every body is an instance of the model's one draw
 *   a primitive, and what differs between figures rides with the instance:
 *   its colour in the mask, its opacity there, how far in it is and where
 *   its feet stand. The smoke's clock is the frame's block's.
 * - **A texel is the mask material's**: the game's Standard material as the
 *   mask sets it (unlit, its emissive the figure's colour, blended always,
 *   both faces), with the smoke's code at its points: the outline swells
 *   along the normal in the vertex stage, and the fragment's alpha is the
 *   figure's opacity times what the smoke keeps. Under a post chain the
 *   colour is raised to 2.2 as Babylon.js's material hands it on in linear
 *   light; with no chain it is the material colour path's
 *   (`displayCurve.ts`), as it is there.
 * - **The eyes are not in the mask.** The game draws them there with the
 *   body; they lie on the head, which covers them.
 *
 * The target is the size Babylon.js gives a mask of the frame's
 * (`shadeMaskSize`) and follows it; it has no depth, since nothing but the
 * figures is in it and they write none.
 */
import {
  addMeshToTask, addTaskAtStart, addToScene, createBankedFreeCamera, createMeshFromData, createPbrMaterial, createRenderTarget, createRenderTask,
  disposeMeshGpu, markThinInstancePluginData, removeFromScene, removeMeshFromTask, setMeshVisible, setThinInstances, vec3,
  type BankedFreeCamera, type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type RenderTarget, type RenderTask,
  type SceneContext, type Task, type Texture2D,
} from "@babylonjs/lite";
import { HOLLOW_FIGURE_M } from "../hollowLook.js";
import {
  SHADE_SMOKE_FEET, SHADE_SMOKE_FRAY, SHADE_SMOKE_RISE, SHADE_SMOKE_SCALE, SHADE_SMOKE_SOFT, SHADE_SMOKE_SWELL_M, shadeMaskColour, shadeMaskSize,
} from "../shadeMaskParams.js";
import type { CameraAxes, CameraPose } from "./cameraPose.js";
import { DISPLAY_CURVE_WGSL } from "./displayCurve.js";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_BLOCK, FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, SHADE_SMOKE_TIME_NAME } from "./frameBlock.js";

const f = wgslFloat;

/** Floats a figure: (its red, its blue, its opacity, how far in it is), then (its feet's height, its own height, two unused). */
export const SHADE_LOOK_FLOATS = 8;

/** How far the mask's camera looks ahead of the eye for its target, metres. */
const LOOK_AHEAD = 10;

/** shadeSmokeNoise.fx: value noise in three dimensions on a hash, three octaves of it, and where a point is in the smoke at a time. */
export const SHADE_SMOKE_NOISE_WGSL = /* wgsl */ `
const SHADE_SMOKE_SCALE:f32=${f(SHADE_SMOKE_SCALE)};
const SHADE_SMOKE_RISE:f32=${f(SHADE_SMOKE_RISE)};
const SHADE_SMOKE_SOFT:f32=${f(SHADE_SMOKE_SOFT)};
const SHADE_SMOKE_FEET:f32=${f(SHADE_SMOKE_FEET)};
fn shadeSmokeHash(q:vec3<f32>)->f32{
  var p=fract(q*0.3183099+vec3<f32>(0.1,0.2,0.3));
  p*=17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
fn shadeSmokeNoise(x:vec3<f32>)->f32{
  let i=floor(x);
  var f=fract(x);
  f=f*f*(3.0-2.0*f);
  let n000=shadeSmokeHash(i);
  let n100=shadeSmokeHash(i+vec3<f32>(1.0,0.0,0.0));
  let n010=shadeSmokeHash(i+vec3<f32>(0.0,1.0,0.0));
  let n110=shadeSmokeHash(i+vec3<f32>(1.0,1.0,0.0));
  let n001=shadeSmokeHash(i+vec3<f32>(0.0,0.0,1.0));
  let n101=shadeSmokeHash(i+vec3<f32>(1.0,0.0,1.0));
  let n011=shadeSmokeHash(i+vec3<f32>(0.0,1.0,1.0));
  let n111=shadeSmokeHash(i+vec3<f32>(1.0,1.0,1.0));
  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z);
}
fn shadeSmokeFbm(p:vec3<f32>)->f32{
  var v=0.5*shadeSmokeNoise(p);
  v+=0.25*shadeSmokeNoise(p*2.03+vec3<f32>(1.7,9.2,4.4));
  v+=0.125*shadeSmokeNoise(p*4.01+vec3<f32>(8.3,2.8,6.1));
  return v/0.875;
}
fn shadeSmokeAt(world:vec3<f32>,seconds:f32)->vec3<f32>{
  return world*SHADE_SMOKE_SCALE+vec3<f32>(0.0,-seconds*SHADE_SMOKE_RISE*SHADE_SMOKE_SCALE,0.0);
}`;

/**
 * shadeSmokeWorldPos.vertex.fx: the outline swells and draws in along the
 * normal; then the clip position from the place it came to, which the
 * fragment reads too, and the figure's own values handed on.
 */
export const SHADE_SMOKE_VERTEX_WGSL = /* wgsl */ `{
  let shadeSmokeTime=${FRAME_BLOCK}.${SHADE_SMOKE_TIME_NAME};
  var w=out.worldPos;
  let shadeSmokeSwell=shadeSmokeFbm(shadeSmokeAt(w,shadeSmokeTime)*0.5+vec3<f32>(shadeSmokeTime*0.11,0.0,shadeSmokeTime*0.07))-0.5;
  w+=normalize(out.worldNormal)*shadeSmokeSwell*2.0*${f(SHADE_SMOKE_SWELL_M)};
  out.worldPos=w;
  out.clipPos=scene.viewProjection*vec4<f32>(w,1.0);
  out.vShadeLook=shadeLook;
  out.vShadeFeet=shadeFeet.xy;
}`;

/**
 * The mask's texel: Babylon.js's Standard material as the mask sets it (the
 * emissive alone, held to 0 to 1, in linear light), then
 * shadeSmokeColour.fragment.fx on its alpha. `linear`: a post chain grades
 * the frame, and the colour is handed on as it is; without one it goes
 * through the material colour path, as every Standard material's does there.
 */
export function shadeMaskFragmentWgsl(linear: boolean): string {
  return /* wgsl */ `{
  let shadeSmoke=vec4<f32>(input.vShadeLook.w,${FRAME_BLOCK}.${SHADE_SMOKE_TIME_NAME},input.vShadeFeet.x,input.vShadeFeet.y);
  let vPositionW=input.worldPos;
  let normalW=normalize(input.worldNormal);
  let viewDirectionW=normalize(scene.vEyePosition.xyz-vPositionW);
  var shadeColour=pow(clamp(vec3<f32>(input.vShadeLook.x,0.0,input.vShadeLook.y),vec3<f32>(0.0),vec3<f32>(1.0)),vec3<f32>(2.2));
  ${linear ? "" : `shadeColour=displayColour(shadeColour,${FRAME_BLOCK}.${FRAME_EXPOSURE_NAME},${FRAME_BLOCK}.${FRAME_CONTRAST_NAME});`}
  var shadeAlpha=input.vShadeLook.z;
  let shadeSmokeUp=clamp((vPositionW.y-shadeSmoke.z)/max(shadeSmoke.w,0.01),0.0,1.0);
  let shadeSmokeN=shadeSmokeFbm(shadeSmokeAt(vPositionW,shadeSmoke.y));
  let shadeSmokeCut=0.75*shadeSmokeN+0.25*shadeSmokeUp;
  let shadeSmokeIn=mix(-SHADE_SMOKE_SOFT,1.0+SHADE_SMOKE_SOFT,shadeSmoke.x);
  var shadeSmokeKeep=smoothstep(shadeSmokeCut-SHADE_SMOKE_SOFT,shadeSmokeCut+SHADE_SMOKE_SOFT,shadeSmokeIn);
  let shadeSmokeRim=1.0-abs(dot(normalW,viewDirectionW));
  let shadeSmokeFray=shadeSmokeFbm(shadeSmokeAt(vPositionW,shadeSmoke.y*1.7)*2.0+vec3<f32>(shadeSmoke.y*0.23,0.0,shadeSmoke.y*0.17));
  shadeSmokeKeep*=1.0-${f(SHADE_SMOKE_FRAY)}*smoothstep(0.35,0.9,shadeSmokeRim+(shadeSmokeFray-0.5)*0.9);
  shadeSmokeKeep*=smoothstep(0.0,SHADE_SMOKE_FEET,shadeSmokeUp);
  shadeAlpha*=shadeSmokeKeep;
  return vec4<f32>(shadeColour,shadeAlpha);
}`;
}

/** The mask's material's plugin: the smoke at its points, the figure's own values an instance's, the clock the frame's block's. */
export function shadeMaskPlugin(shared: PluginUniformBlock, linear: boolean): MaterialPlugin {
  return {
    name: "ShadeMask",
    priority: 990,
    defines: { linear },
    getCustomCode: (stage) =>
      stage === "vertex"
        ? { CUSTOM_VERTEX_DEFINITIONS: SHADE_SMOKE_NOISE_WGSL, CUSTOM_VERTEX_MAIN_END: SHADE_SMOKE_VERTEX_WGSL }
        : { CUSTOM_FRAGMENT_DEFINITIONS: `${SHADE_SMOKE_NOISE_WGSL}${linear ? "" : DISPLAY_CURVE_WGSL}`, CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: shadeMaskFragmentWgsl(linear) },
    getInstanceAttributes: () => [
      { name: "shadeLook", type: "vec4<f32>", format: "float32x4" as const, stride: SHADE_LOOK_FLOATS * 4, offset: 0 },
      { name: "shadeFeet", type: "vec4<f32>", format: "float32x4" as const, stride: SHADE_LOOK_FLOATS * 4, offset: 16 },
    ],
    getVaryings: () => [{ name: "vShadeLook", type: "vec4<f32>" }, { name: "vShadeFeet", type: "vec2<f32>" }],
    getUniformBlocks: () => [shared],
  };
}

/** A body's own material in the frame's pass: every vertex at one point outside the view, so nothing of it is rasterised. */
export function unseenPlugin(): MaterialPlugin {
  return {
    name: "Unseen",
    priority: 999,
    getCustomCode: (stage) => (stage === "vertex" ? { CUSTOM_VERTEX_MAIN_END: "out.clipPos=vec4<f32>(2.0,2.0,2.0,1.0);" } : null),
  };
}

/** A figure in the mask, as `entityPoses.ts` has it (`ShadeLook`), and where its feet stand. */
export type ShadeFigure = { fade: number; presence: number; soft: number; near: number; feetY: number };

const colour: [number, number, number] = [0, 0, 0];

/** Writes figure `index`'s values into `out`, `SHADE_LOOK_FLOATS` a figure; true where any changed. */
export function writeShadeLook(out: Float32Array, index: number, figure: ShadeFigure): boolean {
  shadeMaskColour(figure.soft, figure.near, colour);
  const at = index * SHADE_LOOK_FLOATS;
  let changed = false;
  const set = (i: number, value: number): void => {
    const sent = Math.fround(value);
    if (out[at + i] !== sent) {
      out[at + i] = sent;
      changed = true;
    }
  };
  set(0, colour[0]);
  set(1, colour[2]);
  set(2, figure.fade);
  set(3, figure.presence);
  set(4, figure.feetY);
  set(5, HOLLOW_FIGURE_M);
  return changed;
}

/** The mask as it stands in a scene. */
export type LiteShadeMask = {
  /** The mask's picture, for the grade or the veil to read: its view is the target's as it stands. */
  readonly texture: Texture2D;
  /** Whether any figure is in the mask this frame. */
  readonly any: boolean;
  /** Puts `mesh`, a primitive of the figure's body with room for `capacity` bodies, in the mask; its figures' values are `look`, which it keeps. */
  add(mesh: Mesh, capacity: number): Float32Array;
  remove(mesh: Mesh): void;
  /** The frame's figures are written (`writeShadeLook` into each mesh's values): `count` of them, `changed` where a value moved, `any` where one is in at all. */
  show(count: number, changed: boolean, any: boolean): void;
  /** The camera the mask is drawn from this frame: the frame's own, without its jitter. */
  place(pose: CameraPose, axes: CameraAxes, fov: number): void;
  /** Times the mask was asked to be drawn. */
  readonly draws: number;
  /** The mask's size as it stands. */
  readonly size: { readonly width: number; readonly height: number };
  dispose(): void;
};

/**
 * The mask of `scene`, made before the scene is registered. `linear`: a post
 * chain grades the frame. `near` and `far` are the frame's lens's planes.
 */
export function createLiteShadeMask(
  engine: EngineContext, scene: SceneContext, options: { shared: PluginUniformBlock; linear: boolean; near: number; far: number; fov: number },
): LiteShadeMask {
  const canvas = (engine as unknown as { canvas: { width: number; height: number } }).canvas;
  const size = shadeMaskSize(Math.max(1, canvas.width), Math.max(1, canvas.height));
  const target: RenderTarget = createRenderTarget({ lbl: "shade_mask", format: "rgba8unorm", samples: 1, size });
  const camera: BankedFreeCamera = createBankedFreeCamera(vec3(0, 0, 0), vec3(0, 0, LOOK_AHEAD), vec3(0, 1, 0));
  camera.fov = options.fov;
  camera.nearPlane = options.near;
  camera.farPlane = options.far;

  const material: PbrMaterialProps = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 });
  material.alphaBlend = true;
  material.doubleSided = true;
  material.plugins = [shadeMaskPlugin(options.shared, options.linear)];
  // Lite builds a mesh drawn with another material by the scene's own build of that material's kind, made when the
  // scene is registered, and that build draws instance lists only if a mesh of the scene had one then. The Hollow's
  // model lands long after. So one mesh that is never shown stands in the scene from the start with an instance list
  // of one: a triangle of no size.
  const seed = createMeshFromData(engine, "shade_mask_seed", new Float32Array(9), new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]));
  seed.material = material;
  setThinInstances(seed, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 1);
  if (seed.thinInstances !== undefined && seed.thinInstances !== null) seed.thinInstances.pluginData = new Float32Array(SHADE_LOOK_FLOATS);
  setMeshVisible(seed, false);
  addToScene(scene, seed);

  // The mask's size follows the frame's: read again whenever the frame's passes are recorded, ahead of the pass.
  const sizer: Task = {
    name: "shade mask size",
    engine,
    scene,
    record() {
      const next = shadeMaskSize(Math.max(1, canvas.width), Math.max(1, canvas.height));
      size.width = next.width;
      size.height = next.height;
    },
    execute: () => 0,
    dispose() {
      // Nothing of its own.
    },
  };
  (sizer as unknown as { _passes: unknown[] })._passes = [];
  const task: RenderTask = createRenderTask(
    // The frame's own shape whatever the target's, as the game's mask camera has it.
    { name: "shade_mask", rt: target, cam: camera, cs: true, clr: true, clrColor: { r: 0, g: 0, b: 0, a: 0 }, autoMirror: false },
    engine, scene,
  );
  task.enabled = false;
  // Before the hike's own pass, whose grade reads the mask in the same frame; the size before the pass.
  addTaskAtStart(scene, task);
  addTaskAtStart(scene, sizer);

  const looks = new Map<Mesh, Float32Array>();
  let any = false;
  let draws = 0;
  let disposed = false;
  const own = target as unknown as { _colorTexture: GPUTexture | null; _colorView: GPUTextureView | null };
  const texture = {
    get texture() {
      return own._colorTexture as GPUTexture;
    },
    get view() {
      return own._colorView as GPUTextureView;
    },
  } as unknown as Texture2D;

  return {
    texture,
    size,
    get any() {
      return any;
    },
    get draws() {
      return draws;
    },
    add(mesh, capacity) {
      const look = new Float32Array(capacity * SHADE_LOOK_FLOATS);
      if (disposed) return look;
      if (mesh.thinInstances !== undefined && mesh.thinInstances !== null) mesh.thinInstances.pluginData = look;
      looks.set(mesh, look);
      addMeshToTask(task, mesh, { material });
      return look;
    },
    remove(mesh) {
      if (disposed || !looks.delete(mesh)) return;
      removeMeshFromTask(task, mesh);
    },
    show(count, changed, anyNow) {
      if (disposed) return;
      if (changed && count > 0) for (const mesh of looks.keys()) markThinInstancePluginData(mesh, 0, count * SHADE_LOOK_FLOATS);
      any = anyNow && count > 0 && looks.size > 0;
      task.enabled = any;
      if (any) draws++;
    },
    place(pose, axes, fov) {
      camera.position.x = pose.x;
      camera.position.y = pose.y;
      camera.position.z = pose.z;
      camera.target.x = pose.x + axes.fx * LOOK_AHEAD;
      camera.target.y = pose.y + axes.fy * LOOK_AHEAD;
      camera.target.z = pose.z + axes.fz * LOOK_AHEAD;
      camera.upVector.x = axes.ux;
      camera.upVector.y = axes.uy;
      camera.upVector.z = axes.uz;
      camera.fov = fov;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of looks.keys()) removeMeshFromTask(task, mesh);
      looks.clear();
      task.enabled = false;
      any = false;
      removeFromScene(scene, seed);
      disposeMeshGpu(seed);
    },
  };
}
