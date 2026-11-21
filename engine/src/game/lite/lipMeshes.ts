/**
 * The plunging lip's swept curl on Babylon Lite: the strip the game draws
 * over the cove's face on the tier whose wind sea is computed each frame,
 * from what the game draws it with, computed
 * with no engine: the strips' vertices, their reach and the crests as they
 * read them (`lipStrip.ts`), the tracker the sea's edge steps
 * (`seaEdge.ts`) and the baked cross-section (`oceanBreaker.ts`). Its
 * shading is the sea's own, through the sea's plugin made with the strip's
 * tables (`seaPlugin.ts`).
 *
 * - **Two strips made once, one drawn at most**: a column a metre for a
 *   camera within the curl's range of the face, every other column beyond.
 *   A vertex carries its column's world z, its slot and its section's
 *   vertex, and the vertex stage places it.
 * - **Drawn only with the cascades, with a crest in mid-plunge, in view.**
 *   While the wind sea is drawn any other way the sea's fragment lip draws
 *   and the strip does not, as in the game; with no slot live the strip is
 *   one point a section and is not drawn at all; and its reach over the
 *   face is tested against the view as the sea's rings' boxes are.
 * - **The crests are sent on a frame that draws the strip**, 16 KB (the
 *   game sends them every frame the cascades are drawn); the cross-section
 *   once. Hidden, the strip costs no draw and no write.
 * - **It stands after the sea among the see-through draws** (`drawOrder.ts`),
 *   over the surface its feet lie on; and where the sea is read through
 *   (`look.through`) it is opaque as the sea is, drawn after the pass's
 *   break and tested against the sea's depth, as the game draws the two.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, createRenderTexture2D, disposeMeshGpu, markMaterialUboDirty, removeFromScene, setMeshVisible,
  updateTextureRegion,
  type EngineContext, type MaterialPlugin, type Mesh, type PluginUniformBlock, type SceneContext,
} from "@babylonjs/lite";
import { boxInPlanes, cornersPastBox, type ViewPlane } from "../lakeSeen.js";
import { LIP_COARSE_M, LIP_FINE_M, closeFreeSlots, lipNear, lipReach, lipStripGeometry } from "../lipStrip.js";
import { LIP_COLUMNS, LIP_KEYFRAMES, LIP_PROFILE_VERTS, LIP_SLOTS, lipProfile, type LipTracker } from "../oceanBreaker.js";
import type { SeaUniforms } from "../seaUniforms.js";
import type { SwashCove } from "../swashTable.js";
import { WATER_ROWS, roughnessFor } from "../waterShading.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";
import { seaPlugin, type SeaTextures } from "./seaPlugin.js";
import type { SeaLook } from "./seaWgsl.js";

/** What the strip is made with: the sea's own. */
export type LipOptions = {
  cove: SwashCove;
  waterLevel: number;
  /** The breaker's tracker, which the sea's edge steps. */
  tracker: LipTracker;
  /** The sea's uniforms, tables and pictures, and its look: the strip reads them as the sea does. */
  uniforms: SeaUniforms;
  textures: SeaTextures;
  look: SeaLook;
  shared: PluginUniformBlock;
  air: () => MaterialPlugin;
  uploads?: FrameUploads;
};

export type LiteLip = {
  /** The strip near the camera and the one beyond. */
  readonly fine: Mesh;
  readonly coarse: Mesh;
  /**
   * A frame, after the tracker's update: `cascades` whether the wind sea's cascades are drawn, the camera's place,
   * and the view's planes and corners. Sends the crests and shows a strip only where one is drawn.
   */
  update(cascades: boolean, camX: number, camZ: number, planes: readonly ViewPlane[], corners: ArrayLike<number>): void;
  /** The sea's own uniforms have moved: the strip's material is written again when it is next drawn. */
  moved(): void;
  /** Whether the last `update` drew a strip, and the times the crests were sent. */
  readonly shown: boolean;
  readonly stateUploads: number;
  dispose(): void;
};

