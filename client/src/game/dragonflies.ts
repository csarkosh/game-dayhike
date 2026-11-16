/**
 * The Babylon shell for the lake's dragonflies: one thin-instance card mesh a kind (darner,
 * skimmer, damselfly), built in code as the butterfly is (`wildlifeMeshes.ts`), each with its own
 * `PBRMaterial` wearing the birds' wing beat (`wingPlugin.ts`). `dragonflyBehaviour.ts` decides
 * where every unit is; this file only writes their instances. One draw a kind; no shadows.
 *
 * The shapes and each kind's instances a frame are made with no engine (`dragonflyShapes.ts`). The
 * buffers follow the bird buckets: a matrix, a `wing` (phase, amp) and a `color` buffer per
 * kind, grown together by doubling and otherwise rewritten in place, so a steady frame uploads
 * the live prefix and allocates nothing.
 *
 * Renderer-only by design: nothing here may migrate into sim/.
 */
// Side-effect import, and it is load-bearing: `thinInstanceSetBuffer` and
// `thinInstanceCount` are added to `Mesh` only when this module is pulled in —
// the same note `wildlifeMeshes.ts` carries.
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { attachWing } from "./wingPlugin.js";
import type { Dragonflies } from "./dragonflyBehaviour.js";
import {
  DRAGONFLY_KINDS, DRAGONFLY_OMEGA, DRAGONFLY_ROUGHNESS, dragonflyGeometry, dragonflyHalfSpan, emptyDragonflyList, fillDragonflyList, type DragonflyList,
} from "./dragonflyShapes.js";

export {
  DRAGONFLY_COLOURS, DRAGONFLY_DRAWN_SCALE, DRAGONFLY_LENGTH, DRAGONFLY_OMEGA, DRAGONFLY_WING_ALPHA, DRAGONFLY_WING_AMP, DRAGONFLY_WING_HZ, dragonflyGeometry,
} from "./dragonflyShapes.js";

/** One kind's mesh, its material and its list (`dragonflyShapes.ts`): reused, doubling buffers, the bird bucket's shape (`wildlifeMeshes.ts`). */
type Bucket = { mesh: Mesh; material: PBRMaterial; list: DragonflyList };

export type DragonflyMeshes = { readonly meshes: readonly Mesh[]; update(d: Dragonflies, seed: number): void; dispose(): void };

/**
 * The mesh a kind draws: white albedo over the vertex colours (the butterfly's convention), two-sided
 * because a card is seen from both sides, alpha-blended by its vertex alpha so the wings are
 * translucent, never a shadow caster, and always active (a bounding box synced to every instance
 * would rescan every matrix each frame).
 *
 * `now` is the clock (ms) the wings beat on; the wall clock absent.
 */
export function createDragonflyMeshes(scene: Scene, now?: () => number): DragonflyMeshes {
  const buckets: Bucket[] = [];
  for (let k = 0; k < 3; k++) {
    const name = DRAGONFLY_KINDS[k]!;
    const mesh = new Mesh(`dragonfly_${name}`, scene);
    const geo = dragonflyGeometry(k);
    const data = new VertexData();
    data.positions = geo.positions;
    data.normals = geo.normals;
    data.colors = geo.colors;
    data.indices = geo.indices;
    data.applyToMesh(mesh, false);
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = true;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const material = new PBRMaterial(`dragonfly_${name}_mat`, scene);
    material.albedoColor = new Color3(1, 1, 1);
    material.metallic = 0;
    material.roughness = DRAGONFLY_ROUGHNESS;
    material.backFaceCulling = false;
    mesh.material = material;
    attachWing(material, dragonflyHalfSpan(geo.positions), DRAGONFLY_OMEGA[k]!, now);
    buckets.push({ mesh, material, list: emptyDragonflyList() });
  }
  const meshes = buckets.map((b) => b.mesh);
  let disposed = false;

  /** Pushes a filled bucket to its mesh: grown buffers set whole, otherwise the live prefix
   * re-uploaded; created updatable, and a bucket with nothing to draw disabled outright (with no
   * instances Babylon would draw the bare card once at the origin). */
  function apply(bucket: Bucket): void {
    const mesh = bucket.mesh;
    const b = bucket.list;
    if (b.grown) {
      mesh.thinInstanceSetBuffer("matrix", b.matrices, 16, false);
      mesh.thinInstanceSetBuffer("wing", b.wing, 2, false);
      mesh.thinInstanceSetBuffer("color", b.tint, 4, false);
      mesh.thinInstanceCount = b.count;
    } else {
      mesh.thinInstanceCount = b.count;
      if (b.count > 0) {
        mesh.thinInstanceBufferUpdated("matrix");
        mesh.thinInstanceBufferUpdated("wing");
        mesh.thinInstanceBufferUpdated("color");
      }
    }
    mesh.setEnabled(b.count > 0);
  }

  return {
    meshes,
    update(d, seed) {
      if (disposed) return;
      for (let k = 0; k < 3; k++) {
        const b = buckets[k]!;
        fillDragonflyList(b.list, d, k, seed);
        apply(b);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const b of buckets) {
        b.mesh.dispose();
        // Made here, so nothing else would ever free it (the butterfly's `ownedMaterials` note).
        b.material.dispose();
      }
    },
  };
}
