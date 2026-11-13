/**
 * Babylon's own two pipelines, off the engine's start. Its WebGPU texture
 * manager makes two render pipelines in its constructor, inside the
 * engine's `initAsync`, with the synchronous `createRenderPipeline`: one
 * that copies a video's frame to a texture and one that makes a texture's
 * mipmaps. On a phone the two held the browser's GPU thread 155 and 171 ms
 * in two starts of three (a Pixel 9, 2026-11-12; 25 to 85 ms the video's,
 * 10 to 110 ms the mipmaps'), a moment after Play, and that thread also
 * presents the intro film's frames: two were dropped each time.
 *
 * The game has no video texture, so the first is not made at the start:
 * Babylon makes it the first time it is asked for, which here is never. The
 * second is needed, so it is asked for with `createRenderPipelineAsync`,
 * from the descriptor Babylon itself builds, and stored where Babylon looks
 * for it. Babylon's own path is the fallback throughout: a mipmap asked for
 * before the asynchronous pipeline lands makes Babylon's synchronous one,
 * as it always did, and that one is kept.
 */

/** The two methods the manager's constructor calls, as they are named on its prototype. */
const EAGER = ["_getPipeline", "_getVideoPipeline"] as const;

type Getter = (this: unknown, ...args: unknown[]) => unknown;

/** A wrap on one manager class's prototype: what was there, and how many starts are under way. */
type Wrap = { depth: number; originals: Map<string, Getter> };

const wraps = new WeakMap<object, Wrap>();

/** Whether `manager` is not yet the one its engine holds: true only while its constructor runs,
 * since the engine keeps it (`_textureHelper`) once it is made. */
function underConstruction(manager: unknown): boolean {
  const engine = (manager as { _engine?: { _textureHelper?: unknown } } | null)?._engine;
  return engine !== undefined && engine !== null && engine._textureHelper !== manager;
}

/**
 * Runs `init` (the engine's `initAsync`) with the texture manager's
 * constructor making neither of its two pipelines: on `manager`'s
 * prototype, for the length of the call, the first call of `_getPipeline`
 * and of `_getVideoPipeline` by a manager its engine does not hold yet (its
 * constructor's, then) returns at once. Any other call is Babylon's own:
 * a later call of the same manager, and every call of a manager made
 * before. The prototype's own methods are back when the last start under
 * way has settled, resolved or rejected. A manager with neither method (a
 * Babylon that moved) is left alone, and `init` runs as it is.
 */
export async function withoutEagerPipelines<T>(manager: { prototype: object }, init: () => Promise<T>): Promise<T> {
  const proto = manager.prototype as Record<string, unknown>;
  let wrap = wraps.get(proto);
  if (wrap === undefined) {
    wrap = { depth: 0, originals: new Map() };
    wraps.set(proto, wrap);
  }
  if (wrap.depth === 0) {
    for (const name of EAGER) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      const skipped = new WeakSet<object>();
      wrap.originals.set(name, original as Getter);
      proto[name] = function (this: object, ...args: unknown[]): unknown {
        if (!skipped.has(this) && underConstruction(this)) {
          skipped.add(this);
          return undefined;
        }
        return (original as Getter).apply(this, args);
      };
    }
  }
  wrap.depth++;
  try {
    return await init();
  } finally {
    wrap.depth--;
    if (wrap.depth === 0) {
      for (const [name, original] of wrap.originals) proto[name] = original;
      wrap.originals.clear();
    }
  }
}

/** Where the manager keeps a format's mipmap pipeline (`1 << 0`, its `PipelineType.MipMap`). */
const MIPMAP_INDEX = 1;

/** A texture manager, as far as the pipeline ahead reads it. */
type MipmapManager = {
  _getPipeline?: (format: string) => unknown;
  _pipelines?: Record<string, unknown[] | undefined>;
};

/**
 * Asks for `manager`'s mipmap pipeline of `format` with
 * `createRenderPipelineAsync`, and stores it as the manager does
 * (`_pipelines[format][1]`, the pipeline and its first bind group layout)
 * unless one is there by then. The descriptor is the manager's own: its
 * `_getPipeline` is run once with the device's `createRenderPipeline`
 * shadowed, on the device's own instance and only for that call, by a
 * recorder that keeps the descriptor and makes nothing, so the manager has
 * processed its shader and made and kept its modules, exactly as it does,
 * and stopped short of the synchronous pipeline. Resolves true where it
 * stored one; false where the pipeline was already there, where the manager
 * threw of its own, is not as expected or is not there at all (nor the
 * device), where the creation failed, or
 * where Babylon had made its own meanwhile, which is then the one kept.
 * Never rejects.
 */
export function mipmapPipelineAhead(device: GPUDevice, manager: object, format: GPUTextureFormat = "rgba8unorm"): Promise<boolean> {
  const isObject = (x: unknown): boolean => typeof x === "object" && x !== null;
  // No manager or no device where they were looked for (a Babylon that moved): Babylon's own path.
  if (!isObject(manager) || !isObject(device)) return Promise.resolve(false);
  const own = manager as MipmapManager;
  if (typeof own._getPipeline !== "function") return Promise.resolve(false);
  const recorded = new Error("the mipmap pipeline's descriptor, recorded");
  let descriptor: GPURenderPipelineDescriptor | null = null;
  const had = Object.getOwnPropertyDescriptor(device, "createRenderPipeline");
  try {
    Object.defineProperty(device, "createRenderPipeline", {
      configurable: true,
      writable: true,
      value: (given: GPURenderPipelineDescriptor): never => {
        descriptor = given;
        throw recorded;
      },
    });
    own._getPipeline(format);
    // It returned: the pipeline was there already, and nothing was recorded.
  } catch (error) {
    if (error !== recorded) descriptor = null;
  } finally {
    if (had === undefined) delete (device as { createRenderPipeline?: unknown }).createRenderPipeline;
    else Object.defineProperty(device, "createRenderPipeline", had);
  }
  if (descriptor === null) return Promise.resolve(false);
  let asked: Promise<GPURenderPipeline>;
  try {
    asked = device.createRenderPipelineAsync(descriptor);
  } catch {
    return Promise.resolve(false);
  }
  return asked
    .then((pipeline) => {
      const pipelines = (own._pipelines ??= {});
      const slots = (pipelines[format] ??= []);
      if (slots[MIPMAP_INDEX]) return false;
      slots[MIPMAP_INDEX] = [pipeline, pipeline.getBindGroupLayout(0)];
      return true;
    })
    .catch(() => false);
}
