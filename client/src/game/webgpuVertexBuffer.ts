/**
 * Vertex buffers that read one interleaved `Buffer` at different offsets,
 * keyed apart for Babylon's WebGPU pipeline cache.
 *
 * The bug (Babylon.js 9.18.0, WebGPU only): `WebGPUCacheRenderPipeline`'s
 * `_setVertexState` keys each attribute's vertex state as
 * `vertexBuffer.hashCode + (location << 7)` (`webgpuCacheRenderPipeline.js`),
 * and `VertexBuffer._computeHashCode` (`buffer.pure.js`) folds the type, the
 * normalisation, the size, instancing and the stride, but not the byte offset,
 * while `_getVertexInputDescriptor` bakes the offset of an attribute that lies
 * inside its stride into the pipeline. Two meshes that read one buffer at
 * different offsets, the same kind and format at the same location, therefore
 * share whichever pipeline was built first and read its offset. WebGL2 has no
 * such cache and draws both correctly.
 *
 * The workaround keys the hash by the offset as well, as
 * `byteOffset × OFFSET_HASH_SHIFT`, above the stride's bits (a stride of at most
 * 2,048 bytes fills bits 12–23). It is an accessor on the instance, not a value
 * added once: Babylon recomputes the hash by assigning `hashCode`, from the
 * constructor and from the `instanceDivisor` setter whenever instancing flips,
 * which would drop a term added once. The accessor keeps whatever Babylon
 * assigns as the base and adds the term on every read, so no recompute, nor any
 * later direct assignment, can lose it. The key stays exact: the cache looks it
 * up as a property of a plain object (`webgpuCacheRenderPipelineTree.js`),
 * where an integer's string is exact and unique below 2^53, and a byte offset
 * under WebGPU's default 2^28 buffer size keeps every key below 2^52 + 2^24.
 *
 * Not covered: whether consecutive attributes share one GPU buffer also shapes
 * the vertex layout and is not in the key either. A mismatch goes one of two
 * ways, by draw order: a mesh that binds two buffers drawn with a pipeline
 * built for one reads its second attribute from its first buffer, silently;
 * the reverse fails validation. So meshes that share a material must bind their
 * attributes to buffers in the same pattern. And a vertex buffer Babylon copies
 * (a cloned geometry) is a plain one again.
 *
 * Every vertex buffer drawn on a WebGPU engine is keyed so, whoever made it
 * (`keyEveryBoundBuffer`, installed by `createWebGpuEngine`): the glTF
 * loader's interleaved buffers too, such as the fern's and the shrub's UVs,
 * one kind in one 48-byte stride at offsets 24 and 12, which drew the shrub
 * with the fern's pipeline.
 *
 * The canaries in `webgpuVertexBuffer.test.ts` fail when an installed Babylon
 * keys the offset itself or recomputes the hash another way; the workaround and
 * its callers then go, or are revised, in the upgrade's own commit.
 */
import type { Buffer, VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";

/** How far above the stride's bits the byte offset is folded into the hash. */
export const OFFSET_HASH_SHIFT = 2 ** 24;

/** `vertexBuffer` with its hash keyed by its byte offset for every read, once:
 * a buffer already keyed is left as it is. */
export function keyByOffset(vertexBuffer: VertexBuffer): VertexBuffer {
  if (Object.getOwnPropertyDescriptor(vertexBuffer, "hashCode")?.get !== undefined) return vertexBuffer;
  let base = vertexBuffer.hashCode;
  Object.defineProperty(vertexBuffer, "hashCode", {
    configurable: true,
    enumerable: true,
    get: () => base + vertexBuffer.byteOffset * OFFSET_HASH_SHIFT,
    set: (value: number) => {
      base = value;
    },
  });
  return vertexBuffer;
}

/**
 * `buffer.createVertexBuffer(kind, offset, size, undefined, instanced)` (offset
 * and size in floats), with its hash keyed by its byte offset for every read
 * the pipeline cache makes.
 */
export function offsetKeyedVertexBuffer(
  buffer: Buffer,
  kind: string,
  offset: number,
  size: number,
  instanced = false,
): VertexBuffer {
  return keyByOffset(buffer.createVertexBuffer(kind, offset, size, undefined, instanced));
}

/** The part of Babylon's WebGPU pipeline cache the key reaches through. */
type BindingCache = {
  setBuffers(
    vertexBuffers: Record<string, VertexBuffer> | null,
    indexBuffer: unknown,
    overrideVertexBuffers: Record<string, VertexBuffer> | null,
  ): void;
};

/**
 * Keys every vertex buffer the WebGPU pipeline cache is given by its offset
 * (`keyByOffset`), whoever made it: the glTF loader's interleaved buffers, the
 * game's, Babylon's own. `setBuffers` on the cache's prototype
 * (`WebGPUCacheRenderPipeline`, which only WebGPU engines make, the main
 * cache and the clear quad's alike) is the one door every buffer passes
 * through before `_setVertexState` reads its hash, so a buffer is keyed before
 * its first draw on WebGPU, and a buffer drawn on WebGL2 is never touched.
 * Returns a function that puts the cache's own `setBuffers` back (for tests: a
 * page keeps it for its life).
 */
export function keyEveryBoundBuffer(cachePrototype: BindingCache): () => void {
  const own = cachePrototype.setBuffers;
  if ((own as { offsetKeyed?: boolean }).offsetKeyed === true) return () => undefined;
  const keyed: BindingCache["setBuffers"] = function (this: BindingCache, vertexBuffers, indexBuffer, overrideVertexBuffers) {
    for (const map of [vertexBuffers, overrideVertexBuffers]) {
      if (map === null || map === undefined) continue;
      for (const kind in map) {
        const vertexBuffer = map[kind];
        if (vertexBuffer) keyByOffset(vertexBuffer);
      }
    }
    own.call(this, vertexBuffers, indexBuffer, overrideVertexBuffers);
  };
  (keyed as { offsetKeyed?: boolean }).offsetKeyed = true;
  cachePrototype.setBuffers = keyed;
  return () => {
    if (cachePrototype.setBuffers === keyed) cachePrototype.setBuffers = own;
  };
}
