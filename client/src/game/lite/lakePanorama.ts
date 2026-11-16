/**
 * The shore panorama on Babylon Lite: the medium tier's picture of a lake's
 * shore, which its water reflects under the skyline, as the game draws it
 * on Babylon.js (`lakePanorama.ts`), from what the game draws it with
 * (`panoramaTurn.ts`: the picture's size and sectors, a sector's frustum
 * and yaw, the turn and when a capture is asked for; `mirrorGround.ts`: the
 * ground's flat colour).
 *
 * - **A sector is a pass of the hike's own frame, drawn before it, and
 *   only on a frame of a capture.** The pass is a render task of the scene
 *   with a camera and a list of its own, as the rain's cover map is
 *   (`rainMap.ts`): a registered mesh is the scene's mesh, so its geometry
 *   and its instance list are the buffers the hike's own draw reads.
 * - **A sector is drawn into a target of its own size and laid into its
 *   column of the picture** by one triangle, 64 by 128 texels, where on
 *   Babylon.js it is drawn through a viewport into the column itself: a
 *   task of Lite's has a target and no viewport. The water then reads one
 *   picture with one filtered read round the whole turn, as the game's
 *   does. The triangle writes a texel's colour as it was drawn and its
 *   alpha as 1 where anything was: a material that is cut out by its alpha
 *   hands the alpha it was cut at on here, where Babylon.js writes 1, and
 *   the water weighs the picture by it.
 * - **A capture runs only while the lake reads the picture** (`update`'s
 *   `read`: its water is in the view and has glass on it). One that is
 *   asked for meanwhile is owed, and runs from the first frame that reads
 *   it, a sector a frame; until its columns are drawn the water reads the
 *   ones it has, and where a column holds nothing, the skyline's shade. On
 *   Babylon.js a capture runs when it is asked for, wherever the camera
 *   looks.
 * - **The ground is a stand-in**, as the game's is: the terrain's rings and
 *   patches through one flat lit colour, darker under the canopy, under the
 *   scene's distance fog from the capture's eye
 *   (`lakeMirrorTerrain.*.fx`). Everything else is drawn in its own
 *   material, lit and hazed as it is, linear and unexposed as the tier's
 *   materials hand their colour on. A texel nothing drew holds alpha 0.
 * - **The picture is laid top row first**, as a pass of WebGPU writes it:
 *   the level is its last row, and the water reads it so (`waterWgsl.ts`).
 *
 * What the hike hides by its own view (a lake's plants) the panorama's pass
 * draws all the same: the pass has its own word on them (`add`'s `always`).
 */
import {
  addMeshToTask, addTaskAtStart, addToScene, createBankedFreeCamera, createCustomTask, createMeshFromData, createPbrMaterial, createRenderTargetTexture,
  createRenderTask, createRenderTexture2D, disposeMeshGpu, getFrameEncoder, getGpuDevice, markMaterialUboDirty, removeFromScene, removeMeshFromTask,
  setMeshVisible, setTaskMeshVisible, setThinInstances, vec3,
  type EngineContext, type MaterialPlugin, type Mesh, type PluginUniformBlock, type SceneContext, type Texture2D,
} from "@babylonjs/lite";
import type { LakeSource } from "../../sim/terrain.js";
import { MIRROR_CANOPY_SHADE, mirrorGroundColour, type MirrorGroundSky } from "../mirrorGround.js";
import {
  PANORAMA_EYE_UP, PANORAMA_FAR, PANORAMA_HEIGHT, PANORAMA_NEAR, PANORAMA_SECTOR_WIDTH, PANORAMA_WIDTH, createPanoramaArming, createPanoramaTurn, panoramaFrustum,
  sectorYaw, type PanoramaFrustum,
} from "../panoramaTurn.js";
import type { WeatherParams } from "../weather.js";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_BLOCK } from "./frameBlock.js";
import type { FrameUploads } from "./frameUploads.js";
import { uniformFields, writeUniforms } from "./pluginUniforms.js";
import { TERRAIN_VERTEX_FLOATS, TERRAIN_VERTEX_LAYOUT } from "./terrainPlugins.js";

/** The picture's format: half floats, as the game's, for lit colour ahead of the display's curve. */
export const PANORAMA_FORMAT = "rgba16float";
/** A sector's own depth buffer. */
export const PANORAMA_DEPTH_FORMAT = "depth24plus";
/** How far ahead of the capture's eye the point its camera looks at is put, metres. */
const LOOK_AHEAD = 10;

/** The canopy's density among the terrain's vertex data: the second weight set's last float (`terrainVertices.ts`). */
const CANOPY = TERRAIN_VERTEX_LAYOUT.find((part) => part.varying === "vTerrainW2") as (typeof TERRAIN_VERTEX_LAYOUT)[number];

