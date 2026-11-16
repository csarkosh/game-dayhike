/**
 * The steep ground's patches as one mesh's geometry on Babylon Lite: where
 * each patch's vertices stand in buffers every patch shares, and the one
 * list of triangles that draws the set shown.
 *
 * A patch is a grid of its cell at one of three spacings
 * (`facePatches.ts`), so it is one of three sizes, and its triangles are
 * its band's own pattern whatever the ground. Drawn a mesh a patch, a view
 * cost a draw for every patched cell in reach, 61 to 230 of them, each with
 * six buffers made when its cell entered the reach and destroyed when it
 * left. Here the patches are slots of one pool:
 *
 * - **A slot is a run of vertices**, as long as its band's grid. A patch
 *   takes the first run let go that it fits in, or the next never used,
 *   and keeps it while it is built or drawn; runs let go side by side are
 *   one run again, so what small patches leave a larger one can take. A
 *   walk writes new patches over old ones in place and makes no buffer.
 * - **The triangles drawn are one list**, each patch's pattern moved to its
 *   slot, the patches in the order of their places among the draws
 *   (`patchPlace`, `terrainMeshes.ts`), the same on every page. The
 *   picture is not, to the pixel, the one the patches gave as a mesh each:
 *   under the frame's four samples a pixel there are pixels of the patches'
 *   surface that the GPU settles by how its triangles are listed and
 *   gathered into draws, a few of 255 apart either way. Listing each
 *   patch's own triangles last to first changed three times as many of
 *   them as gathering the patches into one draw did.
 *
 * A patch's vertices can be written to its slot while the set before is
 * still drawn, since no triangle of the list names them yet; the set
 * changes in one step, when the list is written.
 *
 * **What a frame's writes send.** A slot's positions and normals go as
 * they are written, that run alone. Its plugin vertex data goes with the
 * next frame, and Lite sends a frame's marks of it as one run, from the
 * first float marked to the last: two patches written in one frame, in
 * slots far apart, send what lies between them too. `MarkedRun` counts
 * that, so whoever bounds a frame's bytes can ask what a slot would add.
 *
 * Loads no engine: a test drives it.
 */
import { PATCH_CELL, PATCH_FAR_SPACING, PATCH_NEAR_SPACING, PATCH_WIDE_SPACING } from "../facePatches.js";

/** The spacings a patch is made at, finest first: a slot is one of these sizes. */
export const PATCH_SPACINGS = [PATCH_NEAR_SPACING, PATCH_FAR_SPACING, PATCH_WIDE_SPACING] as const;

/** Vertices a patch at `spacing` has: its cell's grid, edges included. */
export function patchVertexCount(spacing: number): number {
  const side = Math.round(PATCH_CELL / spacing) + 1;
  return side * side;
}

/** Indices a patch at `spacing` draws: two triangles a square of its grid. */
export function patchIndexCount(spacing: number): number {
  const n = Math.round(PATCH_CELL / spacing);
  return n * n * 6;
}

/** The most indices the patches in `vertices` vertices of the pool can draw: the finest band draws the most a vertex. */
export function patchIndexCapacity(vertices: number): number {
  const most = Math.max(...PATCH_SPACINGS.map((spacing) => patchIndexCount(spacing) / patchVertexCount(spacing)));
  return Math.ceil((vertices * most) / 3) * 3;
}

/** Where a patch's vertices stand in the pool: its first vertex, and the spacing whose grid it holds. */
export type PatchSlot = { readonly at: number; readonly spacing: number };

/** The pool's slots: which runs of vertices are taken, and which are free to take again. */
export type PatchPool = {
  /** Vertices the pool has room for. */
  readonly capacity: number;
  /** Vertices up to the end of the last slot taken: past it no patch stands. */
  readonly top: number;
  /** Slots taken now. */
  readonly taken: number;
  /** A slot for a patch at `spacing`: the first run let go that holds its grid, else the next never used; null where
   * the pool has no room left for one. */
  take(spacing: number): PatchSlot | null;
  /** The slot `take` would hand a patch at `spacing`, not taken. */
  peek(spacing: number): PatchSlot | null;
  /** Lets `slot` go, for the next patch that fits to take. */
  free(slot: PatchSlot): void;
  /** Room for `capacity` vertices, no less than it has: every slot keeps its place. */
  grow(capacity: number): void;
};

