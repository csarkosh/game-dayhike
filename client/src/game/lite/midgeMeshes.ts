/**
 * The midges on Babylon Lite: every swarm of a lake in one draw, one unit
 * card an instance,
 * placed in the vertex stage from its swarm's row in a small table and the
 * shared clock, and a fragment stage that adds the sun's glint and the
 * sky's and darkens by the speck's coverage.
 *
 * - **One buffer a frame, and none while no swarm is in sight.** The game's
 *   stages read a dozen uniforms and the table; here they are one run of
 *   floats (`packMidgeFrame`), a storage buffer both stages read, written
 *   once a frame the midges are drawn. They are drawn while the view's
 *   planes hold the sphere of a swarm that has a midge (`swarmSphere`);
 *   hidden, the mesh draws and writes nothing.
 * - **An instance is a row and a slot**, laid out once (`midgeSlots`). Lite's
 *   stages of this kind are handed an instance's matrix and nothing else,
 *   so the pair rides in the matrix's first two floats, which the stage
 *   reads in place of a matrix it never uses.
 * - **Blended premultiplied**, as the game blends them: the glints add, the
 *   speck's coverage darkens; tested against the depth, never written to
 *   it, never culled; toned on the material colour path by the stage's own
 *   copy of the display's curve.
 * - **The view is the scene's.** Lite declares its scene uniforms ahead of
 *   every stage and writes them once a pass, so the stage reads
 *   `scene.viewProjection` and declares no system uniform: a camera that
 *   moves writes no copy of its matrix for the midges, drawn or hidden.
 */
import {
  addToScene, createPlane, createShaderMaterial, createStorageBuffer, disposeMeshGpu, removeFromScene, setMeshVisible, setShaderStorageBuffer,
  setThinInstances, updateStorageBuffer,
  type EngineContext, type Mesh, type SceneContext,
} from "@babylonjs/lite";
import { sphereInPlanes, type ViewPlane } from "../lakeSeen.js";
import { MIDGE_FRAME_FLOATS, midgeSlots, packMidgeFrame, swarmSphere, type MidgeFrame } from "../midgeLook.js";
import { MIDGE_SWARMS_MAX, SWARM_ROW_FLOATS } from "../midgeMotion.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";
import dataSource from "../shaders/midge/data.wgsl?raw";
import varyingsSource from "../shaders/midge/varyings.wgsl?raw";
import midgeVertexSource from "../shaders/midge/midge.vertex.wgsl?raw";
import midgeFragmentSource from "../shaders/midge/midge.fragment.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

/** The frame's floats as the stages read them: `packMidgeFrame`'s five vec4s, then the table. */
const DATA = fill(wgsl(dataSource), { swarmVecs: (SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX) / 4 });
const VARYINGS = wgsl(varyingsSource);

/** The midges' vertex stage. The uniforms are read from the frame's floats by name. */
const VERTEX = fill(wgsl(midgeVertexSource), { data: DATA, varyings: VARYINGS });

/** The midges' fragment stage. */
const FRAGMENT = fill(wgsl(midgeFragmentSource), { data: DATA, varyings: VARYINGS });

/** The stages' text, for the tests that hold it to the game's. */
export const MIDGE_WGSL = { vertex: VERTEX, fragment: FRAGMENT } as const;

/** The midges as they stand in a scene. */
export type LiteMidges = {
  readonly mesh: Mesh;
  /** Draws the midges with `frame`, toned by `exposure` and `contrast` where `toned` (no post chain grades the frame); or hides them (null). */
  show(frame: MidgeFrame | null, exposure: number, contrast: number, toned?: boolean): void;
  /** Whether the midges are drawn, and the instances the one draw holds. */
  readonly shown: boolean;
  readonly instances: number;
  dispose(): void;
};

/**
 * The midges of one lake in `scene`: `blocks[r]` instances in row r, none
 * drawn until a frame has a swarm in sight and `planes`, the view's, hold
 * it. Null where no row holds any.
 */
export function createLiteMidges(
  engine: EngineContext, scene: SceneContext, blocks: readonly number[], planes: () => readonly ViewPlane[], uploads?: FrameUploads,
): LiteMidges | null {
  const { slots, total } = midgeSlots(blocks);
  if (total === 0) return null;
  const data = new Float32Array(MIDGE_FRAME_FLOATS);
  const buffer = createStorageBuffer(engine, data, "midge_frame");
  const material = createShaderMaterial({
    name: "midge",
    vertexSource: VERTEX,
    fragmentSource: FRAGMENT,
    attributes: ["position"],
    storageBuffers: [{ name: "midgeData", type: "MidgeData" }],
    needAlphaBlending: true,
    // Premultiplied: the light adds, the coverage darkens.
    blend: {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    },
    depthWrite: false,
    backFaceCulling: false,
  });
  setShaderStorageBuffer(material, "midgeData", buffer);
  // A row and a slot an instance, in the first two floats of a matrix the stage never reads as one.
  const matrices = new Float32Array(total * 16);
  for (let i = 0; i < total; i++) {
    matrices[i * 16] = slots[i * 2] as number;
    matrices[i * 16 + 1] = slots[i * 2 + 1] as number;
  }
  const mesh = createPlane(engine, { size: 1 });
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.midges;
  setThinInstances(mesh, matrices, total);
  uploads?.count("instances", matrices.byteLength);
  uploads?.made();
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);
  let shown = false;
  let disposed = false;
  const sphere: [number, number, number, number] = [0, 0, 0, 0];
  /** Whether the view holds a swarm of `table` that has a midge. */
  function inView(table: Float32Array): boolean {
    const view = planes();
    for (let row = 0; row < MIDGE_SWARMS_MAX; row++) {
      if (swarmSphere(table, row, sphere) && sphereInPlanes(sphere[0], sphere[1], sphere[2], sphere[3], view)) return true;
    }
    return false;
  }
  return {
    mesh,
    instances: total,
    get shown() {
      return shown;
    },
    show(frame, exposure, contrast, toned = true) {
      if (disposed) return;
      const now = frame !== null && inView(frame.table);
      if (now !== shown) {
        shown = now;
        setMeshVisible(mesh, now);
      }
      if (frame === null || !now) return;
      packMidgeFrame(frame, exposure, toned, contrast, data);
      updateStorageBuffer(engine, buffer, data);
      uploads?.count("uniforms", data.byteLength);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
      uploads?.dropped();
    },
  };
}