/** The stand-in's one uniform of its own: the ground's lit colour, linear (`mirrorGroundColour`). */
export type PanoramaGroundUniforms = { lakeMirrorColour: Float32Array };

/**
 * The ground's stand-in, `lakeMirrorTerrain.fragment.fx` statement for
 * statement, in place of the lit colour and last in the fragment: the flat
 * colour, darker under the canopy, under the scene's distance fog (its
 * density and colour the frame's, as the air's plugin reads them) from the
 * eye of the pass that draws it.
 */
export const PANORAMA_GROUND_WGSL = `{
  var pgColour=material.lakeMirrorColour*(1.0-${wgslFloat(MIRROR_CANOPY_SHADE)}*input.vPanoramaCanopy);
  let pgDepth=length(input.worldPos-scene.vEyePosition.xyz)*${FRAME_BLOCK}.atmBaseDensity;
  let pgFog=pow(clamp(exp(-pgDepth*pgDepth),0.0,1.0),2.2);
  pgColour=mix(${FRAME_BLOCK}.atmFarColour,pgColour,pgFog);
  color=pgColour;
  alpha=1.0;
}`;

/** The stand-in as a plugin on a plain material: it declares the terrain's vertex data whole, as the terrain's own does, and hands the canopy's density on. */
export function panoramaGroundPlugin(uniforms: PanoramaGroundUniforms, shared: PluginUniformBlock): MaterialPlugin {
  return {
    name: "PanoramaGround",
    priority: 990,
    getCustomCode: (stage) =>
      stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: PANORAMA_GROUND_WGSL } : { CUSTOM_VERTEX_MAIN_END: `out.vPanoramaCanopy=${CANOPY.name}.w;` },
    getVertexAttributes: () => [{ name: CANOPY.name, type: "vec4<f32>", format: "float32x4", stride: TERRAIN_VERTEX_FLOATS * 4, offset: CANOPY.offset * 4 }],
    getVaryings: () => [{ name: "vPanoramaCanopy", type: "f32" }],
    getUniforms: () => ({ ubo: uniformFields(uniforms) }),
    getUniformBlocks: () => [shared],
    writeUbo(data, offsets) {
      writeUniforms(data, offsets, uniforms);
    },
  };
}

/** What a shell hands the panorama: each mesh it draws of a kind, from when it is made until it is let go. */
export type ReflectionRegistry = {
  /** `always`: the panorama draws the mesh whatever the frame's own pass shows of it, for what the hike hides by its own view. */
  add(mesh: Mesh, always?: boolean): void;
  remove(mesh: Mesh): void;
};

/** What the panorama has drawn, for whoever counts it. */
export type PanoramaCounts = {
  /** Meshes in its list: each is a draw of a sector's pass while it is shown. */
  meshes: number;
  /** Sectors drawn since it was made: each a pass of its own and a triangle into its column. */
  sectors: number;
  /** Times the picture was cleared for another lake. */
  clears: number;
  /** Bytes of the picture a sector's triangle writes. */
  columnBytes: number;
};

export type LitePanorama = {
  /** The picture: PANORAMA_WIDTH by PANORAMA_HEIGHT half floats, round the turn in u, the level its last row. */
  readonly texture: Texture2D;
  /** The terrain's rings and patches, drawn through the stand-in. */
  readonly ground: ReflectionRegistry;
  /** What is drawn in its own material: the forest's billboards, a lake's plants, the props, the cliffs' far buckets. */
  readonly own: ReflectionRegistry;
  /** Something the picture draws has landed late: it is taken again. */
  landed(): void;
  /** Moves the capture to `lake`: its eye, its frustum, an empty picture and a whole turn owed. */
  setLake(lake: LakeSource): void;
  /**
   * A frame under `sky` (null before its first slices) and `weather`. `read`:
   * the lake served reads the picture this frame. True on a frame that draws
   * a sector, which the frame's own pass then follows. A sector asked for
   * stands until a frame is drawn (`frameDrawn`): one that no frame drew is
   * asked for again.
   */
  update(sky: MirrorGroundSky | null, weather: WeatherParams, read: boolean): boolean;
  /** Says the frame is drawn, its sector with it: the sector's pass and its column are not drawn again until an `update` asks. */
  frameDrawn(): void;
  /** Sectors still owed of the capture running. */
  readonly owed: number;
  readonly counts: PanoramaCounts;
  /** Takes every mesh out of the list. The pass and its targets go with the scene. */
  dispose(): void;
};

export type PanoramaOptions = {
  /** The frame's block, for the scene's distance fog. */
  shared: PluginUniformBlock;
  uploads?: FrameUploads;
};

/**
 * A sector laid into its column: a triangle over the column, each texel of
 * the sector read whole at the column's own texel, its alpha 1 where the
 * sector's pass drew anything (it clears to 0).
 */
