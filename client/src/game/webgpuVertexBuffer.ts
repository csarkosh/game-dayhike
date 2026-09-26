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
 * The canaries in `webgpuVertexBuffer.test.ts` fail when an installed Babylon
 * keys the offset itself or recomputes the hash another way; the workaround and
 * its callers then go, or are revised, in the upgrade's own commit.
 */
import type { Buffer, VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";

/** How far above the stride's bits the byte offset is folded into the hash. */
export const OFFSET_HASH_SHIFT = 2 ** 24;

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
  const vertexBuffer = buffer.createVertexBuffer(kind, offset, size, undefined, instanced);
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
