/**
 * The post chain on Babylon Lite: the scene drawn in linear light into a
 * half-float target, four samples a pixel, and the game's passes over it in
 * the game's order (`postFrame.ts`: `postPasses`), each the game's shader in
 * WGSL (`postWgsl.ts`) fed the game's own uniforms. What it is drawn with is
 * made with no engine: the tier's passes and constants (`postParams.ts`),
 * the grade's record (`gradeParams.ts`), each pass's uniforms and the state
 * that runs from frame to frame (`postFrame.ts`); the shell on Babylon.js
 * (`post.ts`) takes its values from the same modules.
 *
 * **The passes are one task of the scene's frame**, after the scene's own
 * pass, drawn by this module on the engine's device with the frame's own
 * encoder: a triangle a pass. A frame of the medium tier is the depth's
 * resolve, the far softening (which marches the ground cloud once a pixel,
 * where it has density), the anti-aliasing, its sharpen, the paint at half
 * size and the grade, which composes the strokes as it reads them and
 * writes the canvas: six triangles, where the game's chain draws six and
 * a seventh for the frame the grade reads from on the tier with the
 * halation. That tier adds the extract and the two blurs at a quarter of
 * the frame. The lens is a pass only while there is rain on the glass, and
 * the grade then writes a target for it to read.
 *
 * **Every uniform of the chain is one buffer, written once a frame**: each
 * pass reads its own part of it, laid out from the record its values come
 * in. The materials read none of it.
 *
 * **The targets are the frame's size and follow it.** The scene's pass owns
 * its two (the samples and their resolve), which stand while the frame's
 * size does (`keep`); the chain's own are made for those, and again only
 * when those are, which is when the canvas's size changes: the
 * anti-aliasing starts a new history then. Lite records the frame's passes
 * at other times too (a hiker's lamp joining the scene's lights, the
 * scene's first builds), and such a recording makes no texture and leaves
 * the history as it stands (`chainTargetsStand`). The sharpen
 * writes over the scene's resolve, which nothing reads after the far
 * softening, and the grade's frame for the lens is the far softening's
 * target, which nothing reads after the anti-aliasing: a frame holds the
 * samples, their resolve, the depth's resolve (two bytes a pixel), the far
 * softening's frame, the two histories and the half-size strokes.
 *
 * **The jitter is the camera's projection hook**: a step along the walk a
 * frame (`TaaFrame.jitter`), which every draw of the scene's pass is seen
 * through and no other pass.
 */
import {
  addTask, createCustomTask, createRenderTarget, createRenderTask, getFrameEncoder, getGpuDevice, getProjectionMatrix, getRenderTargetAttachments,
  type BankedFreeCamera, type EngineContext, type RenderTarget, type RenderTargetAttachments, type RenderTask, type SceneContext, type Task, type Texture2D,
} from "@babylonjs/lite";
import type { AtmosphereUniforms } from "../atmosphereParams.js";
import { emptyCloudUniforms, type CloudUniforms } from "../cloudParams.js";
import { gradeRecordUnder, type GradeRecord, type PaintPalette } from "../gradeParams.js";
import { LENS, lensDropletMap } from "../lensParams.js";
import {
  HALATION_KERNEL, HALATION_RATIO, composeUniforms, createLensGate, createPaletteFade, createTaaFrame, emptyFarSoftUniforms, emptyGradeUniforms,
  emptyTaaUniforms, extractUniforms, farSoftUniforms, gradeUniforms, lensUniforms, paintUniforms, paintUniformsDrawn, sharpenUniforms, type PostView,
} from "../postFrame.js";
import { MSAA_SAMPLES, paintTargetSize, type PostFeatures } from "../postParams.js";
import type { StareLens } from "../stareLens.js";
import { WEATHER_PRESETS, type WeatherParams } from "../weather.js";
import type { FrameUploads } from "./frameUploads.js";
import {
  FAR_SOFT_WGSL, HALATION_EXTRACT_WGSL, LENS_WGSL, PAINT_WGSL, POST_VERTEX_WGSL, TAA_SHARPEN_WGSL, TAA_WGSL, blurWgsl, depthResolveWgsl, gradeWgsl, passLayout,
  writePass, type PassLayout,
} from "./postWgsl.js";

