/**
 * What a WebGPU device holds, counted where it is made and where it is let
 * go: buffers and textures alive, and their bytes by arithmetic.
 *
 * A device lost for want of memory says so in no field of its own, so the
 * row a hike sends of a lost device carries what the page had asked the
 * device to hold. The count is taken as `deviceMakes.ts` takes its own:
 * a function of the same name stood on the device in front of
 * `createBuffer` and `createTexture`, and one stood on each buffer and
 * texture made in front of its `destroy`. Nothing is counted or called on
 * a frame that makes and destroys nothing, and `stop` takes the device's
 * two functions off. What is made with no `destroy` called on it (left to
 * the collector, or gone with its device) stays in the count: this is what
 * was asked for and not let go, which is what a loss wants told.
 *
 * A texture's bytes are its texels by its format's size, every mip and
 * layer and sample: what the page asked for, not what a driver keeps.
 *
 * No engine: any object with those calls is counted, so it runs under Node.
 */
/** What a device holds: its buffers and textures alive, and the bytes they were asked for. */
export type HeldCounts = { buffers: number; bufferBytes: number; textures: number; textureBytes: number };

/** A texture as its bytes are worked out from: what a texture made says of itself. */
export type TextureShape = {
  width: number;
  height?: number;
  depthOrArrayLayers?: number;
  mipLevelCount?: number;
  sampleCount?: number;
  format: string;
  dimension?: string;
};

type MadeBuffer = { readonly size: number; destroy(): void };
type MadeTexture = TextureShape & { destroy(): void };

/** The calls counted: a device, or anything with the same ones. */
export type HeldDevice = {
  createBuffer(descriptor: never): unknown;
  createTexture(descriptor: never): unknown;
};

/** The bytes of one texel of `format` (a block format's by its block): 4 for one this does not know. */
export function texelBytes(format: string): number {
  const astc = /^astc-(\d+)x(\d+)/.exec(format);
  if (astc !== null) return 16 / (Number(astc[1]) * Number(astc[2]));
  if (/^bc[14]-/.test(format)) return 0.5;
  if (/^bc\d/.test(format)) return 1;
  if (/^(etc2-rgb8unorm|etc2-rgb8a1unorm|eac-r11)/.test(format)) return 0.5;
  if (/^(etc2-rgba8unorm|eac-rg11)/.test(format)) return 1;
  if (format === "depth16unorm") return 2;
  if (format === "depth32float-stencil8") return 8;
  if (format.startsWith("depth") || format === "rgb10a2unorm" || format === "rgb10a2uint" || format === "rg11b10ufloat" || format === "rgb9e5ufloat") return 4;
  if (format === "stencil8") return 1;
  const plain = /^(r|rg|rgba|bgra)(8|16|32)/.exec(format);
  if (plain === null) return 4;
  const channels = plain[1] === "r" ? 1 : plain[1] === "rg" ? 2 : 4;
  return (channels * Number(plain[2])) / 8;
}

/** The bytes a texture of `shape` was asked for: every mip of every layer, by the format's texel and the samples. */
export function textureBytes(shape: TextureShape): number {
  const height = shape.height ?? 1;
  const deep = shape.dimension === "3d";
  const layers = shape.depthOrArrayLayers ?? 1;
  const mips = shape.mipLevelCount ?? 1;
  let texels = 0;
  for (let mip = 0; mip < mips; mip++) {
    texels += Math.max(1, shape.width >> mip) * Math.max(1, height >> mip) * (deep ? Math.max(1, layers >> mip) : layers);
  }
  return Math.round(texels * texelBytes(shape.format) * (shape.sampleCount ?? 1));
}

export type DeviceHeld = {
  /** What the device counted holds now; zeros before any is counted. */
  readonly counts: Readonly<HeldCounts>;
  /** Begins counting what `device` is asked to make; a device counted before it is let go of. */
  count(device: HeldDevice): void;
  /** Takes the count off the device. What it made keeps its own `destroy` stood on it, which then counts for nobody. */
  stop(): void;
};

export function createDeviceHeld(): DeviceHeld {
  const counts: HeldCounts = { buffers: 0, bufferBytes: 0, textures: 0, textureBytes: 0 };
  let counted: HeldDevice | null = null;
  const off = (): void => {
    if (counted === null) return;
    const own = counted as unknown as Record<string, unknown>;
    delete own.createBuffer;
    delete own.createTexture;
    counted = null;
  };
  // One function a kind, stood on each thing made: it takes itself off, so the thing's own `destroy` runs, once.
  function bufferGone(this: MadeBuffer): void {
    delete (this as { destroy?: unknown }).destroy;
    counts.buffers--;
    counts.bufferBytes -= this.size;
    this.destroy();
  }
  function textureGone(this: MadeTexture): void {
    delete (this as { destroy?: unknown }).destroy;
    counts.textures--;
    counts.textureBytes -= textureBytes(this);
    this.destroy();
  }
  return {
    counts,
    count(device) {
      off();
      counted = device;
      const own = device as unknown as Record<string, (descriptor: never) => unknown>;
      // The device's own calls, found through its prototype: the functions stood here are taken off again by `stop`.
      const createBuffer = own.createBuffer as (descriptor: never) => unknown;
      const createTexture = own.createTexture as (descriptor: never) => unknown;
      own.createBuffer = (descriptor: never): unknown => {
        const made = createBuffer.call(device, descriptor) as MadeBuffer;
        counts.buffers++;
        counts.bufferBytes += made.size;
        made.destroy = bufferGone;
        return made;
      };
      own.createTexture = (descriptor: never): unknown => {
        const made = createTexture.call(device, descriptor) as MadeTexture;
        counts.textures++;
        // A texture says its own size and format: the same arithmetic when it is let go.
        counts.textureBytes += textureBytes(made);
        made.destroy = textureGone;
        return made;
      };
    },
    stop: off,
  };
}