export const PANORAMA_COLUMN_WGSL = /* wgsl */ `
@group(0) @binding(0) var sectorColour: texture_2d<f32>;
struct ColumnOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn columnVertex(@builtin(vertex_index) index: u32) -> ColumnOut {
  var corners = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var out: ColumnOut;
  out.position = vec4<f32>(corners[index], 0.0, 1.0);
  out.uv = vec2<f32>(corners[index].x * 0.5 + 0.5, 0.5 - corners[index].y * 0.5);
  return out;
}
@fragment fn columnFragment(input: ColumnOut) -> @location(0) vec4<f32> {
  let size = vec2<f32>(textureDimensions(sectorColour));
  let texel = textureLoad(sectorColour, vec2<i32>(input.uv * size), 0);
  return vec4<f32>(texel.rgb, step(1.0e-4, texel.a));
}`;

/** The panorama of `scene` for `lake`, made before the scene is registered. */
export function createLitePanorama(engine: EngineContext, scene: SceneContext, lake: LakeSource, options: PanoramaOptions): LitePanorama {
  const { uploads } = options;
  // The picture, read round the turn: u repeats, so the seam at +z filters across; v clamps.
  const picture = createRenderTexture2D(engine, PANORAMA_WIDTH, PANORAMA_HEIGHT, {
    format: PANORAMA_FORMAT, addressModeU: "repeat", addressModeV: "clamp-to-edge", minFilter: "linear", magFilter: "linear",
  });
  // A sector's own target, cleared whole at each draw: colour to nothing drawn, and a depth buffer no other sector reads.
  const sector = createRenderTargetTexture(engine, {
    lbl: "lake_panorama_sector", format: PANORAMA_FORMAT, dFormat: PANORAMA_DEPTH_FORMAT, samples: 1, size: { width: PANORAMA_SECTOR_WIDTH, height: PANORAMA_HEIGHT },
  });

  // The capture's camera, the pass's own and never the scene's: at the lake's centre over its level, level with the
  // horizon, its projection the sector's frustum whatever the target's shape.
  const camera = createBankedFreeCamera(vec3(lake.x, lake.level + PANORAMA_EYE_UP, lake.z), vec3(lake.x, lake.level + PANORAMA_EYE_UP, lake.z + LOOK_AHEAD), vec3(0, 1, 0));
  camera.nearPlane = PANORAMA_NEAR;
  camera.farPlane = PANORAMA_FAR;
  const frustum: PanoramaFrustum = panoramaFrustum(lake.shape.meanRadius, { across: 0, up: 0, shift: 0 });
  camera.projectionHook = (projection) => {
    projection[0] = frustum.across;
    projection[5] = frustum.up;
    projection[8] = 0;
    projection[9] = frustum.shift;
  };

  const groundUniforms: PanoramaGroundUniforms = { lakeMirrorColour: new Float32Array(3) };
  const groundColour = { r: 0, g: 0, b: 0 };
  const groundMaterial = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 });
  groundMaterial.plugins = [panoramaGroundPlugin(groundUniforms, options.shared)];

  // Lite builds a mesh that joins a pass later by the scene's own build of its material's kind, made when the scene is
  // registered, and that build knows vertex colours and instance lists only if a mesh of the scene had them then. A
  // lake's plants have both and are made long after. So one mesh that is never shown stands in the scene from the
  // start with a colour a vertex and an instance list of one: a triangle of no size.
  const seed = createMeshFromData(
    engine, "lake_panorama_seed", new Float32Array(9), new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]), undefined, undefined, undefined,
    new Float32Array(12).fill(1),
  );
  seed.material = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 });
  setThinInstances(seed, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 1);
  setMeshVisible(seed, false);
  addToScene(scene, seed);

  const task = createRenderTask(
    { name: "lake_panorama", rt: sector.rt, cam: camera, clr: true, clrColor: { r: 0, g: 0, b: 0, a: 0 }, autoMirror: false },
    engine, scene,
  );
  task.enabled = false;

  const turn = createPanoramaTurn();
  const arming = createPanoramaArming<MirrorGroundSky>();
  const registered = new Set<Mesh>();
  const counts: PanoramaCounts = { meshes: 0, sectors: 0, clears: 0, columnBytes: PANORAMA_SECTOR_WIDTH * PANORAMA_HEIGHT * 8 };
  /** The column this frame's sector is laid into; -1 on a frame that draws none. */
  let column = -1;
  /** A sector the turn has given that no frame has drawn yet: it is the next drawn, so none is passed over; -1 with none. */
  let held = -1;
  /** The picture holds another lake's shore: it is emptied before the next sector lands. */
  let clearDue = false;
  let at = lake;
  let disposed = false;

  // The sector into its column: one triangle over the column alone, every texel read whole.
  const device = getGpuDevice(engine);
  const module = device.createShaderModule({ label: "lake_panorama_column", code: PANORAMA_COLUMN_WGSL });
  const pipeline = device.createRenderPipeline({
    label: "lake_panorama_column", layout: "auto",
    vertex: { module, entryPoint: "columnVertex" }, fragment: { module, entryPoint: "columnFragment", targets: [{ format: PANORAMA_FORMAT }] },
  });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: sector.texture.view }] });

  // The column follows the sector's pass and comes before the frame's own, which reads the picture.
  const lay = createCustomTask(engine, scene, {
    name: "lake_panorama_column",
    execute() {
      const encoder = getFrameEncoder(engine);
      if (disposed || encoder === undefined || (column < 0 && !clearDue)) return 0;
      // Another lake's shore is emptied whole as the first sector of this one's lands, or by itself.
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: picture.view, loadOp: clearDue ? "clear" : "load", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      if (clearDue) counts.clears++;
      clearDue = false;
      if (column >= 0) {
        pass.setViewport(column * PANORAMA_SECTOR_WIDTH, 0, PANORAMA_SECTOR_WIDTH, PANORAMA_HEIGHT, 0, 1);
        pass.setScissorRect(column * PANORAMA_SECTOR_WIDTH, 0, PANORAMA_SECTOR_WIDTH, PANORAMA_HEIGHT);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
      }
      pass.end();
      return column >= 0 ? 1 : 0;
    },
  });
  // Each put first in turn: the sector's pass, then its column, then what the scene held.
  addTaskAtStart(scene, lay);
  addTaskAtStart(scene, task);

  const registry = (ground: boolean): ReflectionRegistry => ({
    add(mesh, always) {
      // A mesh is in the list once.
      if (disposed || registered.has(mesh)) return;
      registered.add(mesh);
      counts.meshes = registered.size;
      addMeshToTask(task, mesh, ground ? { material: groundMaterial } : undefined);
      if (always === true) setTaskMeshVisible(task, mesh, true);
    },
    remove(mesh) {
      if (disposed || !registered.delete(mesh)) return;
      counts.meshes = registered.size;
      removeMeshFromTask(task, mesh);
    },
  });

  return {
    texture: picture,
    ground: registry(true),
    own: registry(false),
    counts,
    get owed() {
      return turn.remaining + (held >= 0 ? 1 : 0);
    },
    landed() {
      arming.landed();
    },
    setLake(next) {
      if (disposed || next === at) return;
      at = next;
      // A sector held is of the lake left behind: the whole turn asked for takes its place.
      held = -1;
      panoramaFrustum(next.shape.meanRadius, frustum);
      camera.projectionVersion = (camera.projectionVersion ?? 0) + 1;
      clearDue = true;
      turn.rearm();
    },
    update(sky, weather, read) {
      column = -1;
      task.enabled = false;
      if (disposed) return false;
      // What it draws is drawn by pipelines made as they are first needed: its target is ready whenever it is asked.
      if (arming.step(sky, true)) turn.rearm();
      // Nothing before the sky's first slices, and nothing while no water reads the picture: the capture stays owed.
      if (sky === null || !read) return false;
      if (held < 0) held = turn.step(true);
      if (held < 0) return false;
      const yaw = sectorYaw(held);
      camera.position.x = at.x;
      camera.position.y = at.level + PANORAMA_EYE_UP;
      camera.position.z = at.z;
      camera.target.x = at.x + Math.sin(yaw) * LOOK_AHEAD;
      camera.target.y = at.level + PANORAMA_EYE_UP;
      camera.target.z = at.z + Math.cos(yaw) * LOOK_AHEAD;
      // The ground's colour under the frame's light: written when it has moved.
      mirrorGroundColour(sky, weather, groundColour);
      const u = groundUniforms.lakeMirrorColour;
      if (u[0] !== Math.fround(groundColour.r) || u[1] !== Math.fround(groundColour.g) || u[2] !== Math.fround(groundColour.b)) {
        u[0] = groundColour.r;
        u[1] = groundColour.g;
        u[2] = groundColour.b;
        markMaterialUboDirty(groundMaterial);
        uploads?.marked();
      }
      column = held;
      task.enabled = true;
      return true;
    },
    frameDrawn() {
      if (column >= 0) {
        held = -1;
        counts.sectors++;
      }
      task.enabled = false;
      column = -1;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      turn.end();
      for (const mesh of registered) removeMeshFromTask(task, mesh);
      registered.clear();
      counts.meshes = 0;
      // The pass stays the scene's, closed: the scene lets it go with its target, as it does every task of its own.
      task.enabled = false;
      camera.projectionHook = undefined;
      removeFromScene(scene, seed);
      disposeMeshGpu(seed);
    },
  };
}
