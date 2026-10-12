/**
 * The shell over `facePatches.ts`: one mesh a patched cell, in the camera's
 * reach for the tier, drawn with a terrain material of their own so they are
 * the ground's rock in the ground's light, a depth offset ahead of it.
 *
 * The cell set is a function of the camera's cell alone (it is walked from
 * that cell's centre), so it changes only when the camera crosses a cell
 * line; each crossing builds the cells that entered or whose spacing or
 * stitch (its stitched edges and its neighbours outside the set) changed,
 * drops the ones that left, and leaves the rest as they are. A cell with no
 * steep ground is remembered empty until it leaves or its spacing changes.
 */
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { WEIGHTS2_STRIDE } from "./clipmap.js";
import {
  PATCH_CELL,
  PATCH_REACH,
  facePatchCells,
  facePatchGeometry,
  facePatchStitch,
  patchKey,
  type FacePatch,
  type PatchStitch,
} from "./facePatches.js";
import type { QualityTier } from "./quality.js";
import { enableFeaturePaint, enableRoadPaint, enableTrailPaint, setTerrainFarBand } from "./terrainTexture.js";

/** The patches' material's name in `terrainMaterialFor`'s cache. */
export const FACE_PATCH_MATERIAL = "facePatch";
/** The patches' depth offset: the slope's share and the constant share, as
 * the board paint's (`boardPaint.ts`), so where the relief is nothing the
 * patch is drawn over the ground it lies on rather than fighting it. */
export const FACE_PATCH_Z_OFFSET = -1;
export const FACE_PATCH_Z_UNITS = -120;

/** A registry the patches enter as they are built and leave as they are
 * dropped: patches come and go with the camera, so both halves. */
export type FacePatchRegistry = { add(mesh: Mesh): void; remove(mesh: Mesh): void };

export type FacePatchRegistries = {
  /** The shadow map's casters, `lighting.addShadowMesh` / `removeShadowMesh`. */
  shadows?: FacePatchRegistry;
  /** The lakes' reflections, the mirror's and the panorama's, each drawing a
   * patch with the stand-in the clipmap's rings are drawn with there: the
   * rings leave out the ground under fully steep squares, so without the
   * patches a steep face would reflect as sky. */
  reflections?: FacePatchRegistry;
  /** The rain's cover map, as terrain beside the clipmap's inner rings: the
   * streaks stop on the rock and the splashes land on the faces. */
  rain?: FacePatchRegistry;
};

export type FacePatches = {
  /** Follows the camera: rebuilds only when its cell changes. */
  update(camX: number, camZ: number): void;
  /** Meshes standing now: one a patched cell. */
  meshCount(): number;
  /** Cells whose patch has been computed since the patches were made, empty
   * ones included. For the tests. */
  builds(): number;
  dispose(): void;
};

type Entry = { spacing: number; stitch: number; mesh: Mesh | null };

/** A stitch as one number for the rebuild key: the four stitched edges in the
 * low bits, the eight open neighbours above them. */
function stitchBits(s: PatchStitch): number {
  return (s.west ? 1 : 0) | (s.east ? 2 : 0) | (s.south ? 4 : 0) | (s.north ? 8 : 0) | (s.open << 4);
}

/**
 * Uploads a patch: positions, normals, colours and indices through
 * `VertexData`, then the terrain plugin's three attributes on the mesh, after
 * it, with the clipmap's names and strides (`applyRingGeometry`).
 */
export function applyFacePatch(mesh: Mesh, patch: FacePatch): void {
  const data = new VertexData();
  data.positions = patch.positions;
  data.indices = patch.indices;
  data.normals = patch.normals;
  data.colors = patch.colors;
  data.applyToMesh(mesh, false);
  mesh.setVerticesData("terrainWeights", patch.weights, false, 4);
  mesh.setVerticesData("terrainWeights2", patch.weights2, false, WEIGHTS2_STRIDE);
  mesh.setVerticesData("terrainCover", patch.cover, false, 1);
}

export function createFacePatches(
  scene: Scene,
  seed: number,
  tier: QualityTier,
  material: PBRMaterial,
  options: FacePatchRegistries = {},
): FacePatches {
  const reach = PATCH_REACH[tier];
  const registries = [options.shadows, options.reflections, options.rain].filter(
    (r): r is FacePatchRegistry => r !== undefined,
  );
  // The patches' material is the ground's in every switch the ground's has:
  // the clipmap turns on the paint for its world, and the far band follows
  // the tier, so both are turned on here for this one.
  enableRoadPaint(scene, material, seed);
  enableTrailPaint(scene, material, seed);
  enableFeaturePaint(scene, material, seed);
  setTerrainFarBand(scene, material, tier === "low");

  let cells = new Map<number, Entry>();
  let lastCi = Number.NaN;
  let lastCj = Number.NaN;
  let builds = 0;
  let live = 0;

  function drop(entry: Entry): void {
    if (entry.mesh === null) return;
    for (const r of registries) r.remove(entry.mesh);
    entry.mesh.dispose();
    entry.mesh = null;
    live--;
  }

  function build(ci: number, cj: number, spacing: number, stitch: PatchStitch): Mesh | null {
    builds++;
    const patch = facePatchGeometry(seed, ci, cj, spacing, stitch);
    if (patch === null) return null;
    const mesh = new Mesh(`facePatch_${ci}_${cj}`, scene);
    applyFacePatch(mesh, patch);
    mesh.useVertexColors = true;
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    // Positions are world space: the world matrix is the identity for good.
    mesh.freezeWorldMatrix();
    for (const r of registries) r.add(mesh);
    live++;
    return mesh;
  }

  return {
    update(camX, camZ) {
      const ci = Math.floor(camX / PATCH_CELL);
      const cj = Math.floor(camZ / PATCH_CELL);
      if (ci === lastCi && cj === lastCj) return;
      lastCi = ci;
      lastCj = cj;
      const want = facePatchCells((ci + 0.5) * PATCH_CELL, (cj + 0.5) * PATCH_CELL, reach);
      const stitches = facePatchStitch(want);
      const next = new Map<number, Entry>();
      want.forEach((c, i) => {
        const key = patchKey(c.ci, c.cj);
        const stitch = stitches[i] as PatchStitch;
        const bits = stitchBits(stitch);
        const had = cells.get(key);
        if (had !== undefined) {
          cells.delete(key);
          // An empty cell is empty whatever its stitch: only its grid decides.
          if (had.spacing === c.spacing && (had.stitch === bits || had.mesh === null)) {
            had.stitch = bits;
            next.set(key, had);
            return;
          }
          drop(had);
        }
        next.set(key, { spacing: c.spacing, stitch: bits, mesh: build(c.ci, c.cj, c.spacing, stitch) });
      });
      // What is left of the old set has left the reach.
      for (const entry of cells.values()) drop(entry);
      cells = next;
    },
    meshCount() {
      return live;
    },
    builds() {
      return builds;
    },
    dispose() {
      for (const entry of cells.values()) drop(entry);
      cells.clear();
      lastCi = Number.NaN;
      lastCj = Number.NaN;
    },
  };
}
