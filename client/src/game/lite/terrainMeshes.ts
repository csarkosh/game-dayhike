/**
 * The terrain's meshes on Babylon Lite: the clipmap's seven rings round the
 * camera (`clipmap.ts`) and the steep ground's patches in its reach
 * (`facePatches.ts`), each drawn with the terrain's material from the
 * vertex data the two make (`terrainVertices.ts`).
 *
 * A ring is one mesh for its life. Its vertices are as many whatever it
 * draws, so a ring that moves is written again in place: the positions and
 * the normals into the mesh's own buffers, its triangles into an index
 * buffer of the ring's full size with the ones left out under a patch
 * drawn as nothing, and the weights, cover and colour into its plugin
 * vertex data. A patch is a mesh made when its cell enters the reach and
 * let go when it leaves or is wanted at another spacing or stitch.
 *
 * The rings move when the camera crosses a line of the finest ring's
 * lattice and the patches when it crosses a line of their cells, and each
 * crossing is worked whole in the call that finds it: every ring's samples
 * moved, then every ring whose inputs changed made again and written. A
 * ring re-emits when it moved, when the ring inside it or outside it moved
 * (its hole follows the finer ring and its border blends to the coarser
 * one), or when the ground the patches cover is measured from somewhere
 * else, the rule `createClipmap` in `renderer.ts` states in full.
 */
import {
  addToScene, createMeshFromData, disposeMeshGpu, invalidateRenderBundles, removeFromScene, updateMeshGeometry,
  type EngineContext, type Material, type Mesh, type SceneContext,
} from "@babylonjs/lite";
import type { TrailGraph } from "../../sim/trail.js";
import {
  BASE_SPACING_BY_TIER, RING_COUNT, coversRing, createRingSamples, holeCellsFor, ringGeometryBuffers, ringGeometrySlices, ringSampleSlices, snapOrigin,
  type CoveredGround, type RingArrays, type RingGeometry, type RingSamples,
} from "../clipmap.js";
import {
  PATCH_CELL, PATCH_REACH, facePatchCells, facePatchCover, facePatchGeometry, facePatchStitch, patchKey, patchStitchBits,
  type PatchStitch,
} from "../facePatches.js";
import type { QualityTier } from "../quality.js";
import { finish, type Slices } from "../syncJobs.js";
import { facePatchVertices, ringVertices, type TerrainVertices } from "../terrainVertices.js";
import { terrainVertexData } from "./terrainPlugins.js";

export type TerrainMeshes = {
  /** The rings' first build, as slices: each ring sampled (one slice a ring,
   * its level told to `onRing`), then every ring made and written. Run once;
   * before it, `update` does nothing. */
  firstBuild(onRing?: (level: number) => void): Slices;
  /** Follows the camera: the patches first, then the rings, which leave out
   * the ground the patches now drawn cover. */
  update(camX: number, camZ: number): void;
  /** Meshes drawn now: the rings built, and one a patched cell. */
  meshCount(): number;
  dispose(): void;
};

export type TerrainMeshOptions = {
  /** Where the rings' first build is centred: where the hike's player starts. Absent or null, the origin. */
  start?: { x: number; z: number } | null;
  /** The first build's rings sampled ahead, where they are the ones a build
   * at `start` samples (`fittingRings`): taken as the rings' own. */
  rings?: RingSamples[] | null;
  /** The world's trail, which the walkable rock keeps off. */
  trail?: TrailGraph | null;
};

/** The origins a ring's buffers were made from: its own, the finer ring's,
 * the coarser ring's, and where its covered ground is measured from. */
type Drawn = { x: number; z: number; fx: number; fz: number; cx: number; cz: number; kx: number; kz: number; kr: number; kf: number };

type PatchEntry = { spacing: number; stitch: number; mesh: Mesh | null };