/** A pool with room for `capacity` vertices, none taken. */
export function createPatchPool(capacity: number): PatchPool {
  /** Runs of vertices let go, in the order of their places, no two touching: a patch takes the first it fits in. */
  const spare: { at: number; count: number }[] = [];
  let room = capacity;
  let top = 0;
  let taken = 0;
  /** The first spare run with room for `count` vertices: its index, or -1. */
  const fits = (count: number): number => spare.findIndex((run) => run.count >= count);
  return {
    get capacity() {
      return room;
    },
    get top() {
      return top;
    },
    get taken() {
      return taken;
    },
    take(spacing) {
      const count = patchVertexCount(spacing);
      const i = fits(count);
      let at: number;
      if (i >= 0) {
        const run = spare[i] as { at: number; count: number };
        at = run.at;
        // The patch takes the run's start, and what is left of the run stays spare.
        if (run.count === count) spare.splice(i, 1);
        else {
          run.at += count;
          run.count -= count;
        }
      } else {
        if (top + count > room) return null;
        at = top;
        top += count;
      }
      taken++;
      return { at, spacing };
    },
    peek(spacing) {
      const count = patchVertexCount(spacing);
      const i = fits(count);
      if (i >= 0) return { at: (spare[i] as { at: number }).at, spacing };
      return top + count > room ? null : { at: top, spacing };
    },
    free(slot) {
      const count = patchVertexCount(slot.spacing);
      let i = spare.findIndex((run) => run.at > slot.at);
      if (i < 0) i = spare.length;
      const before = spare[i - 1];
      const after = spare[i];
      // Joined to the spare runs it touches, so what two small patches leave side by side a larger one can take.
      if (before !== undefined && before.at + before.count === slot.at) {
        before.count += count;
        if (after !== undefined && before.at + before.count === after.at) {
          before.count += after.count;
          spare.splice(i, 1);
        }
      } else if (after !== undefined && slot.at + count === after.at) {
        after.at = slot.at;
        after.count += count;
      } else spare.splice(i, 0, { at: slot.at, count });
      // A spare run at the pool's end is no run: the pool ends where it began.
      const last = spare[spare.length - 1];
      if (last !== undefined && last.at + last.count === top) {
        top = last.at;
        spare.pop();
      }
      taken--;
    },
    grow(next) {
      if (next < room) throw new Error(`the patches' pool holds ${room} vertices: it does not shrink to ${next}`);
      room = next;
    },
  };
}

/** The run of a mesh's plugin vertex data marked in one frame, as Lite will send it: one run, first mark to last. */
export type MarkedRun = {
  /** Whether nothing is marked in `frame` yet: the next mark begins its run, which is one write. */
  begins(frame: number): boolean;
  /** The bytes marking the floats `from` to `to` in `frame` adds to what that frame sends: the run's growth. */
  cost(frame: number, from: number, to: number): number;
  /** Marks them, and returns what that added. */
  mark(frame: number, from: number, to: number): number;
};

/** A run with nothing marked. */
export function createMarkedRun(): MarkedRun {
  let at = -1;
  let first = 0;
  let last = 0;
  const cost = (frame: number, from: number, to: number): number =>
    (frame === at ? Math.max(last, to) - Math.min(first, from) - (last - first) : to - from) * 4;
  return {
    begins: (frame) => frame !== at,
    cost,
    mark(frame, from, to) {
      const added = cost(frame, from, to);
      first = frame === at ? Math.min(first, from) : from;
      last = frame === at ? Math.max(last, to) : to;
      at = frame;
      return added;
    },
  };
}

/** A patch as the list draws it: its slot, and its place among the draws. */
export type DrawnPatch = { readonly slot: PatchSlot; readonly place: number };

/**
 * The triangles of `drawn` into `out`: each patch's `patterns` entry for its
 * spacing (a patch's own indices, from 0) moved to its slot, the patches in
 * the order of their places, two at one place in the order given. `drawn`
 * is put in that order. Returns how many indices it wrote; `out` past them
 * is left as it was.
 */
export function writePatchTriangles(drawn: DrawnPatch[], patterns: ReadonlyMap<number, Uint16Array>, out: Uint32Array): number {
  // Stable: two patches at one place (cells a whole period apart, which share no edge) keep the order they came in.
  drawn.sort((a, b) => a.place - b.place);
  let at = 0;
  for (const patch of drawn) {
    const pattern = patterns.get(patch.slot.spacing);
    if (pattern === undefined) throw new Error(`no triangles for a patch at a spacing of ${patch.slot.spacing} m`);
    if (at + pattern.length > out.length) throw new Error(`the patches' triangles do not fit: ${at + pattern.length} indices in room for ${out.length}`);
    const base = patch.slot.at;
    for (let i = 0; i < pattern.length; i++) out[at + i] = (pattern[i] as number) + base;
    at += pattern.length;
  }
  return at;
}

/** The first index at which `a` and `b` differ within their first `count`, or `count` where they do not. */
export function firstDifference(a: Uint32Array, b: Uint32Array, count: number): number {
  for (let i = 0; i < count; i++) if (a[i] !== b[i]) return i;
  return count;
}