/** The format of every frame the chain's passes hand on, as the game's: half floats. */
export const POST_FORMAT = "rgba16float";
/** The scene's depth buffer, which the chain reads. */
export const POST_DEPTH_FORMAT = "depth24plus";
/** The depth's resolve: one half float a pixel, the distance along the view in metres. */
export const POST_DEPTH_RESOLVE_FORMAT = "r16float";
/** A pass's part of the chain's buffer starts at a multiple of this many bytes, as a bound buffer's offset must. */
export const POST_SECTION_BYTES = 256;

/** WebGPU's usages, by their values. */
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const RENDER_ATTACHMENT = 0x10;

/** The air's uniforms the far softening reads beside the cloud's own: the way to the sun and its colour. */
type CloudSun = Pick<AtmosphereUniforms, "atmSunDir" | "atmSunColour">;

/** The uniforms of every pass, each a record by name: the order is the buffer's. */
function sections(features: PostFeatures) {
  const far = { ...emptyFarSoftUniforms(), atmSunDir: [0, 0, 0], atmSunColour: [0, 0, 0], ...emptyCloudUniforms() };
  const grade = { ...emptyGradeUniforms(), ...composeUniforms(2, 2) };
  return {
    depth: { depthTerms: [0, 0] },
    farSoft: far,
    taa: emptyTaaUniforms(),
    taaSharpen: sharpenUniforms(1, 1),
    paint: paintUniforms(features.paint, 2, 2),
    grade,
    lens: lensUniforms(0, 0, 1, 1),
    ...(features.halation
      ? {
        halationExtract: { ...extractUniforms(gradeRecordUnder(WEATHER_PRESETS.clear, 12, 0, 1)), ...composeUniforms(2, 2), texel: [0, 0] },
        halationBlurX: { delta: [0, 0] },
        halationBlurY: { delta: [0, 0] },
      }
      : {}),
  };
}

type Sections = ReturnType<typeof sections>;
type SectionName = keyof Sections;

/** What a frame's passes were, for whoever counts them. */
export type PostChainCounts = {
  /** Full-screen triangles drawn by the last frame, the scene's own pass aside. */
  passes: number;
  /** Whether the last frame drew the lens. */
  lens: boolean;
  /** Bytes of the chain's buffer, written once a frame. */
  uniformBytes: number;
  /** Times the chain's own targets were made: once a size of the frame. */
  builds: number;
  /** The chain's own targets as they stand: a name, a size and a format each. */
  targets: readonly { name: string; width: number; height: number; format: string; samples: number }[];
};

export type LitePostChain = {
  readonly features: PostFeatures;
  /** The frame's grade and the rain on the lens, as `Post.update` takes them (`post.ts`). */
  update(weather: WeatherParams, hour: number, night: number, unsettle: number, stare: StareLens, lens?: number, chase?: number): void;
  setPalette(palette: PaintPalette, fadeSeconds?: number): void;
  palette(): PaintPalette;
  /** The haunt's mask to read the shades from, and whether any shade is in it this frame. */
  setShades(mask: Texture2D | null, any: boolean): void;
  /**
   * The frame seen through `view`: the jitter's next step on the camera's
   * projection, and every pass's uniforms into the one buffer. `air` holds
   * the sun as the cloud's glow reads it, `cloud` the cloud as the chain
   * marches it this frame (`cloudUniforms`).
   */
  frame(view: PostView, air: CloudSun, cloud: CloudUniforms): void;
  readonly counts: PostChainCounts;
  /** The record the last `update` made. */
  readonly record: GradeRecord;
  /** Lets go of the chain's own targets and buffer; the scene's pass and its targets go with the scene. */
  dispose(): void;
};

export type PostChainOptions = {
  features: PostFeatures;
  /** The hike's camera, whose projection the jitter is laid on. */
  camera: BankedFreeCamera;
  /** The ground cloud's map (`cloudNoiseMap` with the ground laid in), repeating, read bilinearly. */
  cloudMap: Texture2D;
  /** The clock (ms) the effects' motion reads: the renderer's. */
  now?: () => number;
  uploads?: FrameUploads;
};

