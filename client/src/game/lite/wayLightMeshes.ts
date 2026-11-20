/**
 * The way down's mist on Babylon Lite: the channel of pale ground mist a
 * player in the chase runs down, from what the game draws it with
 * (`wayLight.ts`: its uniforms and how a stretch is stood on the ground;
 * `wayLightGeometry.ts`: the sheets, the veils and the fins).
 *
 * - **One material of the hike's own, one mesh a stretch of way**
 *   (`WAY_CHUNK_M`), its vertices in the world's own coordinates: the
 *   mist's four numbers a vertex ride in the mesh's colour, and the eye is
 *   the scene's, so the material's own uniforms are the mist's alone,
 *   written on a frame that shows it and only where they moved.
 * - **Built a few of the ground's heights a slice**, through the renderer's
 *   jobs, as a patient job: a way's meshes join the scene a stretch at a
 *   time, the old way's gone at once.
 * - **Its pipeline is asked for as the hike loads.** A mesh of no size
 *   stands in the scene from the start with the material on it, so the
 *   pipeline every stretch draws with is made off the page's thread, under
 *   the intro's film, and a stretch that joins the scene on the climb finds
 *   it made.
 * - **Blended premultiplied over what is behind it, tested against the
 *   depth and never written to it**, at the mist's place among the
 *   see-through draws (`SEE_THROUGH_ORDER.wayLight`), seen from over a
 *   sheet and from under it, from inside the channel and from outside it.
 *   Its depth is pulled toward the eye by each face's slope
 *   (`WAY_DEPTH_SLOPE`), so the lowest sheet never fights the ground.
 * - **On either colour path the stage writes the mist's colour as it is**:
 *   under a post chain that is the linear light the chain grades with the
 *   rest of the frame; with none it is the frame's own terms, which is why
 *   the mist's colour is made for the path (`wayTint`).
 */
import {
  addToScene, createMeshFromData, createShaderMaterial, createTexture2DFromPixels, disposeMeshGpu, removeFromScene, setMeshVisible, setShaderTexture,
  type EngineContext, type Mesh, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import { CLOUD_NOISE_SIZE, cloudNoiseMap } from "../cloudParams.js";
import type { Rgb } from "@csarkosh/engine/game/colour";
import type { Slices, SyncJobs } from "@csarkosh/engine/game/syncJobs";
import { WAY_DEPTH_SLOPE, emptyWayLightUniforms, standWayChunk, wayMistFrame, type WayColourPath } from "../wayLight.js";
import { wayChunks, type WayShape } from "../wayLightGeometry.js";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { shaderUniformDecls, shaderUniformWriter } from "@csarkosh/engine/game/lite/shaderUniforms";
import varyingsSource from "../shaders/wayLight/varyings.wgsl?raw";
import wayLightVertexSource from "../shaders/wayLight/wayLight.vertex.wgsl?raw";
import wayLightFragmentSource from "../shaders/wayLight/wayLight.fragment.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

/** What the two stages hand each other: the vertex's place in the world, its four numbers, and its place from the eye. */
const VARYINGS = wgsl(varyingsSource);

/** The stages' text, for the tests that hold it to the mist's design. */
export const WAY_LIGHT_WGSL = {
  vertex: fill(wgsl(wayLightVertexSource), { varyings: VARYINGS }),
  fragment: fill(wgsl(wayLightFragmentSource), { varyings: VARYINGS }),
} as const;

/** The colour the mist adds, and apart from it the share of what is behind that it hides; the frame's alpha is left as it is. */
export const PREMULTIPLIED_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
};

/** The ground mist's own noise (the large shapes in its red, the small in its green), repeating, its smaller levels filtered between: a texture of the way's own, so it is there on every tier. */
export function wayNoiseTexture(engine: EngineContext): ReturnType<typeof createTexture2DFromPixels> {
  return createTexture2DFromPixels(engine, cloudNoiseMap(), CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE, {
    addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear", mipMaps: true,
  });
}

