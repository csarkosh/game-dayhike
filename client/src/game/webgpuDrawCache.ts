/**
 * A geometry's cached draws reset whenever one of its buffers is replaced,
 * so the WebGPU fast path never submits a buffer already destroyed.
 *
 * The bug (Babylon.js 9.18.0, WebGPU with `compatibilityMode = false` only):
 * each draw of a sub-mesh in a pass records a render bundle once and replays
 * it (`fastBundle` in `webgpuEngine.pure.js` `_draw`), with the vertex and
 * index buffers it was recorded with baked in. The bundle is dropped only when
 * its draw context is reset or dirtied (`webgpuDrawContext.js`): by a new
 * effect (`DrawWrapper.setEffect`), a changed material context, or a changed
 * uniform or storage buffer. Replacing a vertex or index buffer does none of
 * these by itself. The main pass gets away with it, because the attributes
 * dirtied by the swap (`Geometry._notifyUpdate`) make the material set its
 * effect again; the shadow pass does not, since `ShadowGenerator.isReady`
 * sets a new effect only when its defines string changes. So a thin-instance
 * bucket that grows (`thinInstanceSetBuffer` with a larger array, as the bird
 * flocks do) keeps its shadow bundle bound to the old matrix buffer, which the
 * swap disposed: "Buffer … used in submit while destroyed", the device lost
 * and the page rebuilt on WebGL2 (2026-10-23, the owner's Mac and a player's).
 * Reproduced 2026-10-25 by replacing one shadow-casting pine's matrix buffer
 * with an identical copy: the renderer failed on the next frame, and the same
 * swap followed by this reset drew on.
 *
 * The workaround wraps the three doors through which a geometry takes a new
 * buffer, `setVerticesBuffer` (every thin-instance buffer, made or grown, and
 * every `setVerticesData` passes through it), `setIndices` (which makes the
 * sub-meshes, and with them their draws, again unless told not to) and
 * `setIndexBuffer`, and after each resets the draw context of every sub-mesh
 * of every mesh on the geometry, in every pass: the same reset a new effect
 * makes. A reset costs the next draw of each a bundle and bind groups made
 * again, once; a buffer written in place (`updateDirectly`,
 * `thinInstanceBufferUpdated`) is not a swap and resets nothing.
 *
 * The canaries in `webgpuDrawCache.test.ts` fail when an installed Babylon
 * resets the draw contexts on a swap itself; the workaround and its install
 * then go in the upgrade's own commit.
 */
import type { Geometry } from "@babylonjs/core/Meshes/geometry.js";

/** The part of a sub-mesh this reaches: its draw wrappers, one a pass. */
type WithDrawWrappers = { _drawWrappers?: ({ drawContext?: { reset(): void } | null } | null | undefined)[] };

/** Resets the draw context of every sub-mesh of every mesh on `geometry`, in
 * every pass it has drawn in; returns how many it reset. */
export function resetDrawsOf(geometry: Geometry): number {
  let reset = 0;
  for (const mesh of geometry.meshes) {
    for (const subMesh of mesh.subMeshes ?? []) {
      for (const wrapper of (subMesh as unknown as WithDrawWrappers)._drawWrappers ?? []) {
        const context = wrapper?.drawContext;
        if (context) {
          context.reset();
          reset++;
        }
      }
    }
  }
  return reset;
}

/** The doors on `Geometry.prototype` a new buffer comes through. */
const SWAPS = ["setVerticesBuffer", "setIndices", "setIndexBuffer"] as const;
type SwapDoors = Record<(typeof SWAPS)[number], (...args: never[]) => unknown>;

/**
 * Wraps `setVerticesBuffer`, `setIndices` and `setIndexBuffer` on
 * `geometryPrototype` (`Geometry.prototype`) so each resets the geometry's
 * draws after its own work (`resetDrawsOf`). Once per page: a second install
 * changes nothing. Returns a function that puts the three back (for tests).
 */
export function resetDrawsOnBufferSwap(geometryPrototype: SwapDoors): () => void {
  // Each door kept by name: a class's methods are not enumerable, so a copy
  // of the prototype by spread would hold none of them.
  const own: Partial<SwapDoors> = {};
  const wrapped: Partial<SwapDoors> = {};
  for (const name of SWAPS) {
    const door = geometryPrototype[name] as ((...args: never[]) => unknown) & { resetsDraws?: boolean };
    if (door.resetsDraws === true) continue;
    own[name] = door;
    const wrapper = function (this: Geometry, ...args: never[]): unknown {
      const result = door.apply(this, args);
      resetDrawsOf(this);
      return result;
    };
    (wrapper as { resetsDraws?: boolean }).resetsDraws = true;
    geometryPrototype[name] = wrapper;
    wrapped[name] = wrapper;
  }
  return () => {
    for (const name of SWAPS) {
      const door = own[name];
      if (door !== undefined && geometryPrototype[name] === wrapped[name]) geometryPrototype[name] = door;
    }
  };
}