/** The curl of a sea made with `options`, made after the scene is registered. */
export function createLiteLip(engine: EngineContext, scene: SceneContext, options: LipOptions): LiteLip {
  const { cove, waterLevel, tracker, uploads } = options;
  const table = (width: number, height: number) => createRenderTexture2D(engine, width, height, { format: "rgba32float", minFilter: "nearest", magFilter: "nearest" });
  const state = table(LIP_COLUMNS, LIP_SLOTS);
  const stateRows = { width: LIP_COLUMNS, height: LIP_SLOTS, bytesPerRow: LIP_COLUMNS * 16 };
  // What the state is sent from: the tracker's, its free slots closed on the live crests near them.
  const upload = new Float32Array(tracker.state.data.length);
  const profile = table(LIP_PROFILE_VERTS, LIP_KEYFRAMES);
  const shape = lipProfile();
  updateTextureRegion(engine, profile, shape, { width: LIP_PROFILE_VERTS, height: LIP_KEYFRAMES, bytesPerRow: LIP_PROFILE_VERTS * 16 });
  uploads?.count("textures", shape.byteLength);

  const material = createPbrMaterial({
    baseColorFactor: [WATER_ROWS.sea.lInf[0], WATER_ROWS.sea.lInf[1], WATER_ROWS.sea.lInf[2], 1], metallicFactor: 0,
    roughnessFactor: roughnessFor(0, WATER_ROWS.sea.shelter),
    // As the sea's: one alpha blends it, or, read through, it is opaque; seen from either side.
    alphaBlend: options.look.through !== true, doubleSided: true, usePhysicalLightFalloff: true,
  });
  material.plugins = [seaPlugin(options.uniforms, options.textures, options.shared, options.look, { state, profile }), options.air()];

  const strip = (name: string, step: number): Mesh => {
    const geometry = lipStripGeometry(cove, step);
    const normals = new Float32Array(geometry.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    const indices = Uint32Array.from(geometry.indices);
    const mesh = createMeshFromData(engine, name, geometry.positions, normals, indices);
    mesh.material = material;
    mesh.renderOrder = SEE_THROUGH_ORDER.lip;
    if (options.look.through === true) mesh.afterBreak = true;
    uploads?.count("geometry", geometry.positions.byteLength + normals.byteLength + indices.byteLength, 3);
    uploads?.made();
    setMeshVisible(mesh, false);
    addToScene(scene, mesh);
    return mesh;
  };
  const fine = strip("sea_lip_fine", LIP_FINE_M);
  const coarse = strip("sea_lip_coarse", LIP_COARSE_M);
  // Every place a vertex can take: what a view is tested against, since a strip's positions are not places.
  const reach = lipReach(cove, waterLevel);

  let fineShown = false;
  let coarseShown = false;
  let stale = true;
  let stateUploads = 0;
  let disposed = false;
  const show = (near: boolean, far: boolean): void => {
    if (near !== fineShown) {
      fineShown = near;
      setMeshVisible(fine, near);
    }
    if (far !== coarseShown) {
      coarseShown = far;
      setMeshVisible(coarse, far);
    }
  };

  return {
    fine,
    coarse,
    get shown() {
      return fineShown || coarseShown;
    },
    get stateUploads() {
      return stateUploads;
    },
    moved() {
      stale = true;
    },
    update(cascades, camX, camZ, planes, corners) {
      if (disposed) return;
      const { min, max } = reach;
      // Nothing to draw: no cascades, no crest in mid-plunge, or the face out of the view.
      const drawn = cascades
        && closeFreeSlots(tracker.state.data, upload)
        && boxInPlanes(min[0], min[1], min[2], max[0], max[1], max[2], planes)
        && !cornersPastBox(min[0], min[1], min[2], max[0], max[1], max[2], corners);
      if (!drawn) {
        show(false, false);
        return;
      }
      updateTextureRegion(engine, state, upload, stateRows);
      uploads?.count("textures", upload.byteLength);
      stateUploads++;
      if (stale) {
        stale = false;
        markMaterialUboDirty(material);
        uploads?.marked();
      }
      const near = lipNear(reach, camX, camZ);
      show(near, !near);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of [fine, coarse]) {
        removeFromScene(scene, mesh);
        disposeMeshGpu(mesh);
        uploads?.dropped();
      }
    },
  };
}
