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
 * `offset × OFFSET_HASH_SHIFT`, above the stride's bits (a stride of at most
 * 2,048 bytes fills bits 12–23), where the offset is the one the layout holds
 * (`layoutOffset`): 0 for an attribute past its stride, whose offset Babylon
 * binds with the buffer instead. It is an accessor on the instance, not a value
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

/** The device's limit on a vertex buffer's stride: WebGPU's default, which
 * the device is made with (`WEBGPU_REQUIRED_LIMITS` does not raise it). */
const MAX_VERTEX_BUFFER_STRIDE = 2048;

/**
 * The byte offset Babylon puts in the pipeline's vertex layout for
 * `vertexBuffer`: its offset when the attribute lies within its stride, else 0,
 * the offset then going to `setVertexBuffer` instead (`_validOffsetRange` in
 * `webgpuCacheRenderPipeline.js`, mirrored here). Only the first parts
 * pipelines, so only it goes into the key: an offset past the stride, such as
 * an accessor packed after another in one glTF view, would otherwise make a
 * pipeline of its own for the same layout.
 */
export function layoutOffset(vertexBuffer: VertexBuffer): number {
  const effective = vertexBuffer as VertexBuffer & { effectiveByteOffset?: number; effectiveByteStride?: number };
  const offset = effective.effectiveByteOffset ?? vertexBuffer.byteOffset;
  const stride = effective.effectiveByteStride ?? vertexBuffer.byteStride;
  const end = offset + vertexBuffer.getSize(true);
  return (stride === 0 ? end <= MAX_VERTEX_BUFFER_STRIDE : end <= stride) ? offset : 0;
}

/** Every vertex buffer already keyed. A set lookup is what a buffer costs on
 * every later draw, where reading its property descriptor would allocate. */
const keyedBuffers = new WeakSet<VertexBuffer>();

/** `vertexBuffer` with its hash keyed by its layout's byte offset
 * (`layoutOffset`) for every read, once: a buffer already keyed is left as it
 * is. */
export function keyByOffset(vertexBuffer: VertexBuffer): VertexBuffer {
  if (keyedBuffers.has(vertexBuffer)) return vertexBuffer;
  keyedBuffers.add(vertexBuffer);
  let base = vertexBuffer.hashCode;
  Object.defineProperty(vertexBuffer, "hashCode", {
    configurable: true,
    enumerable: true,
    get: () => base + layoutOffset(vertexBuffer) * OFFSET_HASH_SHIFT,
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
