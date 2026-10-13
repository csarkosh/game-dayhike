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
 *
 * Given `jobs`, a crossing at a walk is one patient job (`syncJobs.ts`): the
 * new set worked out in one slice, then the cells to build, nearest first,
 * one a slice, each made into a mesh that is not yet drawn, then in the last
 * slice the new meshes shown and entered into the registries and the old
 * ones of the cells that changed or left dropped, together. Until then the
 * last set applied is drawn whole, and `cover` names the ground that set
 * covers. A crossing while the job is pending begins it again for the new
 * cell, and the cells built so far are kept for it. The first update builds
 * the near band at once and leaves the rest to the job; a jump of more than
 * a cell and the free camera's fast moves build at once (`crossingAt`). With
 * nothing pending, idle work builds ahead the cells the next crossing on the
 * camera's heading will want, so at a walk the job mostly shows what is
 * built.
 */
import type { TrailGraph } from "../sim/trail.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { WEIGHTS2_STRIDE, type CoveredGround } from "./clipmap.js";
import {
  PATCH_CELL,
  PATCH_FAR_SPACING,
  PATCH_NEAR_SPACING,
  PATCH_REACH,
  facePatchCells,
  facePatchCover,
  facePatchGeometry,
  facePatchStitch,
  patchKey,
  type FacePatch,
  type PatchCell,
  type PatchReach,
  type PatchStitch,
} from "./facePatches.js";
import type { QualityTier } from "./quality.js";
import { createCrossing, crossingAt, finish, nextCrossing, type Slices, type SyncJobs } from "./syncJobs.js";
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
  /** The world's trail, which the walkable rock keeps off (`sim/rockSurface.ts`,
   * `trailClearAt`), as the ground the player stands on does; null or absent, none. */
  trail?: TrailGraph | null;
};

/** What a cell's slice is expected to take (ms) by its spacing, near, far
 * and wide, yielded ahead of it so the jobs fit it in a frame's share
 * (`syncJobs.ts`): a near one is more than a share and starts only as one
 * begins. */
export const FACE_PATCH_SLICE_MS: Readonly<Record<number, number>> = {
  [PATCH_NEAR_SPACING]: 5,
  [PATCH_FAR_SPACING]: 2,
};
/** A wide cell's slice (ms). */
const WIDE_SLICE_MS = 0.5;

export type FacePatches = {
  /** Follows the camera: rebuilds only when its cell changes. */
  update(camX: number, camZ: number): void;
  /** Meshes drawn now: one a patched cell of the set last applied. */
  meshCount(): number;
  /** Cells whose patch has been computed since the patches were made, empty
   * ones included. For the tests. */
  builds(): number;
  /** The ground the drawn patches cover, for the clipmap to leave out: that
   * of the camera's cell the set drawn was walked from, null before any
   * patch is drawn. While the first update's job is pending only the near
   * band is drawn, and this names only what it covers. */
  cover(): CoveredGround | null;
  dispose(): void;
};

type Entry = { spacing: number; stitch: number; mesh: Mesh | null };

/** A set for a camera's cell: the cells walked from its centre, their
 * stitches as numbers, and the indices of those that the set drawn does not
 * hold as they are wanted, nearest the centre first. */