type Target = { texture: GPUTexture; view: GPUTextureView; width: number; height: number; format: GPUTextureFormat; name: string };

/**
 * Whether the chain's own targets still fit the scene's: they were made for
 * the scene's depth and resolve `made` (null: none are made), and `depth`
 * and `resolve` are the scene's as they now stand. Lite makes a target's
 * texture and view again only when it makes the target again, so the same
 * two objects are the same frame's size, and whatever the chain's groups
 * bound of them is still what is drawn into.
 */
export function chainTargetsStand<D, V>(made: { readonly depth: D; readonly resolve: V } | null, depth: D | null, resolve: V | null): boolean {
  return made !== null && depth !== null && resolve !== null && made.depth === depth && made.resolve === resolve;
}

/**
 * The chain of `scene`, which was made with no pass of its own
 * (`defaultRenderTask: false`): the scene's pass into the chain's first
 * target, then the chain's task. Made before the scene is registered. A
 * tier with no chain has none: `features.pipeline` is refused.
 */
export function createLitePostChain(engine: EngineContext, scene: SceneContext, options: PostChainOptions): LitePostChain {
  const { features, camera } = options;
  if (!features.pipeline || !features.taa || features.paint <= 0) throw new Error("the post chain is a tier's with the far softening, the anti-aliasing and the paint");
  const now = options.now ?? (() => performance.now());
  const start = now();
  const device = getGpuDevice(engine);
  const surface = engine;
  /** The canvas's own target and the scene's resolve as they stand in a frame, each read into its one record. */
  const canvasNow = {} as RenderTargetAttachments;
  const resolvedNow = {} as RenderTargetAttachments;

  // The scene's pass: linear, half floats, the tier's samples a pixel, resolved at its end; its depth kept for the chain.
  // Its targets stand while the frame's size does: a recording of the frame's passes that is no resize makes none again.
  const frameSize = { surface: engine, scale: 1 };
  const samples: RenderTarget = createRenderTarget({ lbl: "post_scene", format: POST_FORMAT, dFormat: POST_DEPTH_FORMAT, samples: MSAA_SAMPLES, size: frameSize, keep: true });
  const resolved: RenderTarget = createRenderTarget({ lbl: "post_scene_resolved", format: POST_FORMAT, samples: 1, size: frameSize, keep: true });
  const sceneTask: RenderTask = createRenderTask({ name: "scene", rt: samples, rst: resolved, clr: true }, engine, scene);
  addTask(scene, sceneTask);

  // The chain's one buffer, a part a pass.
  const records: Sections = sections(features);
  const names = Object.keys(records) as SectionName[];
  const layouts = new Map<SectionName, { layout: PassLayout; offset: number }>();
  let bytes = 0;
  for (const name of names) {
    const layout = passLayout(records[name] as Record<string, ArrayLike<number>>);
    if (layout.bytes > POST_SECTION_BYTES * 2) throw new Error(`the ${name} pass's uniforms are ${layout.bytes} bytes: more than a part of the chain's buffer holds`);
    layouts.set(name, { layout, offset: bytes });
    bytes += Math.ceil(layout.bytes / POST_SECTION_BYTES) * POST_SECTION_BYTES;
  }
  const data = new Float32Array(bytes / 4);
  const buffer = device.createBuffer({ label: "post chain", size: bytes, usage: UNIFORM | COPY_DST });
  const part = (name: SectionName): { layout: PassLayout; offset: number } => layouts.get(name) as { layout: PassLayout; offset: number };
  const write = (name: SectionName, record: Readonly<Record<string, ArrayLike<number>>>): void => {
    const { layout, offset } = part(name);
    writePass(data, offset / 4, layout, record);
  };

  // A pipeline a pass: the shared triangle, the pass's uniforms as its struct, its fragment.
  const pipeline = (name: SectionName, fragment: string, format: GPUTextureFormat): GPURenderPipeline => {
    const module = device.createShaderModule({ label: `post ${name}`, code: `${part(name).layout.struct}\n${POST_VERTEX_WGSL}\n${fragment}` });
    return device.createRenderPipeline({
      label: `post ${name}`,
      layout: "auto",
      vertex: { module, entryPoint: "postVertex" },
      fragment: { module, entryPoint: "postFragment", targets: [{ format }] },
    });
  };
  const pipelines = {
    depth: pipeline("depth", depthResolveWgsl(MSAA_SAMPLES), POST_DEPTH_RESOLVE_FORMAT),
    farSoft: pipeline("farSoft", FAR_SOFT_WGSL, POST_FORMAT),
    taa: pipeline("taa", TAA_WGSL, POST_FORMAT),
    taaSharpen: pipeline("taaSharpen", TAA_SHARPEN_WGSL, POST_FORMAT),
    paint: pipeline("paint", PAINT_WGSL, POST_FORMAT),
    grade: pipeline("grade", gradeWgsl(features.halation), surface.format),
    // The grade's frame for the lens to read: half floats, as the game's.
    gradeForLens: null as GPURenderPipeline | null,
    lens: null as GPURenderPipeline | null,
    halationExtract: features.halation ? pipeline("halationExtract" as SectionName, HALATION_EXTRACT_WGSL, POST_FORMAT) : null,
    halationBlurX: features.halation ? pipeline("halationBlurX" as SectionName, blurWgsl(HALATION_KERNEL), POST_FORMAT) : null,
    halationBlurY: features.halation ? pipeline("halationBlurY" as SectionName, blurWgsl(HALATION_KERNEL), POST_FORMAT) : null,
  };
  const linear = device.createSampler({ label: "post", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const repeat = device.createSampler({ label: "post repeat", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
  // A black texel for the shades' reads while no mask is bound: none is made under the gate.
  const black = device.createTexture({ label: "post black", size: { width: 1, height: 1 }, format: "rgba8unorm", usage: TEXTURE_BINDING | TEXTURE_COPY_DST });
  device.queue.writeTexture({ texture: black }, new Uint8Array([0, 0, 0, 255]), {}, { width: 1, height: 1 });
  const blackView = black.createView();
  /** The lens's droplet map, made with the lens's first rain. */
  let droplets: GPUTexture | null = null;

  // The chain's own targets, made when the frame's passes are recorded.
  let targets: Record<"depth" | "far" | "historyA" | "historyB" | "paint", Target> | null = null;
  let quarter: [Target, Target] | null = null;
  let depthSamples: GPUTextureView | null = null;
  /** The scene's depth and resolve the chain's targets and groups were made for (`chainTargetsStand`). */
  let madeFor: { depth: GPUTexture; resolve: GPUTextureView } | null = null;
  let groups: {
    depth: GPUBindGroup; farSoft: GPUBindGroup; taa: [GPUBindGroup, GPUBindGroup]; taaSharpen: [GPUBindGroup, GPUBindGroup]; paint: GPUBindGroup;
    halationExtract: GPUBindGroup | null; halationBlurX: GPUBindGroup | null; halationBlurY: GPUBindGroup | null;
  } | null = null;
  /** The grade's and the lens's groups, made again when the mask they read changes or the lens first runs. */
  let gradeGroup: GPUBindGroup | null = null;
  let gradeLensGroup: GPUBindGroup | null = null;
  let lensGroup: GPUBindGroup | null = null;
  let shadeMask: Texture2D | null = null;
  let shadeBound: Texture2D | null | undefined;
  let shadeAny = false;
  let disposed = false;

  const taaFrame = createTaaFrame();
  const lensGate = createLensGate();
  const paletteFade = createPaletteFade(now);
  let record: GradeRecord = gradeRecordUnder(WEATHER_PRESETS.clear, 12, 0, 1);
  let ditherSeconds = 0;
  let lensStrength = 0;
  let lensOn = false;
  /** Which history the anti-aliasing writes this frame. */
  let flip = 0;
  const jitter = { x: 0, y: 0 };
  camera.projectionHook = (projection) => {
    projection[8] = (projection[8] as number) + jitter.x;
    projection[9] = (projection[9] as number) + jitter.y;
  };
  const counts: { passes: number; lens: boolean; uniformBytes: number; builds: number; targets: PostChainCounts["targets"] } = { passes: 0, lens: false, uniformBytes: bytes, builds: 0, targets: [] };

  const target = (name: string, width: number, height: number, format: GPUTextureFormat): Target => {
    const texture = device.createTexture({ label: `post_${name}`, size: { width, height }, format, usage: RENDER_ATTACHMENT | TEXTURE_BINDING });
    return { texture, view: texture.createView(), width, height, format, name };
  };
  const release = (): void => {
    if (targets !== null) for (const t of Object.values(targets)) t.texture.destroy();
    if (quarter !== null) for (const t of quarter) t.texture.destroy();
    targets = null;
    quarter = null;
    madeFor = null;
    groups = null;
    gradeGroup = null;
    gradeLensGroup = null;
    lensGroup = null;
  };
  const uniforms = (name: SectionName): GPUBindingResource => ({ buffer, offset: part(name).offset, size: part(name).layout.bytes });
  const group = (made: GPURenderPipeline, entries: GPUBindingResource[]): GPUBindGroup =>
    device.createBindGroup({ layout: made.getBindGroupLayout(0), entries: entries.map((resource, binding) => ({ binding, resource })) });

  /**
   * The targets and the groups that read them, for the frame's size as the scene's pass has just made its own; nothing
   * where the scene's own stand as they were, so the history the anti-aliasing has gathered is kept.
   */
  function build(): void {
    const own = getRenderTargetAttachments(samples);
    const scene = getRenderTargetAttachments(resolved).colorView;
    if (chainTargetsStand(madeFor, own.depthTexture, scene)) return;
    release();
    if (own.depthTexture === null || scene === null) return;
    madeFor = { depth: own.depthTexture, resolve: scene };
    counts.builds++;
    const { width, height } = own;
    const half = paintTargetSize(width, height);
    targets = {
      depth: target("depth", width, height, POST_DEPTH_RESOLVE_FORMAT),
      far: target("far", width, height, POST_FORMAT),
      historyA: target("history_a", width, height, POST_FORMAT),
      historyB: target("history_b", width, height, POST_FORMAT),
      paint: target("paint", half.width, half.height, POST_FORMAT),
    };
    depthSamples = own.depthTexture.createView();
    const histories = [targets.historyA, targets.historyB] as const;
    if (features.halation) {
      const w = Math.max(1, Math.floor(width * HALATION_RATIO));
      const h = Math.max(1, Math.floor(height * HALATION_RATIO));
      quarter = [target("halation_a", w, h, POST_FORMAT), target("halation_b", w, h, POST_FORMAT)];
    }
    groups = {
      depth: group(pipelines.depth, [uniforms("depth"), depthSamples]),
      farSoft: group(pipelines.farSoft, [uniforms("farSoft"), linear, scene, targets.depth.view, options.cloudMap.view, repeat]),
      // Writing history `flip`, the anti-aliasing reads the other; the sharpen then reads the one just written.
      taa: [0, 1].map((to) => group(pipelines.taa, [uniforms("taa"), linear, (targets as NonNullable<typeof targets>).far.view, (histories[1 - to] as Target).view, (targets as NonNullable<typeof targets>).depth.view])) as [GPUBindGroup, GPUBindGroup],
      taaSharpen: [0, 1].map((from) => group(pipelines.taaSharpen, [uniforms("taaSharpen"), linear, (histories[from] as Target).view])) as [GPUBindGroup, GPUBindGroup],
      paint: group(pipelines.paint, [uniforms("paint"), linear, scene]),
      halationExtract: pipelines.halationExtract === null ? null : group(pipelines.halationExtract, [uniforms("halationExtract" as SectionName), linear, scene, targets.paint.view]),
      halationBlurX: pipelines.halationBlurX === null || quarter === null ? null : group(pipelines.halationBlurX, [uniforms("halationBlurX" as SectionName), linear, quarter[0].view]),
      halationBlurY: pipelines.halationBlurY === null || quarter === null ? null : group(pipelines.halationBlurY, [uniforms("halationBlurY" as SectionName), linear, quarter[1].view]),
    };
    shadeBound = undefined;
    taaFrame.reset();
    counts.targets = [
      { name: "the scene's samples", width, height, format: POST_FORMAT, samples: MSAA_SAMPLES },
      { name: "the scene's depth", width, height, format: POST_DEPTH_FORMAT, samples: MSAA_SAMPLES },
      { name: "the scene resolved, then the sharpened frame", width, height, format: POST_FORMAT, samples: 1 },
      ...Object.values(targets).map((t) => ({ name: t.name, width: t.width, height: t.height, format: t.format as string, samples: 1 })),
      ...(quarter ?? []).map((t) => ({ name: t.name, width: t.width, height: t.height, format: t.format as string, samples: 1 })),
    ];
  }

  /** The grade's group for the mask now bound, for the pipeline that draws it: to the canvas, or to the lens's frame. */
  function gradeGroups(scene: GPUTextureView, strokes: Target, made: GPURenderPipeline): GPUBindGroup {
    return group(made, [
      uniforms("grade"), linear, scene, strokes.view, shadeMask !== null && shadeAny ? shadeMask.view : blackView,
      ...(features.halation && quarter !== null ? [quarter[0].view] : []),
    ]);
  }

  const draw = (encoder: GPUCommandEncoder, view: GPUTextureView, made: GPURenderPipeline, bound: GPUBindGroup): void => {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(made);
    pass.setBindGroup(0, bound);
    pass.draw(3);
    pass.end();
  };

  const task: Task = createCustomTask(engine, scene, {
    name: "post chain",
    record() {
      if (!disposed) build();
    },
    execute() {
      const encoder = getFrameEncoder(engine);
      const canvas = getRenderTargetAttachments(surface.scRT, canvasNow).colorView;
      const scene = getRenderTargetAttachments(resolved, resolvedNow).colorView;
      if (disposed || encoder === undefined || canvas === null || scene === null || targets === null || groups === null) return 0;
      let drawn = 0;
      const history = flip === 0 ? targets.historyA : targets.historyB;
      draw(encoder, targets.depth.view, pipelines.depth, groups.depth);
      draw(encoder, targets.far.view, pipelines.farSoft, groups.farSoft);
      draw(encoder, history.view, pipelines.taa, groups.taa[flip] as GPUBindGroup);
      // Over the scene's resolve, which the far softening has read and nothing reads again.
      draw(encoder, scene, pipelines.taaSharpen, groups.taaSharpen[flip] as GPUBindGroup);
      flip ^= 1;
      draw(encoder, targets.paint.view, pipelines.paint, groups.paint);
      drawn += 5;
      if (quarter !== null && pipelines.halationExtract !== null && pipelines.halationBlurX !== null && pipelines.halationBlurY !== null) {
        draw(encoder, quarter[0].view, pipelines.halationExtract, groups.halationExtract as GPUBindGroup);
        draw(encoder, quarter[1].view, pipelines.halationBlurX, groups.halationBlurX as GPUBindGroup);
        draw(encoder, quarter[0].view, pipelines.halationBlurY, groups.halationBlurY as GPUBindGroup);
        drawn += 3;
      }
      // The mask the grade reads: its group is made again when another is bound, or a figure comes or goes.
      const mask = shadeMask !== null && shadeAny ? shadeMask : null;
      if (mask !== shadeBound) {
        shadeBound = mask;
        gradeGroup = null;
        gradeLensGroup = null;
      }
      if (lensOn) {
        // The grade into the far softening's target, which nothing reads after the anti-aliasing, and the lens from it.
        pipelines.gradeForLens ??= pipeline("grade", gradeWgsl(features.halation), POST_FORMAT);
        pipelines.lens ??= pipeline("lens", LENS_WGSL, surface.format);
        if (droplets === null) {
          droplets = device.createTexture({ label: "lensDroplets", size: { width: LENS.size, height: LENS.size }, format: "rgba8unorm", usage: TEXTURE_BINDING | TEXTURE_COPY_DST });
          device.queue.writeTexture({ texture: droplets }, lensDropletMap(), { bytesPerRow: LENS.size * 4 }, { width: LENS.size, height: LENS.size });
          options.uploads?.count("textures", LENS.size * LENS.size * 4);
        }
        lensGroup ??= group(pipelines.lens, [uniforms("lens"), linear, targets.far.view, droplets.createView(), repeat]);
        gradeLensGroup ??= gradeGroups(scene, targets.paint, pipelines.gradeForLens);
        draw(encoder, targets.far.view, pipelines.gradeForLens, gradeLensGroup);
        draw(encoder, canvas, pipelines.lens, lensGroup);
        drawn += 2;
      } else {
        gradeGroup ??= gradeGroups(scene, targets.paint, pipelines.grade);
        draw(encoder, canvas, pipelines.grade, gradeGroup);
        drawn += 1;
      }
      counts.passes = drawn;
      counts.lens = lensOn;
      return drawn;
    },
    dispose() {
      release();
    },
  });
  addTask(scene, task);

  return {
    features,
    counts,
    get record() {
      return record;
    },
    setPalette(palette, fadeSeconds) {
      paletteFade.set(palette, fadeSeconds);
    },
    palette: () => paletteFade.now(),
    setShades(mask, any) {
      shadeMask = mask;
      shadeAny = any;
    },
    update(weather, hour, night, unsettle, stare, lens = 0, chase = 0) {
      const seconds = (now() - start) / 1000;
      record = gradeRecordUnder(weather, hour, night, unsettle, seconds, stare, chase, paletteFade.now());
      ditherSeconds = seconds;
      lensStrength = lens;
      lensOn = features.lens && lensGate.step(lens, seconds);
    },
    frame(view, air, cloud) {
      if (disposed) return;
      const { width, height } = surface.canvas;
      if (!(width > 0 && height > 0)) return;
      // The jitter's next step, on the projection Lite makes for the frame's size.
      const step = taaFrame.jitter(width, height);
      jitter.x = step.x;
      jitter.y = step.y;
      camera.projectionVersion = (camera.projectionVersion ?? 0) + 1;
      const projection = getProjectionMatrix(camera, width / height);
      records.depth.depthTerms[0] = projection[10] as number;
      records.depth.depthTerms[1] = projection[14] as number;
      write("depth", records.depth);
      farSoftUniforms(view, width, height, records.farSoft);
      write("farSoft", records.farSoft);
      write("farSoft", { atmSunDir: air.atmSunDir, atmSunColour: air.atmSunColour });
      write("farSoft", cloud);
      write("taa", taaFrame.step(view, width, height, records.taa));
      write("taaSharpen", sharpenUniforms(width, height, records.taaSharpen));
      // The strokes as the game's chain lays them out: by the paint's own target's size (`paintUniformsDrawn`).
      write("paint", paintUniformsDrawn(features.paint, width, height, records.paint));
      gradeUniforms(record, width, height, ditherSeconds, shadeMask !== null && shadeAny, records.grade);
      composeUniforms(width, height, records.grade);
      write("grade", records.grade);
      if (lensOn) write("lens", lensUniforms(lensStrength, (now() - start) / 1000, width, height, records.lens));
      if (features.halation) {
        const extract = (records as unknown as { halationExtract: { exposure: [number]; halfTexel: [number, number]; strength: [number]; texel: [number, number] } }).halationExtract;
        extractUniforms(record, extract);
        composeUniforms(width, height, extract);
        extract.texel[0] = 1 / width;
        extract.texel[1] = 1 / height;
        write("halationExtract" as SectionName, extract);
        // A texel of the quarter-size target along each blur's axis.
        const w = Math.max(1, Math.floor(width * HALATION_RATIO));
        const h = Math.max(1, Math.floor(height * HALATION_RATIO));
        write("halationBlurX" as SectionName, { delta: [1 / w, 0] });
        write("halationBlurY" as SectionName, { delta: [0, 1 / h] });
      }
      device.queue.writeBuffer(buffer, 0, data);
      options.uploads?.count("uniforms", bytes);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      camera.projectionHook = undefined;
      release();
      buffer.destroy();
      black.destroy();
      droplets?.destroy();
    },
  };
}