/** The way's mist as it stands in a scene. */
export type LiteWayLight = {
  readonly material: ShaderMaterial;
  /**
   * The way to draw the mist down, or none: its meshes are built a stretch a
   * slice, the old way's gone at once. Every vertex stands on `heightAt`:
   * the ground the players stand on (the sim's field, the walkable rock's
   * rise with it), since over rock the bare elevation lies up to a metre
   * under what is drawn and a sheet laid on it would be hidden.
   */
  setWay(way: WayShape | null, heightAt: (x: number, z: number) => number): void;
  /**
   * A frame: the mist's `level` (0 none, 1 whole); `undim`, one over what
   * the frame outside the mist is dimmed by, which the post path's colour is
   * multiplied by so the dim does not reach it; `mist`, the ground mist's
   * colour this frame (`cloudColourUnder`), which the way's mist is a
   * brighter, colder shade of; the frame's `seconds`, which its shapes drift
   * and its banks heave by; and the chase's `cast` (0 to 1), which the mist
   * takes itself where nothing grades it.
   */
  update(level: number, undim: number, mist: Rgb, seconds: number, cast: number): void;
  /** Whether the whole way's meshes are built. */
  readonly ready: boolean;
  /** The stretches built, and whether they are drawn. */
  readonly built: number;
  readonly shown: boolean;
  dispose(): void;
};

/** The way's mist in `scene`, toned for the tier's colour `path`, built through `jobs`; made before the scene is registered. */
export function createLiteWayLight(engine: EngineContext, scene: SceneContext, path: WayColourPath, jobs: SyncJobs, uploads?: FrameUploads): LiteWayLight {
  const values = emptyWayLightUniforms();
  const material = createShaderMaterial({
    name: "wayLight",
    vertexSource: WAY_LIGHT_WGSL.vertex,
    fragmentSource: WAY_LIGHT_WGSL.fragment,
    attributes: ["position", "color"],
    // The view and the eye are the scene's own: no system uniform, so nothing is written for a camera that moves.
    uniforms: shaderUniformDecls(values),
    samplers: ["wayNoise"],
    needAlphaBlending: true,
    blend: PREMULTIPLIED_BLEND,
    depthWrite: false,
    // A sheet is seen from over it and from under it, a veil from inside the channel and from outside it.
    backFaceCulling: false,
    depthBiasSlopeScale: WAY_DEPTH_SLOPE,
  });
  setShaderTexture(material, "wayNoise", wayNoiseTexture(engine));
  const writeUniforms = shaderUniformWriter(material, values);

  /** A mesh of the mist's, at the world's origin as every see-through mesh stands (`drawOrder.ts`), hidden until it is shown. */
  const stand = (name: string, positions: Float32Array, light: Float32Array, indices: Uint32Array): Mesh => {
    const mesh = createMeshFromData(engine, name, positions, new Float32Array(positions.length), indices, undefined, undefined, undefined, light);
    mesh.material = material;
    mesh.renderOrder = SEE_THROUGH_ORDER.wayLight;
    setMeshVisible(mesh, false);
    addToScene(scene, mesh);
    return mesh;
  };
  // The mesh of no size the pipeline is made for as the hike loads: never shown.
  const seed = stand("wayLight_seed", new Float32Array(9), new Float32Array(12), new Uint32Array([0, 1, 2]));

  const owner = {};
  let meshes: Mesh[] = [];
  let ready = false;
  let shown = false;
  let disposed = false;

  function clear(): void {
    jobs.cancel(owner);
    for (const mesh of meshes) {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    }
    meshes = [];
    ready = false;
  }

  function* build(way: WayShape, heightAt: (x: number, z: number) => number): Slices {
    const chunks = wayChunks(way);
    for (let i = 0; i < chunks.length; i++) {
      const [from, to] = chunks[i] as [number, number];
      const data = yield* standWayChunk(way, heightAt, from, to);
      const mesh = stand(`wayLight_${i}`, data.positions, data.light, data.indices);
      uploads?.stream("geometry", data.positions.byteLength * 2 + data.light.byteLength + data.indices.byteLength);
      // A stretch that lands while the mist is up is drawn from the frame it lands.
      if (shown) setMeshVisible(mesh, true);
      meshes.push(mesh);
      if (i + 1 < chunks.length) yield;
    }
    ready = true;
  }

  return {
    material,
    setWay(way, heightAt) {
      if (disposed) return;
      clear();
      if (way !== null && way.xs.length > 1) jobs.begin(owner, build(way, heightAt), true, "wayLight");
    },
    update(level, undim, mist, seconds, cast) {
      if (disposed) return;
      const now = level > 0;
      if (now !== shown) {
        shown = now;
        for (const mesh of meshes) setMeshVisible(mesh, now);
      }
      if (!now) return;
      wayMistFrame(path, level, undim, mist, seconds, cast, values);
      if (writeUniforms()) uploads?.marked();
    },
    get ready() {
      return ready;
    },
    get built() {
      return meshes.length;
    },
    get shown() {
      return shown;
    },
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
      removeFromScene(scene, seed);
      disposeMeshGpu(seed);
    },
  };
}