type Wanted = { ci: number; cj: number; cells: PatchCell[]; stitches: PatchStitch[]; bits: number[]; changed: number[] };

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
  jobs?: SyncJobs,
  options: FacePatchRegistries = {},
): FacePatches {
  const reach = PATCH_REACH[tier];
  /** The near band alone, as a reach: what the first update draws at once. */
  const nearReach: PatchReach = { near: reach.near, far: reach.near, wide: reach.near };
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

  /** The cells drawn: the set last applied. */
  let cells = new Map<number, Entry>();
  /** Cells built and not yet drawn, their meshes hidden and in no registry:
   * a job's, or the idle work's ahead of a crossing, until a set is applied.
   * One a cell, spacing and stitch (`readyKey`), so the sets of two headings
   * keep their own builds of a cell. */
  const ready = new Map<number, Entry>();
  let covered: CoveredGround | null = null;
  let builds = 0;
  let live = 0;
  const crossing = createCrossing();
  /** The camera's last move between two frames: its heading. */
  let headingX = 0;
  let headingZ = 0;
  /** The cell the idle work builds ahead for (NaN: none). */
  let aheadCi = Number.NaN;
  let aheadCj = Number.NaN;
  const ahead = new Float64Array(2);
  /** The patches' place in the jobs' queue. */
  const slot = {};
  let disposed = false;

  /** Whether `entry` is the cell as wanted at `spacing` with `bits`: an
   * empty cell is empty whatever its stitch, only its grid decides. */
  const holds = (entry: Entry | undefined, spacing: number, bits: number): entry is Entry =>
    entry !== undefined && entry.spacing === spacing && (entry.stitch === bits || entry.mesh === null);

  function drop(entry: Entry): void {
    if (entry.mesh === null) return;
    for (const r of registries) r.remove(entry.mesh);
    entry.mesh.dispose();
    entry.mesh = null;
    live--;
  }

  /** A built cell never drawn, let go. */
  function discard(entry: Entry): void {
    entry.mesh?.dispose();
    entry.mesh = null;
  }

  /** Cell (ci, cj)'s patch made into a mesh, hidden and in no registry. */
  function build(ci: number, cj: number, spacing: number, stitch: PatchStitch): Mesh | null {
    builds++;
    const patch = facePatchGeometry(seed, ci, cj, spacing, stitch, options.trail ?? null);
    if (patch === null) return null;
    const mesh = new Mesh(`facePatch_${ci}_${cj}`, scene);
    applyFacePatch(mesh, patch);
    mesh.useVertexColors = true;
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    // Positions are world space: the world matrix is the identity for good.
    mesh.freezeWorldMatrix();
    mesh.setEnabled(false);
    return mesh;
  }

  /** The set walked from cell (ci, cj)'s centre, and what of it to build. */
  function want(ci: number, cj: number): Wanted {
    const cx = (ci + 0.5) * PATCH_CELL;
    const cz = (cj + 0.5) * PATCH_CELL;
    const list = facePatchCells(cx, cz, reach);
    const stitches = facePatchStitch(list);
    const bits = stitches.map(stitchBits);
    const changed: number[] = [];
    const d2: number[] = [];
    list.forEach((c, i) => {
      const dx = (c.ci + 0.5) * PATCH_CELL - cx;
      const dz = (c.cj + 0.5) * PATCH_CELL - cz;
      d2.push(dx * dx + dz * dz);
      if (!holds(cells.get(patchKey(c.ci, c.cj)), c.spacing, bits[i] as number)) changed.push(i);
    });
    // Stable: equal distances keep the walk's order.
    changed.sort((a, b) => (d2[a] as number) - (d2[b] as number));
    return { ci, cj, cells: list, stitches, bits, changed };
  }

  /** `ready`'s key for cell `i` of `w` built as wanted with a patch, or,
   * with `empty`, built empty: an empty cell is empty whatever its stitch. */
  function readyKey(w: Wanted, i: number, empty: boolean): number {
    const c = w.cells[i] as PatchCell;
    const band = c.spacing === PATCH_NEAR_SPACING ? 0 : c.spacing === PATCH_FAR_SPACING ? 1 : 2;
    // The stitch's twelve bits, or a thirteenth for an empty cell.
    return (patchKey(c.ci, c.cj) * 4 + band) * 8192 + (empty ? 4096 : (w.bits[i] as number));
  }

  /** `ready`'s key for cell `i` of `w` if it is built as wanted, else NaN. */
  function readyAt(w: Wanted, i: number): number {
    const full = readyKey(w, i, false);
    if (ready.has(full)) return full;
    const empty = readyKey(w, i, true);
    return ready.has(empty) ? empty : Number.NaN;
  }

  /** Whether cell `i` of `w` is built as wanted and not yet drawn. */
  function isReady(w: Wanted, i: number): boolean {
    return !Number.isNaN(readyAt(w, i));
  }

  /** Cell `i` of `w`, built as wanted and taken out of `ready`, to be drawn:
   * built now unless it is already. */
  function take(w: Wanted, i: number): Entry {
    make(w, i);
    const at = readyAt(w, i);
    const entry = ready.get(at) as Entry;
    ready.delete(at);
    entry.stitch = w.bits[i] as number;
    return entry;
  }

  /** Cell `i` of `w` built as wanted and not yet drawn, unless it is. */
  function make(w: Wanted, i: number): void {
    if (isReady(w, i)) return;
    const c = w.cells[i] as PatchCell;
    const mesh = build(c.ci, c.cj, c.spacing, w.stitches[i] as PatchStitch);
    ready.set(readyKey(w, i, mesh === null), { spacing: c.spacing, stitch: w.bits[i] as number, mesh });
  }

  /** What cell `i` of `w`'s slice is expected to take (ms). */
  function sliceMs(w: Wanted, i: number): number {
    return FACE_PATCH_SLICE_MS[(w.cells[i] as PatchCell).spacing] ?? WIDE_SLICE_MS;
  }

  /**
   * The set `w` drawn: each cell built since shown and entered into the
   * registries, and the patch it replaces dropped; then, unless `nearOnly`,
   * every cell of the old set that left dropped and what was built and not
   * wanted let go. With `nearOnly`, the near band alone, over a set with
   * none drawn: the first update's.
   */
  function apply(w: Wanted, nearOnly: boolean): void {
    const next = nearOnly ? cells : new Map<number, Entry>();
    w.cells.forEach((c, i) => {
      if (nearOnly && c.spacing !== PATCH_NEAR_SPACING) return;
      const key = patchKey(c.ci, c.cj);
      const bits = w.bits[i] as number;
      const had = cells.get(key);
      if (holds(had, c.spacing, bits)) {
        had.stitch = bits;
        cells.delete(key);
        next.set(key, had);
        return;
      }
      // Built by now; one that is not (a set drawn at once) is built here.
      const entry = take(w, i);
      if (had !== undefined) {
        drop(had);
        cells.delete(key);
      }
      if (entry.mesh !== null) {
        entry.mesh.setEnabled(true);
        for (const r of registries) r.add(entry.mesh);
        live++;
      }
      next.set(key, entry);
    });
    if (!nearOnly) {
      // What is left of the old set has left the reach.
      for (const entry of cells.values()) drop(entry);
      for (const entry of ready.values()) discard(entry);
      ready.clear();
      // The idle work built for this crossing: the next update aims it at
      // the next.
      stopAhead();
    }
    cells = next;
    const cx = (w.ci + 0.5) * PATCH_CELL;
    const cz = (w.cj + 0.5) * PATCH_CELL;
    covered = facePatchCover(cx, cz, nearOnly ? nearReach : reach);
  }

  /** The rebuild for cell (ci, cj): the set worked out, each cell to build in
   * a slice of its own, nearest first, then the set drawn in the last. */
  function* rebuild(ci: number, cj: number, nearOnly = false): Slices {
    const w = want(ci, cj);
    for (const i of w.changed) {
      if ((nearOnly && (w.cells[i] as PatchCell).spacing !== PATCH_NEAR_SPACING) || isReady(w, i)) continue;
      yield sliceMs(w, i);
      make(w, i);
    }
    yield;
    apply(w, nearOnly);
  }

  /** Idle work: the cells the set for cell (ci, cj) will want built, nearest
   * first. What was built for another cell is kept, for a camera that turns
   * back, until a set is applied. */
  function* buildAhead(ci: number, cj: number): Slices {
    const w = want(ci, cj);
    for (const i of w.changed) {
      if (isReady(w, i)) continue;
      yield sliceMs(w, i);
      make(w, i);
    }
  }

  /** The idle work stopped: the next `aim` sets it again. */
  function stopAhead(): void {
    jobs?.idle(slot, null);
    aheadCi = Number.NaN;
    aheadCj = Number.NaN;
  }

  /** Aims the idle work at the cell the camera at (camX, camZ) enters next
   * on its heading, when that changed. */
  function aim(camX: number, camZ: number): void {
    if (jobs === undefined || jobs.pending(slot)) return;
    let ci = Number.NaN;
    let cj = Number.NaN;
    if (nextCrossing(camX, camZ, headingX, headingZ, PATCH_CELL, ahead)) {
      ci = Math.floor((ahead[0] as number) / PATCH_CELL);
      cj = Math.floor((ahead[1] as number) / PATCH_CELL);
    }
    if (Object.is(ci, aheadCi) && Object.is(cj, aheadCj)) return;
    aheadCi = ci;
    aheadCj = cj;
    jobs.idle(slot, Number.isNaN(ci) ? null : buildAhead(ci, cj));
  }

  return {
    update(camX, camZ) {
      if (disposed) return;
      const hx = camX - crossing.lastX;
      const hz = camZ - crossing.lastZ;
      if ((hx !== 0 || hz !== 0) && !Number.isNaN(hx) && !Number.isNaN(hz)) {
        headingX = hx;
        headingZ = hz;
      }
      const ci = Math.floor(camX / PATCH_CELL);
      const cj = Math.floor(camZ / PATCH_CELL);
      const first = Number.isNaN(crossing.originX);
      const kind = crossingAt(crossing, camX, camZ, ci * PATCH_CELL, cj * PATCH_CELL, PATCH_CELL, jobs !== undefined);
      if (kind === "none") {
        aim(camX, camZ);
        return;
      }
      // Idle work runs beside a patient job: the job builds what it needs,
      // and the idle work starts again once it is drawn.
      stopAhead();
      if (kind === "later") {
        (jobs as SyncJobs).begin(slot, rebuild(ci, cj), true);
        return;
      }
      jobs?.cancel(slot);
      if (first && jobs !== undefined) {
        // The face in front of the camera on the first frame, the distance
        // over the frames after it.
        finish(rebuild(ci, cj, true));
        jobs.begin(slot, rebuild(ci, cj), true);
        return;
      }
      finish(rebuild(ci, cj));
    },
    meshCount() {
      return live;
    },
    builds() {
      return builds;
    },
    cover() {
      return covered;
    },
    dispose() {
      disposed = true;
      jobs?.cancel(slot);
      jobs?.idle(slot, null);
      for (const entry of cells.values()) drop(entry);
      for (const entry of ready.values()) discard(entry);
      cells.clear();
      ready.clear();
      covered = null;
    },
  };
}
