/**
 * The mist beyond the way's banks on Babylon Lite, on the tiers with no
 * marched ground mist: one mesh round the eye and one material, from what
 * the game draws it with (`wayMistField.ts`: its uniforms and how its
 * vertices follow the eye; `wayMistFieldGeometry.ts`: the sheets and the
 * fins).
 *
 * - **One mesh, made once and written in place.** Its vertices are places
 *   in the world, laid out again when the eye crosses into another cell or
 *   a cell's ground is learned, and then its two vertex buffers are sent
 *   whole; a frame that does neither sends nothing. The field's four
 *   numbers a vertex ride in the mesh's colour.
 * - **Hidden while the way's mist is down or there is no way**, so a day's
 *   frame is what it was. Its pipeline is asked for as the hike loads, with
 *   every other material's that stands in the scene from the start.
 * - **Blended as the way's own mist is** (`wayLightMeshes.ts`), after it
 *   among the see-through draws, its depth pulled toward the eye the same
 *   way. Its colour is the way's mist's on the material path: in the
 *   frame's own terms, with the chase's cast taken by itself.
 */
import {
  addToScene, createMeshFromData, createShaderMaterial, disposeMeshGpu, removeFromScene, setMeshVisible, setShaderTexture, updateMeshColors, updateMeshPositions,
  type EngineContext, type Mesh, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import type { WayDown } from "../../sim/wayDown.js";
import type { Rgb } from "@csarkosh/engine/game/colour";
import { WAY_DEPTH_SLOPE, wayMistFrame } from "../wayLight.js";
import { createWayFieldFollow, emptyWayFieldUniforms } from "../wayMistField.js";
import { fieldIndices } from "../wayMistFieldGeometry.js";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { shaderUniformDecls, shaderUniformWriter } from "@csarkosh/engine/game/lite/shaderUniforms";
import { PREMULTIPLIED_BLEND, wayNoiseTexture } from "./wayLightMeshes.js";
import varyingsSource from "../shaders/wayField/varyings.wgsl?raw";
import wayFieldVertexSource from "../shaders/wayField/wayField.vertex.wgsl?raw";
import wayFieldFragmentSource from "../shaders/wayField/wayField.fragment.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

/** What the two stages hand each other: the vertex's place in the world, its four numbers, and its place from the eye. */
const VARYINGS = wgsl(varyingsSource);

/** The stages' text, for the tests that hold it to the mist's design. */
export const WAY_FIELD_WGSL = {
  vertex: fill(wgsl(wayFieldVertexSource), { varyings: VARYINGS }),
  fragment: fill(wgsl(wayFieldFragmentSource), { varyings: VARYINGS }),
} as const;

/** The field as it stands in a scene. */
export type LiteWayField = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /**
   * A frame: the eye; the way's mist's `level` (0 none, 1 whole); the ground
   * mist's colour (`mist`); the frame's `seconds`; the chase's `cast` (0 to
   * 1), which the mist takes itself on this path; and the way and the ground
   * it stands on, or none (nothing is drawn).
   */
  update(
    eye: { readonly x: number; readonly y: number; readonly z: number }, level: number, mist: Rgb, seconds: number, cast: number,
    way: WayDown | null, heightAt: ((x: number, z: number) => number) | null,
  ): void;
  /** Whether the field is drawn. */
  readonly shown: boolean;
  dispose(): void;
};

/** The mist beyond the way's banks in `scene`, toned for the material path; made before the scene is registered. */
export function createLiteWayField(engine: EngineContext, scene: SceneContext, uploads?: FrameUploads): LiteWayField {
  const values = emptyWayFieldUniforms();
  const material = createShaderMaterial({
    name: "wayField",
    vertexSource: WAY_FIELD_WGSL.vertex,
    fragmentSource: WAY_FIELD_WGSL.fragment,
    attributes: ["position", "color"],
    // The view and the eye are the scene's own: no system uniform, so nothing is written for a camera that moves.
    uniforms: shaderUniformDecls(values),
    samplers: ["wayNoise"],
    needAlphaBlending: true,
    blend: PREMULTIPLIED_BLEND,
    depthWrite: false,
    backFaceCulling: false,
    depthBiasSlopeScale: WAY_DEPTH_SLOPE,
  });
  setShaderTexture(material, "wayNoise", wayNoiseTexture(engine));
  const writeUniforms = shaderUniformWriter(material, values);

  const follow = createWayFieldFollow();
  const mesh = createMeshFromData(engine, "wayField", follow.positions, new Float32Array(follow.positions.length), fieldIndices(), undefined, undefined, undefined, follow.field);
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.wayField;
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  let shown = false;
  let disposed = false;

  return {
    mesh,
    material,
    get shown() {
      return shown;
    },
    update(eye, level, mist, seconds, cast, way, heightAt) {
      if (disposed) return;
      const now = level > 0 && way !== null && heightAt !== null;
      if (now !== shown) {
        shown = now;
        setMeshVisible(mesh, now);
      }
      if (!now) return;
      if (follow.step(eye, way as WayDown, heightAt as (x: number, z: number) => number)) {
        updateMeshPositions(engine, mesh, follow.positions);
        updateMeshColors(engine, mesh, follow.field);
        uploads?.stream("geometry", follow.positions.byteLength + follow.field.byteLength, 2);
      }
      wayMistFrame("material", level, 1, mist, seconds, cast, values);
      if (writeUniforms()) uploads?.marked();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