export function createTerrainMeshes(
  engine: EngineContext,
  scene: SceneContext,
  materials: { ground: Material; patches: Material },
  seed: number,
  tier: QualityTier,
  options: TerrainMeshOptions = {},
): TerrainMeshes {
  const base = BASE_SPACING_BY_TIER[tier];
  const reach = PATCH_REACH[tier];
  const rings: RingSamples[] = [];
  const ringMeshes: (Mesh | null)[] = [];
  const buffers: (RingGeometry | null)[] = [];
  /** Each ring's index buffer at its full size, as the mesh holds it. */
  const indices: (Uint32Array | null)[] = [];
  const drawn: (Drawn | undefined)[] = [];
  const spare: RingArrays[] = [];
  /** The covered ground the rings were last made for. */
  let covered: CoveredGround | null = null;
  /** The ring 0 origin the rings were last built at. */
  let builtX = Number.NaN;
  let builtZ = Number.NaN;
  let patches = new Map<number, PatchEntry>();
  let patchCi = Number.NaN;
  let patchCj = Number.NaN;
  /** The ground the patches drawn cover; null before any set is. */
  let patchCover: CoveredGround | null = null;
  let live = 0;
  let disposed = false;

  /** `vertices` drawn by `mesh`, written in place, or by a mesh made for
   * them; `drawnIndices` are its triangles, as many as the mesh has held
   * from the first. */
  function write(mesh: Mesh | null, name: string, material: Material, vertices: TerrainVertices, drawnIndices: Uint32Array): Mesh {
    if (mesh === null) {
      const made = createMeshFromData(engine, name, vertices.positions, vertices.normals, drawnIndices);
      made.pluginVertexData = terrainVertexData(vertices);
      made.material = material;
      addToScene(scene, made);
      return made;
    }
    updateMeshGeometry(engine, mesh, vertices.positions, vertices.normals, drawnIndices);
    mesh.pluginVertexData = terrainVertexData(vertices, mesh.pluginVertexData);
    mesh.pluginVertexVersion = (mesh.pluginVertexVersion ?? 0) + 1;
    return mesh;
  }

  const coverOf = (level: number): CoveredGround | null => (coversRing(covered, (rings[level] as RingSamples).spacing) ? covered : null);

  function stale(level: number): boolean {
    const ring = rings[level] as RingSamples;
    const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
    const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
    const d = drawn[level];
    const k = coverOf(level);
    return d === undefined || d.x !== ring.originX || d.z !== ring.originZ ||
      (finer !== null && (d.fx !== finer.originX || d.fz !== finer.originZ)) ||
      (coarser !== null && (d.cx !== coarser.originX || d.cz !== coarser.originZ)) ||
      !Object.is(d.kx, k?.x ?? Number.NaN) || !Object.is(d.kz, k?.z ?? Number.NaN) ||
      !Object.is(d.kr, k?.reach ?? Number.NaN) || !Object.is(d.kf, k?.fine ?? Number.NaN);
  }

  /** Ring `level` made again from its samples and written to its mesh. */
  function* emit(level: number): Slices {
    const ring = rings[level] as RingSamples;
    const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
    const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
    const out = buffers[level] ?? ringGeometryBuffers(level > 0);
    buffers[level] = out;
    const k = coverOf(level);
    yield* ringGeometrySlices(ring, finer === null ? null : holeCellsFor(ring, finer), coarser, out, k);
    const vertices = ringVertices(out);
    const whole = indices[level] ?? new Uint32Array(out.indices.length);
    indices[level] = whole;
    whole.set(vertices.indices);
    // The triangles left out: three times the first vertex, which draws nothing.
    whole.fill(0, vertices.indices.length);
    ringMeshes[level] = write(ringMeshes[level] ?? null, `clipmap_${level}`, materials.ground, vertices, whole);
    drawn[level] = {
      x: ring.originX, z: ring.originZ,
      fx: finer?.originX ?? Number.NaN, fz: finer?.originZ ?? Number.NaN,
      cx: coarser?.originX ?? Number.NaN, cz: coarser?.originZ ?? Number.NaN,
      kx: k?.x ?? Number.NaN, kz: k?.z ?? Number.NaN, kr: k?.reach ?? Number.NaN, kf: k?.fine ?? Number.NaN,
    };
  }

  /** The rings for a camera at (camX, camZ): every ring's samples moved,
   * then each ring whose inputs changed made again, leaving out the ground
   * `cover` names. */
  function* build(camX: number, camZ: number, cover: CoveredGround | null): Slices {
    covered = cover;
    for (let level = 0; level < RING_COUNT; level++) yield* ringSampleSlices(rings[level] as RingSamples, seed, camX, camZ, spare);
    let written = false;
    for (let level = 0; level < RING_COUNT; level++) {
      if (!stale(level)) continue;
      written = written || ringMeshes[level] !== null && ringMeshes[level] !== undefined;
      yield* emit(level);
    }
    // A mesh's plugin vertex data goes up as its draw is recorded again.
    if (written) invalidateRenderBundles(engine);
    builtX = snapOrigin(camX, base);
    builtZ = snapOrigin(camZ, base);
  }

  function* firstBuild(onRing?: (level: number) => void): Slices {
    if (rings.length === RING_COUNT || disposed) return;
    const at = options.start ?? { x: 0, z: 0 };
    const sampled = options.rings ?? null;
    for (let level = 0; level < RING_COUNT; level++) {
      rings.push(sampled?.[level] ?? createRingSamples(seed, level, at.x, at.z, base));
      onRing?.(level);
      if (sampled === null) yield;
    }
    if (sampled !== null) yield;
    // No patch stands yet: the first update measures the covered ground from the camera.
    yield* build(at.x, at.z, null);
  }

  function dropPatch(entry: PatchEntry): void {
    if (entry.mesh === null) return;
    removeFromScene(scene, entry.mesh);
    disposeMeshGpu(entry.mesh);
    entry.mesh = null;
    live--;
  }

  /** The patches for the camera's cell (ci, cj): the cells that entered, or
   * whose spacing or stitch changed, built; the ones that left let go. */
  function patch(ci: number, cj: number): void {
    const cx = (ci + 0.5) * PATCH_CELL;
    const cz = (cj + 0.5) * PATCH_CELL;
    const cells = facePatchCells(cx, cz, reach);
    const stitches = facePatchStitch(cells);
    const next = new Map<number, PatchEntry>();
    cells.forEach((cell, i) => {
      const key = patchKey(cell.ci, cell.cj);
      const bits = patchStitchBits(stitches[i] as PatchStitch);
      const had = patches.get(key);
      // An empty cell is empty whatever its stitch: only its grid decides.
      if (had !== undefined && had.spacing === cell.spacing && (had.stitch === bits || had.mesh === null)) {
        had.stitch = bits;
        patches.delete(key);
        next.set(key, had);
        return;
      }
      const made = facePatchGeometry(seed, cell.ci, cell.cj, cell.spacing, stitches[i] as PatchStitch, options.trail ?? null);
      let mesh: Mesh | null = null;
      if (made !== null) {
        const vertices = facePatchVertices(made);
        mesh = write(null, `facePatch_${cell.ci}_${cell.cj}`, materials.patches, vertices, Uint32Array.from(vertices.indices));
        live++;
      }
      next.set(key, { spacing: cell.spacing, stitch: bits, mesh });
    });
    // What is left of the old set changed or left the reach.
    for (const entry of patches.values()) dropPatch(entry);
    patches = next;
    patchCi = ci;
    patchCj = cj;
    patchCover = facePatchCover(cx, cz, reach);
  }

  return {
    firstBuild,
    update(camX, camZ) {
      if (disposed || rings.length < RING_COUNT) return;
      const ci = Math.floor(camX / PATCH_CELL);
      const cj = Math.floor(camZ / PATCH_CELL);
      if (ci !== patchCi || cj !== patchCj) patch(ci, cj);
      if (snapOrigin(camX, base) !== builtX || snapOrigin(camZ, base) !== builtZ || patchCover !== covered) {
        finish(build(camX, camZ, patchCover));
      }
    },
    meshCount() {
      return live + ringMeshes.filter((mesh) => mesh !== null && mesh !== undefined).length;
    },
    dispose() {
      disposed = true;
      for (const entry of patches.values()) dropPatch(entry);
      patches.clear();
      for (const mesh of ringMeshes) {
        if (mesh === null || mesh === undefined) continue;
        removeFromScene(scene, mesh);
        disposeMeshGpu(mesh);
      }
      ringMeshes.length = 0;
    },
  };
}
